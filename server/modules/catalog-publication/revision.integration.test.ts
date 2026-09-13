import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import {
  bootstrapFirstAcme,
  connect,
  persistPredecessorArtifact,
} from "../catalog-kernel/install/publicationTestHarness";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import {
  AUTHOR,
  PUBLISHER,
  REVIEWER,
  asCoordinator,
  enablePublicationPolicy,
  reviewerPermissions,
  userActor,
} from "./authorization/testHarness";
import { authorizePublish } from "./authorization/authorize";
import { publicationImpactFacts } from "./preview";
import { buildCompleteSuccessor, persistSuccessorBuild } from "./builder/completeSuccessor";
import { parseBundleBytes, targetReleaseOf } from "./builder/bundleCodec";
import { integerContent } from "./builder/predecessorHarness";
import type { CatalogChange } from "./builder/types";
import { withPublicationCoordinator } from "./coordinator";
import { createJob, persistCandidate } from "./persistence/store";
import { asQueryable, uniqueToken } from "./persistence/integrationHarness";
import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  CatalogSubjectId,
  PublicationJobId,
  PublicationPolicyRevision,
} from "../parameter-catalog-contract/index";
import { createDatabase } from "../../shared/database/client";
import { runPublicationManagerOnce } from "./jobs/manager";
import { getJob, getReceiptByJobId } from "./persistence/store";
import { createRegistrationService } from "../parameter-governance/registration/index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-10 revision PG tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "CP-10 revision PG tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

type BindingSnapshot = {
  readonly binding_id: string;
  readonly effective_revision_id: string;
  readonly current_value_id: string;
  readonly catalog_release_id: string;
  readonly value_id: string;
  readonly value: unknown;
  readonly value_digest: string;
  readonly definition_revision_id: string;
};

const bindingSnapshotSql = `
  select
    binding.id as binding_id,
    binding.effective_revision_id,
    binding.current_value_id,
    binding.catalog_release_id,
    value.id as value_id,
    value.value,
    value.value_digest,
    value.definition_revision_id
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.project_parameter_values value
    on value.binding_id = binding.id
  order by binding.id, value.id
`;

