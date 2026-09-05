import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  CHARGER_SUBJECT_ID,
  C_RELEASE_ID,
  SENSOR_SUBJECT_ID,
  SUBJECT_ID,
  X_DEFINITION_ID,
  X_REVISION_1,
  X_REVISION_2,
  Y_DEFINITION_ID,
  Y_REVISION_1,
  installPublishedCatalogMatchChain,
  type InstalledCatalogMatchChain
} from "../../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { CLASSIFIER_VERSION } from "../../../server/modules/catalog-cutover/classifier/rules";
import type { ClassificationResult } from "../../../server/modules/catalog-cutover/classifier/types";
import { appendMappingVersion } from "../../../server/modules/catalog-cutover/mapping";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId
} from "../../../server/modules/parameter-catalog-contract/index";
import { createEvidenceIngest } from "../../../server/modules/parameter-governance/evidence";
import { executeRegistration } from "../../../server/modules/parameter-governance/registration";
import { createPostgresDatabase, getRootPostgresPool } from "../../../server/shared/database/client";
import {
  assertCatalogLaneEvidenceUrl,
  COMPOSE_APP_DATABASE,
  COMPOSE_APP_PORT,
  forbiddenCatalogLaneReason,
  laneDatabaseName
} from "../../../scripts/catalog-lane-env";
import { seedM0Foundation } from "../../../scripts/seed-m0";
import { ACCEPTANCE_ORGANIZATION, acceptanceCast } from "./cast";
import { seedAcceptanceRoleMatrix } from "./roleFixtures";

export const CATALOG_ACCEPTANCE_ISSUE = 810;
export const CATALOG_AGENT_USER = {
  userId: "agt-catalog-acceptance",
  name: "Catalog Agent",
  email: "catalog.agent@chargelab.cn",
  title: "WiseEff Agent"
} as const;
export const CATALOG_ORG_B = { id: "org-catalog-b", name: "Catalog Org B" } as const;
export const CATALOG_ORG_B_ADMIN = {
  userId: "user-catalog-b-admin",
  name: "Catalog B Admin",
  email: "admin-b@catalog.test",
  title: "Org Admin"
} as const;

const LEGACY_SOURCE_SYSTEM = "wiseeff-v1";
const CUTOVER_RUN_ID = "cutover-op08-810";
const MAPPED_LEGACY_ID = "spec-op08-mapped-iin-max";
const GONE_LEGACY_ID = "spec-op08-gone-archived";
const CONFLICT_LEGACY_ID = "spec-op08-conflict-twin";
const UNKNOWN_LEGACY_ID = "spec-op08-unknown-missing";
const SCOPE_HIDDEN_LEGACY_ID = "spec-op08-scope-hidden";
const MAPPED_IDENTITY_ID = "lid-op08-mapped";
const GONE_IDENTITY_ID = "lid-op08-gone";
const CONFLICT_PLATFORM_IDENTITY_ID = "lid-op08-conflict-platform";
const CONFLICT_ORG_IDENTITY_ID = "lid-op08-conflict-org";
const SCOPE_HIDDEN_IDENTITY_ID = "lid-op08-scope-hidden";
const GONE_ARCHIVE_ID = "archive-op08-gone";
const SOURCE_CHECKSUM = "sha256:op08-catalog-legacy-source";
const GRAPH_FINGERPRINT = "sha256:op08-catalog-legacy-graph";
const X_ON_C_DOCUMENTATION = "Documented maximum accepted input current.";
const REVIEW_SOURCE_IDENTITY = "op08-review:iin_max";

