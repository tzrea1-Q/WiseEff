import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUserInvocation } from "../../auth/trustedInvocation";
import type { AuthContext } from "../../auth/types";
import {
  CLASSIFIER_VERSION,
  classifyFrozenP0Graph,
  fingerprintP0Graph,
} from "../../catalog-cutover/classifier";
import { FROZEN_P0_GRAPH_FIXTURE } from "../../catalog-cutover/classifier/__fixtures__/p0GraphFixture";
import { appendMappingVersion, type MappingOutcome } from "../../catalog-cutover/mapping";
import {
  catalogLegacyGoneResponseSchema,
  catalogLegacyIdentifierResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../../testing/parameterCatalog";

import { listenLegacyCatalogHttpServer } from "./httpServer";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const CUTOVER_RUN_ID = "s8leg-cutover";
const CATALOG_RELEASE_ID = "crel-s7map";
const SOURCE_CHECKSUM = "sha256:s8leg-source-v1";
const SUNSET = "Wed, 01 Dec 2026 00:00:00 GMT";
const ORG = "s7cls-org";

const TARGET_R4 = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r4",
} as const satisfies MappingOutcome;

const TARGET_VERSION = {
  kind: "operational",
  targetKind: "definition-revision",
  targetId: "drev-s7map-r4",
} as const satisfies MappingOutcome;

const TARGET_R1_ARCHIVE = {
  kind: "archived",
  archiveId: "archive-s7map-r1",
} as const satisfies MappingOutcome;

const TARGET_R8 = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r4",
} as const satisfies MappingOutcome;

const requireClassified = () => {
  const classified = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
  expect(classified.ok).toBe(true);
  if (!classified.ok) throw new Error(`${classified.error.code}: ${classified.error.detail}`);
  return classified.value;
};

const authFor = (organizationId: string): AuthContext => ({
  user: {
    id: `user-${organizationId}`,
    organizationId,
    name: "S8-LEG Tester",
    title: "Engineer",
    isActive: true,
  },
  organization: { id: organizationId, name: organizationId },
  roles: [{ projectId: null, roleId: "software-user" }],
  permissions: ["parameter:view"],
});