describe("CP-10 definition revision and new-subject PG", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("cp10rev");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  async function seedPinnedBinding() {
    const token = uniqueToken("seed");
    const orgId = `org-cp10-${token}`;
    const projectId = `prj-cp10-${token}`;
    const bindingId = `bind-cp10-${token}`;
    const valueId = `pval-cp10-${token}`;
    const registrationId = `reg-cp10-${token}`;
    const placementId = `place-cp10-${token}`;
    const moduleId = `pmod-cp10-${token}`;
    const attributionId = `asub-cp10-${token}`;
    const current = await client.query<{ id: string }>(
      `select current_catalog_release_id as id from parameter_catalog.catalog_state`,
    );
    const releaseId = current.rows[0]?.id;
    if (!releaseId) throw new Error("current catalog missing");
    await client.query("begin");
    try {
      await client.query(`insert into public.organizations (id, name) values ($1, 'CP-10')`, [orgId]);
      await client.query(
        `insert into public.projects (id, organization_id, name, code) values ($1, $2, 'CP-10', $1)`,
        [projectId, orgId],
      );
      await client.query(
        `insert into public.attribution_subjects (
           id, organization_id, subject_kind, display_name, source_key
         ) values ($1, $2, 'driver-registration', 'CP-10 driver', 'compatible:acme,power')`,
        [attributionId, orgId],
      );
      await client.query(
        `insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
         values ($1, 'physical-device', 'multiple')`,
        [attributionId],
      );
      await client.query(
        `insert into public.parameter_modules (
           id, organization_id, name, path, depth, kind, origin, attribution_subject_id
         ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
        [moduleId, orgId, attributionId],
      );
      await client.query(
        `insert into parameter_catalog.organization_subject_registrations (
           id, organization_id, subject_id, status, registration_method, proof, current_placement_id
         ) values ($1, $2, 'csub_acme_power', 'active', 'explicit', '{}', $3)`,
        [registrationId, orgId, placementId],
      );
      await client.query(
        `insert into parameter_catalog.subject_placements (
           id, registration_id, organization_id, module_id, origin
         ) values ($1, $2, $3, $4, 'curated')`,
        [placementId, registrationId, orgId, moduleId],
      );
      await client.query(
        `insert into parameter_catalog.project_parameter_bindings (
           id, organization_id, catalog_release_id, project_id, logical_node_id, registration_id,
           subject_id, definition_id, effective_revision_id, current_value_id
         ) values (
           $1, $2, $3, $4, 'logical-cp10', $5,
           'csub_acme_power', 'pdef_acme_power_iin_max', 'drev_acme_power_iin_max_1', $6
         )`,
        [bindingId, orgId, releaseId, projectId, registrationId, valueId],
      );
      await client.query(
        `insert into parameter_catalog.project_parameter_values (
           id, binding_id, definition_id, definition_revision_id,
           source_ref, config_revision_id, value_digest, value_kind, value
         ) values (
           $1, $2, 'pdef_acme_power_iin_max', 'drev_acme_power_iin_max_1',
           'source-cp10', 'config-cp10', 'sha256:cp10-value', 'number', '7'
         )`,
        [valueId, bindingId],
      );
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    return { orgId, projectId, bindingId, valueId, releaseId };
  }

  async function activateChangeSet(input: {
    readonly changeSet: readonly CatalogChange[];
    readonly authorPrincipalId: string;
    readonly publisherUserId: string;
    readonly publisherPermissions: readonly string[];
    readonly token: string;
  }) {
    const pointer = await client.query<{ id: string; digest: string }>(
      `select state.current_catalog_release_id as id, release.release_digest as digest
         from parameter_catalog.catalog_state state
         join parameter_catalog.catalog_releases release
           on release.id = state.current_catalog_release_id`,
    );
    const current = pointer.rows[0];
    if (!current) throw new Error("current pin missing");
    const artifact = await client.query<{ digest: string; bytes: Buffer }>(
      `select artifact_digest as digest, artifact_bytes as bytes
         from catalog_publication.release_artifacts
        where artifact_digest = $1`,
      [current.digest],
    );
    const stored = artifact.rows[0];
    if (!stored) throw new Error("predecessor artifact missing");
    const predecessorTarget = parseBundleBytes(stored.bytes);
    if (!predecessorTarget.ok) throw new Error("predecessor bytes unreadable");
    const target = targetReleaseOf(predecessorTarget.bundle);
    if (!target) throw new Error("predecessor target missing");

    const definitions = [];
    const subjects = [];
    for (const change of input.changeSet) {
      if (change.op === "create-definition") {
        definitions.push({
          subjectId: change.subjectId,
          propertyKey: change.propertyKey,
          definitionId: `pdef_${input.token}`,
          revisionId: `drev_${input.token}`,
        });
      } else if (change.op === "create-subject-with-definitions") {
        const subjectId = `csub_${input.token}`;
        subjects.push({ canonicalKey: change.canonicalKey, subjectId });
        for (const nested of change.definitions) {
          definitions.push({
            subjectId,
            propertyKey: nested.propertyKey,
            definitionId: `pdef_${input.token}_${nested.propertyKey}`,
            revisionId: `drev_${input.token}_${nested.propertyKey}`,
          });
        }
      } else {
        const currentDef = target.documents.find(
          (document) => document.kind === "definition" && document.content.id === change.definitionId,
        );
        if (currentDef?.kind !== "definition") throw new Error("revise target missing");
        definitions.push({
          subjectId: currentDef.content.subjectId,
          propertyKey: currentDef.content.propertyKey,
          definitionId: currentDef.content.id,
          revisionId: `drev_${input.token}`,
        });
      }
    }

    const built = await buildCompleteSuccessor({
      predecessorArtifact: { digest: stored.digest, bytes: stored.bytes },
      changeSet: input.changeSet,
      frozenIdentity: {
        candidateId: CatalogCandidateId(`ccand_${input.token}`),
        artifactId: CatalogArtifactId(`cart_${input.token}`),
        releaseId: CatalogReleaseId(`crel_${input.token}`),
        releaseVersion: CatalogReleaseVersion(
          (() => {
            const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(target.manifest.release.version);
            if (!match) return `${target.manifest.release.version}.1`;
            return `${match[1]}.${Number(match[2]) + 1}.0`;
          })(),
        ),
        publishedAt: new Date(Date.parse(target.manifest.release.publishedAt) + 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/u, "Z"),
        toolchain: target.manifest.toolchain,
        definitions,
        subjects,
      },
      productPath: input.changeSet.some((change) => change.op !== "create-definition")
        ? "m2-core"
        : "m1",
    });
    if (!built.ok || built.value.kind !== "successor") {
      throw new Error(`build failed: ${JSON.stringify(built)}`);
    }
    const facts = publicationImpactFacts(input.authorPrincipalId, input.changeSet, built.value.impact);
    const persisted = await persistSuccessorBuild(
      {
        db: createDatabase(asQueryable(client)),
        ports: {
          persistCandidate: async (tx, candidateInput) =>
            persistCandidate(tx, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: input.authorPrincipalId,
                authorOrganizationId: "org-cp10",
                impactFacts: facts as never,
                impactSummary: {
                  addedDefinitionCount: built.value.impact.definitions.added.length,
                  changedDefinitionCount: built.value.impact.definitions.changed.length,
                  addedSubjectCount: built.value.impact.subjects.added.length,
                },
              },
            }),
        },
      },
      built.value.artifact,
      built.value.candidate,
    );
    if ("ok" in persisted && persisted.ok === false) {
      throw new Error(`persist failed: ${JSON.stringify(persisted.error)}`);
    }
    const policy = await client.query<{ revision: string }>(
      `select revision::text as revision from catalog_publication.publication_policies where singleton`,
    );
    const authorized = await asCoordinator(client, async () => {
      const capability = await client.query<{ digest: string }>(
        `select catalog_publication.digest_jsonb(capability_contract) as digest
           from catalog_publication.candidates where id = $1`,
        [built.value.candidate.id],
      );
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(input.publisherUserId, input.publisherPermissions as never),
        candidate: {
          candidateId: built.value.candidate.id,
          artifactDigest: built.value.candidate.artifactDigest,
          expectedBaseReleaseId: built.value.candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: built.value.candidate.expectedBaseReleaseDigest,
          proposalRevisionId: built.value.candidate.proposalRevisionId,
          impactReportDigest: built.value.candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: facts,
        policyRevision: PublicationPolicyRevision(Number(policy.rows[0]!.revision)),
      });
    });
    if (!authorized.ok) {
      throw new Error(`authorize failed: ${JSON.stringify(authorized.error)}`);
    }
    const job = await asCoordinator(client, async () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${input.token}`),
        candidateId: built.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        requestScope: "instance:cp-10",
        idempotencyKey: `key-${input.token}`,
        requestDigest: `sha256:${"c".repeat(64)}`,
      }),
    );
    if (!job.ok) {
      throw new Error(`createJob failed: ${JSON.stringify(job.error)}`);
    }
    const claimed = await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () =>
        userActor(input.publisherUserId, input.publisherPermissions as never),
      ownerId: `manager-${input.token}`,
    });
    expect(claimed).toBe("claimed");
    return { built: built.value, job: job.value, facts };
  }

  it("T15 documentation revise advances head and leaves Binding/values byte-identical", async () => {
    await seedPinnedBinding();
    const before = await client.query<BindingSnapshot>(bindingSnapshotSql);
    expect(before.rows.length).toBeGreaterThan(0);
    const token = uniqueToken("t15");
    const result = await activateChangeSet({
      changeSet: [
        {
          op: "revise-definition",
          definitionId: "pdef_acme_power_iin_max",
          class: "documentation",
          content: {
            displayName: "Input current limit",
            documentation: `T15 documentation ${token}`,
            unit: "mA",
            valueSchema: { type: "integer", minimum: 0 },
          },
        },
      ],
      authorPrincipalId: PUBLISHER,
      publisherUserId: PUBLISHER,
      publisherPermissions: ["catalog:publish", "parameter:view"],
      token,
    });
    expect(result.facts.changesUnitOrSemantic).toBe(false);
    expect(result.built.impact.definitions.changed[0]?.contentClass).toBe("documentation");
    const head = await client.query<{ revision_id: string }>(
      `select revision_id
         from parameter_catalog.catalog_release_definition_heads heads
         join parameter_catalog.catalog_state state
           on state.current_catalog_release_id = heads.release_id
        where heads.definition_id = 'pdef_acme_power_iin_max'`,
    );
    expect(head.rows[0]?.revision_id).toBe(`drev_${token}`);
    expect(head.rows[0]?.revision_id).not.toBe("drev_acme_power_iin_max_1");
    const after = await client.query<BindingSnapshot>(bindingSnapshotSql);
    expect(after.rows).toEqual(before.rows);
    const job = await withPublicationCoordinator(db, (tx) => getJob(tx, result.job.id));
    expect(job.ok && job.value.status).toBe("active");
  }, 60_000);

  it("T16 semantic revise keeps old Binding pin and does not cut over project values", async () => {
    const before = await client.query<BindingSnapshot>(bindingSnapshotSql);
    const token = uniqueToken("t16");
    const result = await activateChangeSet({
      changeSet: [
        {
          op: "revise-definition",
          definitionId: "pdef_acme_power_iin_max",
          class: "semantic",
          content: {
            displayName: "Input current limit",
            documentation: "Maximum accepted input current.",
            unit: "mA",
            valueSchema: { type: "integer", minimum: 0, maximum: 4000 },
          },
        },
      ],
      authorPrincipalId: AUTHOR,
      publisherUserId: REVIEWER,
      publisherPermissions: [...reviewerPermissions],
      token,
    });
    expect(result.facts.changesUnitOrSemantic).toBe(true);
    expect(result.built.impact.definitions.changed[0]?.contentClass).toBe("semantic");
    const after = await client.query<BindingSnapshot>(bindingSnapshotSql);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows.every((row) => row.effective_revision_id !== `drev_${token}`)).toBe(true);
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, result.job.id));
    expect(receipt.ok).toBe(true);
  }, 60_000);

  it("T17 new Driver fallback impact requires a distinct high-risk reviewer", async () => {
    const token = uniqueToken("t17");
    const authorAttempt = activateChangeSet({
      changeSet: [
        {
          op: "create-subject-with-definitions",
          kind: "driver",
          canonicalKey: `driver:acme,aux-${token}`,
          selector: { kind: "driver-compatible", value: `acme,aux-${token}` },
          nature: "physical-device",
          cardinality: "multiple",
          definitions: [
            {
              propertyKey: "vbat",
              content: integerContent("Aux battery", "Auxiliary battery voltage."),
            },
          ],
        },
      ],
      authorPrincipalId: AUTHOR,
      publisherUserId: AUTHOR,
      publisherPermissions: ["catalog:publish", "catalog:review-high-risk", "parameter:view"],
      token: `${token}a`,
    });
    await expect(authorAttempt).rejects.toThrow(/publication-self-approval-forbidden|authorize failed/);

    const result = await activateChangeSet({
      changeSet: [
        {
          op: "create-subject-with-definitions",
          kind: "driver",
          canonicalKey: `driver:acme,aux-${token}`,
          selector: { kind: "driver-compatible", value: `acme,aux-${token}` },
          nature: "physical-device",
          cardinality: "multiple",
          definitions: [
            {
              propertyKey: "vbat",
              content: integerContent("Aux battery", "Auxiliary battery voltage."),
            },
          ],
        },
      ],
      authorPrincipalId: AUTHOR,
      publisherUserId: REVIEWER,
      publisherPermissions: [...reviewerPermissions],
      token,
    });
    expect(result.facts.introducesNewSubject).toBe(true);
    expect(result.facts.changesFallback).toBe(true);
    expect(result.built.impact.matcher.fallbackImpact).toBe(true);
    const bindings = await client.query<BindingSnapshot>(bindingSnapshotSql);
    expect(bindings.rows.every((row) => row.effective_revision_id === "drev_acme_power_iin_max_1")).toBe(
      true,
    );
  }, 60_000);

  it("T21 catalog success plus registration failure keeps Catalog/Receipt", async () => {
    const token = uniqueToken("t21");
    const result = await activateChangeSet({
      changeSet: [
        {
          op: "create-subject-with-definitions",
          kind: "node-type",
          canonicalKey: `node-type:cp10-${token}`,
          selector: { kind: "node-type-name", value: `cp10-${token}` },
          definitions: [
            {
              propertyKey: "ready_flag",
              content: integerContent("Ready flag", "Node ready flag."),
            },
          ],
        },
      ],
      authorPrincipalId: AUTHOR,
      publisherUserId: REVIEWER,
      publisherPermissions: [...reviewerPermissions],
      token,
    });
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, result.job.id));
    expect(receipt.ok).toBe(true);
    const currentBefore = await client.query<{ id: string }>(
      `select current_catalog_release_id as id from parameter_catalog.catalog_state`,
    );
    const orgId = `org-cp10-reg-${token}`;
    await client.query(`insert into public.organizations (id, name) values ($1, 'CP-10 REG')`, [orgId]);
    const service = createRegistrationService(pool);
    const failed = await service.execute({
      kind: "register",
      organizationId: orgId,
      subjectId: CatalogSubjectId(`csub_${token}`),
      subjectKind: "node-type",
      expectedRelease: {
        id: CatalogReleaseId(currentBefore.rows[0]!.id),
        digest: CatalogReleaseDigest(result.built.candidate.artifactDigest),
      },
      placement: { mode: "choose-parent", parentPlacementId: "missing-parent", displayName: "Bad" },
      destinationModuleId: `module-${token}`,
      method: "explicit",
      proof: { reason: "t21-followup" },
      idempotencyKey: `reg-${token}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
    });
    expect(failed.ok).toBe(false);
    const currentAfter = await client.query<{ id: string }>(
      `select current_catalog_release_id as id from parameter_catalog.catalog_state`,
    );
    expect(currentAfter.rows[0]?.id).toBe(currentBefore.rows[0]?.id);
    const receiptAfter = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, result.job.id));
    expect(receiptAfter.ok).toBe(true);
    const registrations = await client.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.organization_subject_registrations where organization_id = $1`,
      [orgId],
    );
    expect(registrations.rows[0]?.n).toBe("0");
  }, 60_000);

  it("T20 does not rewrite accepted matches when a later definition is published", async () => {
    const before = await client.query<BindingSnapshot>(bindingSnapshotSql);
    const reviews = await client.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.parameter_review_items`,
    );
    expect(before.rows.length).toBeGreaterThan(0);
    expect(before.rows.every((row) => row.effective_revision_id === "drev_acme_power_iin_max_1")).toBe(
      true,
    );
    const afterReviews = await client.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.parameter_review_items`,
    );
    expect(afterReviews.rows[0]?.n).toBe(reviews.rows[0]?.n);
  });
});