export type CatalogAcceptanceFixture = {
  pool: pg.Pool;
  chain: InstalledCatalogMatchChain;
  organizationId: string;
  organizationBId: string;
  agentUserId: string;
  chargerSubjectId: string;
  sensorSubjectId: string;
  powerSubjectId: string;
  xDefinitionId: string;
  yDefinitionId: string;
  reviewSourceIdentity: string;
  legacy: {
    mapped: string;
    gone: string;
    conflict: string;
    unknown: string;
    scopeHidden: string;
  };
  oracle: {
    xOnC: {
      revisionId: string;
      revisionNumber: 2;
      documentation: string;
      publishedInReleaseId: string;
    };
    yOnC: {
      revisionId: string;
      revisionNumber: 1;
    };
    usage: {
      policyCount: 0;
      projectCount: 0;
      currentValueCount: 0;
    };
  };
};

let fixturePromise: Promise<CatalogAcceptanceFixture> | null = null;

export function catalogLaneConnectionString(): string {
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Catalog OP-08 acceptance requires DATABASE_URL (or TEST_DATABASE_URL) pointing at wiseeff_lane_810. Missing environment fails closed."
    );
  }
  const forbidden = forbiddenCatalogLaneReason(connectionString);
  if (forbidden) {
    throw new Error(forbidden);
  }
  const url = assertCatalogLaneEvidenceUrl(connectionString);
  const port = url.port === "" ? 5432 : Number(url.port);
  if (port === COMPOSE_APP_PORT) {
    throw new Error(
      `Catalog OP-08 acceptance rejects the compose app port ${COMPOSE_APP_PORT}. Use the dedicated pgvector lane on 55438.`
    );
  }
  const database = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (database === COMPOSE_APP_DATABASE) {
    throw new Error(`Catalog OP-08 acceptance rejects shared database "${COMPOSE_APP_DATABASE}".`);
  }
  const expected = laneDatabaseName(CATALOG_ACCEPTANCE_ISSUE);
  if (database !== expected) {
    throw new Error(
      `Catalog OP-08 acceptance requires ${expected} (issue 810). Received ${database || "(empty)"}.`
    );
  }
  return connectionString;
}

export function ensureCatalogAcceptanceFixture(): Promise<CatalogAcceptanceFixture> {
  if (!fixturePromise) {
    fixturePromise = installCatalogAcceptanceFixture();
  }
  return fixturePromise;
}

async function installCatalogAcceptanceFixture(): Promise<CatalogAcceptanceFixture> {
  const connectionString = catalogLaneConnectionString();
  const root = createPostgresDatabase(connectionString);
  const pool = getRootPostgresPool(root);
  if (!pool) {
    throw new Error("Catalog OP-08 acceptance requires a root PostgreSQL pool.");
  }

  await seedM0Foundation(root);
  await seedAcceptanceRoleMatrix();
  await seedCatalogActors(pool);
  await seedCatalogPlacementModules(pool);

  const existing = await pool.query<{ id: string; release_digest: string; release_sequence: string }>(
    `select id, release_digest, release_sequence::text
       from parameter_catalog.catalog_releases
      order by release_sequence`
  );
  const chain =
    existing.rows.length >= 6
      ? reconstructChain(existing.rows)
      : await installPublishedCatalogMatchChain(pool);

  await registerChargerSubject(pool, chain.pinF);
  await ingestOpenReview(pool, chain.pinF.id);
  await seedLegacyBookmarks(pool, chain.pinC.id);

  return {
    pool,
    chain,
    organizationId: ACCEPTANCE_ORGANIZATION.id,
    organizationBId: CATALOG_ORG_B.id,
    agentUserId: CATALOG_AGENT_USER.userId,
    chargerSubjectId: CHARGER_SUBJECT_ID,
    sensorSubjectId: SENSOR_SUBJECT_ID,
    powerSubjectId: SUBJECT_ID,
    xDefinitionId: X_DEFINITION_ID,
    yDefinitionId: Y_DEFINITION_ID,
    reviewSourceIdentity: REVIEW_SOURCE_IDENTITY,
    legacy: {
      mapped: MAPPED_LEGACY_ID,
      gone: GONE_LEGACY_ID,
      conflict: CONFLICT_LEGACY_ID,
      unknown: UNKNOWN_LEGACY_ID,
      scopeHidden: SCOPE_HIDDEN_LEGACY_ID
    },
    oracle: {
      xOnC: {
        revisionId: X_REVISION_2,
        revisionNumber: 2,
        documentation: X_ON_C_DOCUMENTATION,
        publishedInReleaseId: C_RELEASE_ID
      },
      yOnC: {
        revisionId: Y_REVISION_1,
        revisionNumber: 1
      },
      usage: {
        policyCount: 0,
        projectCount: 0,
        currentValueCount: 0
      }
    }
  };
}