const seedCatalogAndIdentities = async (client: pg.Client): Promise<void> => {
  await client.query("begin");
  try {
    await client.query("set local session_replication_role = replica");
    await client.query(
      `
      insert into public.organizations (id, name)
      values ('s7cls-org', 'S7-CLS Synthetic Organization')
      on conflict (id) do nothing
      `,
    );

    for (const subject of FROZEN_P0_GRAPH_FIXTURE.subjects) {
      await client.query(
        `
        insert into public.attribution_subjects (
          id, organization_id, subject_kind, display_name, origin, source_key
        ) values ($1, $2, $3, $4, 'curated', $5)
        `,
        [subject.id, subject.organizationId, subject.subjectKind, subject.id, subject.id],
      );
    }

    for (const spec of FROZEN_P0_GRAPH_FIXTURE.specs) {
      await client.query(
        `
        insert into public.parameter_specs (
          id, organization_id, source_kind, specification_key,
          attribution_subject_id, definition_lifecycle, property_key
        ) values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          spec.id,
          spec.organizationId,
          spec.sourceKind,
          spec.specificationKey,
          spec.attributionSubjectId,
          spec.definitionLifecycle,
          spec.propertyKey,
        ],
      );
    }

    for (const version of FROZEN_P0_GRAPH_FIXTURE.specVersions) {
      await client.query(
        `
        insert into public.parameter_spec_versions (
          id, parameter_spec_id, version, display_name, description, value_shape,
          lifecycle, version_status
        ) values ($1, $2, $3, $4, $4, '{}', $5, $6)
        `,
        [
          version.id,
          version.parameterSpecId,
          version.version,
          version.id,
          version.lifecycle,
          version.versionStatus,
        ],
      );
    }

    for (const identity of FROZEN_P0_GRAPH_FIXTURE.identities) {
      await client.query(
        `
        insert into parameter_catalog.legacy_identities (
          id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
        ) values ($1, $2, $3, $4, $5, $6)
        `,
        [
          identity.id,
          identity.sourceSystem,
          identity.sourceKind,
          identity.ownerScopeKind,
          identity.ownerScopeId,
          identity.sourceId,
        ],
      );
    }

    const graphFingerprint = fingerprintP0Graph(FROZEN_P0_GRAPH_FIXTURE);
    await client.query(
      `
      insert into parameter_catalog.parameter_catalog_cutover_runs (
        id, source_snapshot_fingerprint, target_artifact_sha,
        target_catalog_release_digest, migration_contract_version,
        plan_digest, current_phase, state
      ) values (
        $1, $2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'sha256:s8leg-release', $3, 'sha256:s8leg-plan', 'P7', 'running'
      )
      `,
      [CUTOVER_RUN_ID, graphFingerprint, CLASSIFIER_VERSION],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }

  await client.query("begin");
  try {
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_sequence, release_version, release_digest, compiled_model_digest,
        toolchain_digest, published_at
      ) values (
        'crel-s7map', 18090, 's8leg-1', 'sha256:s8leg-release',
        'sha256:s8leg-compiled', 'sha256:s8leg-toolchain',
        '2026-09-03T00:00:00Z'
      );
      insert into parameter_catalog.catalog_subjects (
        id, introduced_release_id, kind, canonical_key
      ) values ('csub-s7map', 'crel-s7map', 'driver', 'vendor,s8leg');
      insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
      values ('csub-s7map', 'physical-device', 'multiple');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-s7map', 'csub-s7map', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, introduced_release_id, subject_id, property_key, current_revision_id
      ) values
        ('pdef-s7map-r4', 'crel-s7map', 'csub-s7map', 's8leg-r4', 'drev-s7map-r4');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values
        ('drev-s7map-r4', 'pdef-s7map-r4', 1, 'crel-s7map', 'sha256:drev-s7map-r4', '{}');
      insert into parameter_catalog.catalog_release_definition_heads (
        release_id, definition_id, revision_id
      ) values
        ('crel-s7map', 'pdef-s7map-r4', 'drev-s7map-r4');
    `);
    await client.query("set constraints all immediate");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }

  const graphFingerprint = fingerprintP0Graph(FROZEN_P0_GRAPH_FIXTURE);
  await client.query(
    `
    insert into parameter_catalog.parameter_catalog_archives (
      id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
      source_checksum, graph_checksum, encrypted_object_ref, protected_references,
      cutover_run_id, catalog_release_id, success_audit_ref, retain_until
    ) values (
      'archive-s7map-r1', 's7cls-lid-r1-status', 'platform', 'platform', 'R1',
      'disposable scaffold', $1, $2, 'object://s8leg/r1', '[]',
      $3, $4, 'audit-s8leg-r1', '2027-09-03T00:00:00Z'
    )
    `,
    [SOURCE_CHECKSUM, graphFingerprint, CUTOVER_RUN_ID, CATALOG_RELEASE_ID],
  );
};

describe("S8-LEG PG+HTTP mapping projection", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let client: pg.Client;
  let baseUrl = "";
  let closeServer: () => Promise<void> = async () => undefined;
  let invocationOrg = ORG;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s8leg");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    await seedCatalogAndIdentities(client);
    const classification = requireClassified();

    const mapped = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: "s7cls-lid-r4-driver",
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(mapped.ok).toBe(true);

    const version = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: "s7cls-lid-r4-current",
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_VERSION,
    });
    expect(version.ok).toBe(true);

    const archived = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: "s7cls-lid-r1-status",
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R1_ARCHIVE,
    });
    expect(archived.ok).toBe(true);

    const blocked = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: "s7cls-lid-r0-cross",
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(blocked.ok).toBe(true);
    if (blocked.ok) expect(blocked.value.status).toBe("blocked");

    const orgMapped = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId: "s7cls-lid-r8-twin",
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R8,
    });
    expect(orgMapped.ok).toBe(true);

    const server = await listenLegacyCatalogHttpServer({
      catalogReleaseId: CATALOG_RELEASE_ID,
      sunsetHttpDate: SUNSET,
      getQueryable: () => client,
      resolveInvocation: () => createUserInvocation(authFor(invocationOrg)),
    });
    baseUrl = server.baseUrl;
    closeServer = server.close;
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await closeServer().catch(() => undefined);
    await client?.end().catch(() => undefined);
    await database?.close();
  }, CATALOG_HOOK_TIMEOUT_MS);

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
      text,
    };
  };

  it("projects the frozen mapping head for an exact R4 spec id", async () => {
    invocationOrg = ORG;
    const result = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s7cls-spec-r4-driver");
    expect(result.status).toBe(200);
    expect(catalogLegacyIdentifierResponseSchema.safeParse(result.body).success).toBe(true);
    expect(result.body).toMatchObject({
      item: {
        legacyType: "parameter-spec",
        legacyId: "s7cls-spec-r4-driver",
        disposition: "mapped",
        target: {
          kind: "parameter-definition",
          id: "pdef-s7map-r4",
          href: "/api/v2/catalog/definitions/pdef-s7map-r4",
        },
        historicalOnly: false,
      },
    });
    expect(result.headers.get("Sunset")).toBe(SUNSET);
    expect(result.headers.get("X-WiseEff-Catalog-Release")).toBe(CATALOG_RELEASE_ID);
  });

  it("projects a spec-version onto the pinned revision without substituting current", async () => {
    const result = await request(
      "/api/v2/catalog/legacy-identifiers/parameter-spec-version/s7cls-ver-r4-current",
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      item: {
        disposition: "mapped",
        target: { kind: "definition-revision", id: "drev-s7map-r4" },
        historicalOnly: true,
      },
    });
  });

  it("returns gone/conflict/not-found without Archive or candidate disclosure", async () => {
    const archived = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s7cls-spec-r1-status");
    expect(archived.status).toBe(410);
    expect((archived.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "legacy-id-archived",
    );
    expect(archived.text).not.toContain("archive-s7map-r1");
    expect(archived.text).not.toContain("object://s8leg/r1");

    const blocked = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s7cls-spec-r0-cross");
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "legacy-id-ambiguous",
    );

    const missing = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s8leg-does-not-exist");
    expect(missing.status).toBe(404);

    const reverse = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/pdef-s7map-r4");
    expect(reverse.status).toBe(404);
  });

  it("scope-hides another Organization's mapped spec and retires writes on the live mapping", async () => {
    invocationOrg = ORG;
    const home = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s7cls-spec-r8-twin");
    expect(home.status).toBe(200);

    invocationOrg = "org-other";
    const hidden = await request("/api/v2/catalog/legacy-identifiers/parameter-spec/s7cls-spec-r8-twin");
    expect(hidden.status).toBe(404);

    invocationOrg = ORG;
    const write = await request("/api/v2/parameter-specs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "must-not-persist" }),
    });
    expect(write.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.safeParse(write.body).success).toBe(true);

    const remaining = await client.query<{ n: string }>(
      "select count(*)::text as n from parameter_catalog.legacy_mapping_heads",
    );
    expect(Number(remaining.rows[0]?.n)).toBeGreaterThan(0);
  });
});