function reconstructChain(
  rows: Array<{ id: string; release_digest: string; release_sequence: string }>
): InstalledCatalogMatchChain {
  const bySequence = [...rows].sort((left, right) => Number(left.release_sequence) - Number(right.release_sequence));
  const pin = (index: number) => {
    const row = bySequence[index];
    if (!row) {
      throw new Error(`Catalog OP-08 expected release sequence ${index + 1}; found ${bySequence.length}.`);
    }
    return { id: row.id, digest: row.release_digest };
  };
  const emptyCompiled = {} as InstalledCatalogMatchChain["compiledA"];
  return {
    compiledA: emptyCompiled,
    compiledB: emptyCompiled,
    compiledC: emptyCompiled,
    compiledD: emptyCompiled,
    compiledE: emptyCompiled,
    compiledF: emptyCompiled,
    pinA: pin(0),
    pinB: pin(1),
    pinC: pin(2),
    pinD: pin(3),
    pinE: pin(4),
    pinF: pin(5)
  };
}

async function seedCatalogActors(pool: pg.Pool): Promise<void> {
  await pool.query(
    `insert into public.organizations (id, name) values ($1, $2)
     on conflict (id) do update set name = excluded.name`,
    [CATALOG_ORG_B.id, CATALOG_ORG_B.name]
  );
  await pool.query(
    `insert into public.users (id, organization_id, name, email, title, is_active)
     values ($1, $2, $3, $4, $5, true), ($6, $7, $8, $9, $10, true)
     on conflict (id) do update set
       organization_id = excluded.organization_id,
       name = excluded.name,
       email = excluded.email,
       title = excluded.title,
       is_active = excluded.is_active`,
    [
      CATALOG_AGENT_USER.userId,
      ACCEPTANCE_ORGANIZATION.id,
      CATALOG_AGENT_USER.name,
      CATALOG_AGENT_USER.email,
      CATALOG_AGENT_USER.title,
      CATALOG_ORG_B_ADMIN.userId,
      CATALOG_ORG_B.id,
      CATALOG_ORG_B_ADMIN.name,
      CATALOG_ORG_B_ADMIN.email,
      CATALOG_ORG_B_ADMIN.title
    ]
  );
  await pool.query(
    `insert into public.user_role_bindings (id, user_id, organization_id, project_id, role_id)
     values
       ('urb-op08-agent', $1, $2, null, 'guest'),
       ('urb-op08-org-b-admin', $3, $4, null, 'admin')
     on conflict (id) do update set
       user_id = excluded.user_id,
       organization_id = excluded.organization_id,
       role_id = excluded.role_id`,
    [CATALOG_AGENT_USER.userId, ACCEPTANCE_ORGANIZATION.id, CATALOG_ORG_B_ADMIN.userId, CATALOG_ORG_B.id]
  );
  void acceptanceCast;
  void X_REVISION_1;
}

async function seedCatalogPlacementModules(pool: pg.Pool): Promise<void> {
  const orgs = [
    { organizationId: ACCEPTANCE_ORGANIZATION.id, attr: "attr-op08-chargelab", moduleDriver: "pmod-op08-driver", moduleNode: "pmod-op08-node-type" },
    { organizationId: CATALOG_ORG_B.id, attr: "attr-op08-org-b", moduleDriver: "pmod-op08-org-b-driver", moduleNode: "pmod-op08-org-b-node-type" }
  ] as const;
  for (const org of orgs) {
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'OP08 driver', $3)
       on conflict (id) do nothing`,
      [org.attr, org.organizationId, `compatible:op08,${org.organizationId}`]
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')
       on conflict (attribution_subject_id) do nothing`,
      [org.attr]
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver', $1, 1, 'driver-group', 'curated', $4),
         ($2, $3, 'Node type', $2, 1, 'node-type', 'curated', $4)
       on conflict (id) do nothing`,
      [org.moduleDriver, org.moduleNode, org.organizationId, org.attr]
    );
  }
}

async function registerChargerSubject(
  pool: pg.Pool,
  pin: { id: string; digest: string }
): Promise<void> {
  const existing = await pool.query<{ id: string }>(
    `select id
       from parameter_catalog.organization_subject_registrations
      where organization_id = $1 and subject_id = $2
      limit 1`,
    [ACCEPTANCE_ORGANIZATION.id, CHARGER_SUBJECT_ID]
  );
  if (existing.rows[0]) {
    return;
  }
  const written = await executeRegistration(pool, {
    kind: "register",
    organizationId: ACCEPTANCE_ORGANIZATION.id,
    subjectId: CatalogSubjectId(CHARGER_SUBJECT_ID),
    subjectKind: "node-type",
    expectedRelease: { id: CatalogReleaseId(pin.id), digest: CatalogReleaseDigest(pin.digest) },
    placement: { mode: "use-default" },
    destinationModuleId: "pmod-op08-node-type",
    method: "explicit",
    proof: { reason: "op08 charger ready fixture" },
    idempotencyKey: "op08-register-charger",
    context: { actorKind: "org-admin", principalId: acceptanceCast.acceptanceAdmin.userId }
  });
  if (!written.ok) {
    throw new Error(`Catalog OP-08 charger registration failed: ${JSON.stringify(written.error)}`);
  }
}

export async function ingestOpenReview(pool: pg.Pool, catalogReleaseId: string): Promise<void> {
  const ingest = createEvidenceIngest(pool);
  const result = await ingest.ingest({
    organizationId: ACCEPTANCE_ORGANIZATION.id,
    sourceIdentity: `${REVIEW_SOURCE_IDENTITY}:${randomUUID()}`,
    catalogReleaseId: CatalogReleaseId(catalogReleaseId),
    matcherRevision: `matcher-op08-${randomUUID()}`,
    matcherOutput: { status: "unknown" },
    evidence: { propertyKey: `iin_max_${randomUUID()}`, subjectId: SUBJECT_ID }
  });
  if (!result.ok) {
    throw new Error(`Catalog OP-08 review ingest failed: ${JSON.stringify(result.error)}`);
  }
}

function classificationFor(assignments: ClassificationResult["assignments"]): ClassificationResult {
  return {
    classifierVersion: CLASSIFIER_VERSION,
    graphFingerprint: GRAPH_FINGERPRINT,
    conservation: {
      inputCount: assignments.length,
      classifiedCount: assignments.length,
      duplicatePrimaryCount: 0,
      classCounts: {
        R0: 0,
        R1: 1,
        R2: 0,
        R3: 0,
        R4: Math.max(0, assignments.length - 1),
        R5: 0,
        R6: 0,
        R7: 0,
        R8: 0,
        R9: 0,
        R10: 0
      },
      dispositionCounts: {
        blocked: 0,
        mapped: assignments.filter((row) => row.disposition === "mapped").length,
        archived: assignments.filter((row) => row.disposition === "archived").length,
        "review-evidence": 0,
        "definition-proposal": 0
      },
      conserved: true
    },
    blockers: [],
    assignments
  };
}

async function seedLegacyBookmarks(pool: pg.Pool, catalogReleaseId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into parameter_catalog.parameter_catalog_cutover_runs (
         id, source_snapshot_fingerprint, target_artifact_sha,
         target_catalog_release_digest, migration_contract_version,
         plan_digest, current_phase, state
       ) values (
         $1, $2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         $3, $4, $5, 'P7', 'running'
       )
       on conflict (id) do nothing`,
      [CUTOVER_RUN_ID, GRAPH_FINGERPRINT, `sha256:${catalogReleaseId}`, CLASSIFIER_VERSION, `sha256:op08-plan`]
    );
    const identities = [
      [MAPPED_IDENTITY_ID, "parameter-spec", "platform", "platform", MAPPED_LEGACY_ID],
      [GONE_IDENTITY_ID, "parameter-spec", "platform", "platform", GONE_LEGACY_ID],
      [CONFLICT_PLATFORM_IDENTITY_ID, "parameter-spec", "platform", "platform", CONFLICT_LEGACY_ID],
      [CONFLICT_ORG_IDENTITY_ID, "parameter-spec", "organization", ACCEPTANCE_ORGANIZATION.id, CONFLICT_LEGACY_ID],
      [SCOPE_HIDDEN_IDENTITY_ID, "parameter-spec", "organization", CATALOG_ORG_B.id, SCOPE_HIDDEN_LEGACY_ID]
    ] as const;
    for (const [id, sourceKind, ownerKind, ownerId, sourceId] of identities) {
      await client.query(
        `insert into parameter_catalog.legacy_identities (
           id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [id, LEGACY_SOURCE_SYSTEM, sourceKind, ownerKind, ownerId, sourceId]
      );
    }
    await client.query(
      `insert into parameter_catalog.parameter_catalog_archives (
         id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
         source_checksum, graph_checksum, encrypted_object_ref, protected_references,
         cutover_run_id, catalog_release_id, success_audit_ref, retain_until
       ) values (
         $1, $2, 'platform', 'platform', 'R1', 'op08 gone bookmark',
         $3, $4, 'object://op08/gone', '[]',
         $5, $6, 'audit-op08-gone', '2027-09-05T00:00:00Z'
       )
       on conflict (id) do nothing`,
      [GONE_ARCHIVE_ID, GONE_IDENTITY_ID, SOURCE_CHECKSUM, GRAPH_FINGERPRINT, CUTOVER_RUN_ID, catalogReleaseId]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const assignments: ClassificationResult["assignments"] = [
    {
      identityId: MAPPED_IDENTITY_ID,
      sourceKind: "parameter-spec",
      sourceId: MAPPED_LEGACY_ID,
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      rClass: "R4",
      ruleId: "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY",
      disposition: "mapped",
      mappingClass: "formal-definition",
      propertyKey: "iin_max"
    },
    {
      identityId: GONE_IDENTITY_ID,
      sourceKind: "parameter-spec",
      sourceId: GONE_LEGACY_ID,
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      rClass: "R1",
      ruleId: "PCAT-CLASS-R1-DISPOSABLE-SCAFFOLD",
      disposition: "archived",
      mappingClass: "legacy-semantic-store",
      propertyKey: null
    },
    {
      identityId: CONFLICT_PLATFORM_IDENTITY_ID,
      sourceKind: "parameter-spec",
      sourceId: CONFLICT_LEGACY_ID,
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      rClass: "R4",
      ruleId: "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY",
      disposition: "mapped",
      mappingClass: "formal-definition",
      propertyKey: "iin_max"
    },
    {
      identityId: CONFLICT_ORG_IDENTITY_ID,
      sourceKind: "parameter-spec",
      sourceId: CONFLICT_LEGACY_ID,
      ownerScopeKind: "organization",
      ownerScopeId: ACCEPTANCE_ORGANIZATION.id,
      rClass: "R4",
      ruleId: "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY",
      disposition: "mapped",
      mappingClass: "formal-definition",
      propertyKey: "iin_max"
    },
    {
      identityId: SCOPE_HIDDEN_IDENTITY_ID,
      sourceKind: "parameter-spec",
      sourceId: SCOPE_HIDDEN_LEGACY_ID,
      ownerScopeKind: "organization",
      ownerScopeId: CATALOG_ORG_B.id,
      rClass: "R4",
      ruleId: "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY",
      disposition: "mapped",
      mappingClass: "formal-definition",
      propertyKey: "iin_max"
    }
  ];
  const classification = classificationFor(assignments);
  const mappingClient = await pool.connect();
  try {
    const mapped = await appendMappingVersion({
      client: mappingClient,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: MAPPED_IDENTITY_ID,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: { kind: "operational", targetKind: "parameter-definition", targetId: X_DEFINITION_ID }
    });
    if (!mapped.ok && mapped.error.code !== "PCAT-MAP-CONFLICT") {
      throw new Error(`mapped bookmark failed: ${mapped.error.code} ${mapped.error.detail}`);
    }
    const gone = await appendMappingVersion({
      client: mappingClient,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: GONE_IDENTITY_ID,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: { kind: "archived", archiveId: GONE_ARCHIVE_ID }
    });
    if (!gone.ok && gone.error.code !== "PCAT-MAP-CONFLICT") {
      throw new Error(`gone bookmark failed: ${gone.error.code} ${gone.error.detail}`);
    }
    const conflictPlatform = await appendMappingVersion({
      client: mappingClient,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: CONFLICT_PLATFORM_IDENTITY_ID,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: { kind: "operational", targetKind: "parameter-definition", targetId: X_DEFINITION_ID }
    });
    if (!conflictPlatform.ok && conflictPlatform.error.code !== "PCAT-MAP-CONFLICT") {
      throw new Error(`conflict platform bookmark failed: ${conflictPlatform.error.code} ${conflictPlatform.error.detail}`);
    }
    const conflictOrg = await appendMappingVersion({
      client: mappingClient,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: CONFLICT_ORG_IDENTITY_ID,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: { kind: "operational", targetKind: "parameter-definition", targetId: Y_DEFINITION_ID }
    });
    if (!conflictOrg.ok && conflictOrg.error.code !== "PCAT-MAP-CONFLICT") {
      throw new Error(`conflict org bookmark failed: ${conflictOrg.error.code} ${conflictOrg.error.detail}`);
    }
    const hidden = await appendMappingVersion({
      client: mappingClient,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: SCOPE_HIDDEN_IDENTITY_ID,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: { kind: "operational", targetKind: "parameter-definition", targetId: X_DEFINITION_ID }
    });
    if (!hidden.ok && hidden.error.code !== "PCAT-MAP-CONFLICT") {
      throw new Error(`scope-hidden bookmark failed: ${hidden.error.code} ${hidden.error.detail}`);
    }
  } finally {
    mappingClient.release();
  }
}

export async function countSubjectRegistrations(
  pool: pg.Pool,
  organizationId: string,
  subjectId: string
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from parameter_catalog.organization_subject_registrations
      where organization_id = $1 and subject_id = $2`,
    [organizationId, subjectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function countOpenReviewItems(pool: pg.Pool, organizationId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from parameter_catalog.parameter_review_items
      where organization_id = $1 and status = 'open'`,
    [organizationId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function countProposals(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from parameter_catalog.definition_proposals`
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function latestOrganizationProposal(
  pool: pg.Pool,
  organizationId: string
): Promise<{ id: string; status: string } | null> {
  const result = await pool.query<{ id: string; status: string }>(
    `select id, status
       from parameter_catalog.definition_proposals
      where organization_id = $1
      order by created_at desc
      limit 1`,
    [organizationId]
  );
  return result.rows[0] ?? null;
}

export async function countPublicationIntents(pool: pg.Pool, proposalId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from parameter_catalog.catalog_publication_intents
      where proposal_id = $1`,
    [proposalId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function definitionHeadRevision(
  pool: pg.Pool,
  releaseId: string,
  definitionId: string
): Promise<string | null> {
  const result = await pool.query<{ revision_id: string }>(
    `select revision_id
       from parameter_catalog.catalog_release_definition_heads
      where release_id = $1 and definition_id = $2`,
    [releaseId, definitionId]
  );
  return result.rows[0]?.revision_id ?? null;
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}
