import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDisposableParameterCatalogDatabase,
  openIndependentCatalogSessions,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import {
  CLASSIFIER_VERSION,
  classifyFrozenP0Graph,
  fingerprintP0Graph,
  type FrozenP0Graph,
} from "../classifier";
import { FROZEN_P0_GRAPH_FIXTURE } from "../classifier/__fixtures__/p0GraphFixture";
import {
  appendMappingVersion,
  lookupProtectedIdentity,
  readCurrentMappingHead,
  rewriteMappingVersion,
  type MappingOutcome,
} from "./index";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const CUTOVER_RUN_ID = "s7map-cutover";
const CATALOG_RELEASE_ID = "crel-s7map";
const SUBJECT_ID = "csub-s7map";
const SOURCE_CHECKSUM = "sha256:s7map-source-v1";

const TARGET_R4 = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r4",
} as const satisfies MappingOutcome;
const TARGET_R4_RECLASS = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r2",
} as const satisfies MappingOutcome;
const TARGET_R2 = {
  kind: "operational",
  targetKind: "catalog-subject",
  targetId: SUBJECT_ID,
} as const satisfies MappingOutcome;
const TARGET_R5_A = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r5a",
} as const satisfies MappingOutcome;
const TARGET_R5_B = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r5b",
} as const satisfies MappingOutcome;
const TARGET_R9 = {
  kind: "operational",
  targetKind: "parameter-definition",
  targetId: "pdef-s7map-r4",
} as const satisfies MappingOutcome;
const TARGET_R3 = {
  kind: "operational",
  targetKind: "catalog-subject",
  targetId: SUBJECT_ID,
} as const satisfies MappingOutcome;
const TARGET_R1_ARCHIVE = {
  kind: "archived",
  archiveId: "archive-s7map-r1",
} as const satisfies MappingOutcome;

const requireClassified = () => {
  const classified = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
  expect(classified.ok).toBe(true);
  if (!classified.ok) throw new Error(`${classified.error.code}: ${classified.error.detail}`);
  return classified.value;
};

const reclassifiedGraph = (): FrozenP0Graph => ({
  ...FROZEN_P0_GRAPH_FIXTURE,
  specs: FROZEN_P0_GRAPH_FIXTURE.specs.map((spec) =>
    spec.id === "s7cls-spec-r10-unknown"
      ? { ...spec, specificationKey: "s7cls.r10.unknown.reclass" }
      : spec,
  ),
});

const seedFrozenP0Inventory = async (client: pg.Client): Promise<void> => {
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

    for (const registration of FROZEN_P0_GRAPH_FIXTURE.driverRegistrations) {
      await client.query(
        `
        insert into public.driver_registrations (
          attribution_subject_id, driver_nature, instance_cardinality
        ) values ($1, 'physical-device', 'multiple')
        `,
        [registration.attributionSubjectId],
      );
    }

    for (const nodeType of FROZEN_P0_GRAPH_FIXTURE.nodeTypeDefinitions) {
      await client.query(
        `
        insert into public.node_type_definitions (attribution_subject_id, bare_node_name)
        values ($1, $2)
        `,
        [nodeType.attributionSubjectId, nodeType.attributionSubjectId],
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

    for (const schema of FROZEN_P0_GRAPH_FIXTURE.driverSchemas) {
      await client.query(
        `
        insert into public.driver_schemas (
          id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id
        ) values ($1, $2, $3, $4, $5)
        `,
        [
          schema.id,
          schema.parameterSpecId,
          schema.organizationId,
          schema.id,
          schema.attributionSubjectId,
        ],
      );
    }

    for (const schemaVersion of FROZEN_P0_GRAPH_FIXTURE.driverSchemaVersions) {
      const rootVersion = FROZEN_P0_GRAPH_FIXTURE.specVersions.find((version) => {
        const schema = FROZEN_P0_GRAPH_FIXTURE.driverSchemas.find(
          (candidate) => candidate.id === schemaVersion.driverSchemaId,
        );
        return schema?.parameterSpecId === version.parameterSpecId;
      });
      await client.query(
        `
        insert into public.driver_schema_versions (
          id, driver_schema_id, parameter_spec_version_id, version,
          compatible_patterns, parent_bus_constraints, source, lifecycle
        ) values ($1, $2, $3, 1, '[]', '{}', 'manual', $4)
        `,
        [
          schemaVersion.id,
          schemaVersion.driverSchemaId,
          rootVersion?.id ?? "s7cls-ver-r2-root",
          schemaVersion.lifecycle,
        ],
      );
    }

    for (const property of FROZEN_P0_GRAPH_FIXTURE.dtsPropertySpecs) {
      await client.query(
        `
        insert into public.dts_property_specs (
          id, parameter_spec_id, driver_schema_id, property_key, schema_namespace
        ) values ($1, $2, $3, $4, $5)
        `,
        [
          property.id,
          property.parameterSpecId,
          property.driverSchemaId,
          property.propertyKey,
          property.id,
        ],
      );
    }

    for (const module of FROZEN_P0_GRAPH_FIXTURE.modules) {
      await client.query(
        `
        insert into public.parameter_modules (
          id, organization_id, name, path, depth, kind, origin, attribution_subject_id
        ) values ($1, $2, $3, $4, 1, $5, $6, $7)
        `,
        [
          module.id,
          module.organizationId,
          module.name,
          module.id,
          module.kind,
          module.origin,
          module.attributionSubjectId,
        ],
      );
    }

    for (const binding of FROZEN_P0_GRAPH_FIXTURE.bindings) {
      await client.query(
        `
        insert into public.project_parameter_bindings (
          id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id
        ) values ($1, $2, 's7cls-project', 's7cls-logical-node', $3, $4)
        `,
        [binding.id, binding.organizationId, binding.parameterSpecId, binding.moduleId],
      );
    }

    for (const placement of FROZEN_P0_GRAPH_FIXTURE.placements) {
      await client.query(
        `
        insert into public.driver_registration_placements (
          id, organization_id, attribution_subject_id, driver_group_module_id,
          default_business_category_module_id
        ) values ($1, $2, $3, $4, 's7cls-mod-business')
        `,
        [
          placement.id,
          placement.organizationId,
          placement.attributionSubjectId,
          placement.driverGroupModuleId,
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
        'sha256:s7map-release', $3, 'sha256:s7map-plan', 'P7', 'running'
      )
      `,
      [CUTOVER_RUN_ID, graphFingerprint, CLASSIFIER_VERSION],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
};

const seedCatalogTargetsAndArchives = async (client: pg.Client): Promise<void> => {
  await client.query("begin");
  try {
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_sequence, release_version, release_digest, compiled_model_digest,
        toolchain_digest, published_at
      ) values (
        'crel-s7map', 17030, 's7map-1', 'sha256:s7map-release',
        'sha256:s7map-compiled', 'sha256:s7map-toolchain',
        '2026-09-03T00:00:00Z'
      );
      insert into parameter_catalog.catalog_subjects (
        id, introduced_release_id, kind, canonical_key
      ) values ('csub-s7map', 'crel-s7map', 'driver', 'vendor,s7map');
      insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
      values ('csub-s7map', 'physical-device', 'multiple');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-s7map', 'csub-s7map', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, introduced_release_id, subject_id, property_key, current_revision_id
      ) values
        ('pdef-s7map-r4', 'crel-s7map', 'csub-s7map', 's7map-r4', 'drev-s7map-r4'),
        ('pdef-s7map-r2', 'crel-s7map', 'csub-s7map', 's7map-r2', 'drev-s7map-r2'),
        ('pdef-s7map-r5a', 'crel-s7map', 'csub-s7map', 's7map-r5a', 'drev-s7map-r5a'),
        ('pdef-s7map-r5b', 'crel-s7map', 'csub-s7map', 's7map-r5b', 'drev-s7map-r5b');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values
        ('drev-s7map-r4', 'pdef-s7map-r4', 1, 'crel-s7map', 'sha256:drev-s7map-r4', '{}'),
        ('drev-s7map-r2', 'pdef-s7map-r2', 1, 'crel-s7map', 'sha256:drev-s7map-r2', '{}'),
        ('drev-s7map-r5a', 'pdef-s7map-r5a', 1, 'crel-s7map', 'sha256:drev-s7map-r5a', '{}'),
        ('drev-s7map-r5b', 'pdef-s7map-r5b', 1, 'crel-s7map', 'sha256:drev-s7map-r5b', '{}');
      insert into parameter_catalog.catalog_release_definition_heads (
        release_id, definition_id, revision_id
      ) values
        ('crel-s7map', 'pdef-s7map-r4', 'drev-s7map-r4'),
        ('crel-s7map', 'pdef-s7map-r2', 'drev-s7map-r2'),
        ('crel-s7map', 'pdef-s7map-r5a', 'drev-s7map-r5a'),
        ('crel-s7map', 'pdef-s7map-r5b', 'drev-s7map-r5b');
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
      'disposable scaffold', $1, $2, 'object://s7map/r1', '[]',
      $3, $4, 'audit-s7map-r1', '2027-09-03T00:00:00Z'
    )
    `,
    [SOURCE_CHECKSUM, graphFingerprint, CUTOVER_RUN_ID, CATALOG_RELEASE_ID],
  );
};

const countVersions = async (client: pg.Client, identityId: string): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `
    select count(*)::bigint as n
    from parameter_catalog.legacy_mapping_versions
    where legacy_identity_id = $1
    `,
    [identityId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

const countHeads = async (client: pg.Client, identityId: string): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `
    select count(*)::bigint as n
    from parameter_catalog.legacy_mapping_heads
    where legacy_identity_id = $1
    `,
    [identityId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

describe("S7-MAP append-only identity mapping", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let client: pg.Client;
  let classification = requireClassified();

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s7map");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    await seedFrozenP0Inventory(client);
    await seedCatalogTargetsAndArchives(client);
    classification = requireClassified();
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.close();
  }, CATALOG_HOOK_TIMEOUT_MS);

  it("T1/T6/T7 first mapped append is version 1, exact replay is a no-op, and lookup is exact", async () => {
    const identityId = "s7cls-lid-r4-driver";
    const first = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("appended");
    if (first.value.status !== "appended") return;
    expect(first.value.head.version.versionNumber).toBe(1);
    expect(first.value.head.casVersion).toBe(1);
    expect(first.value.head.currentVersionId).toBe(first.value.head.version.id);
    expect(first.value.head.version.targetKind).toBe("parameter-definition");
    expect(first.value.head.version.targetId).toBe(TARGET_R4.targetId);
    expect(first.value.head.version.archiveId).toBeNull();
    expect(first.value.head.version.rClass).toBe("R4");
    expect(first.value.head.version.graphFingerprint).toBe(classification.graphFingerprint);
    expect(await countVersions(client, identityId)).toBe(1);
    expect(await countHeads(client, identityId)).toBe(1);

    const replay = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.status).toBe("replayed");
    if (replay.value.status !== "replayed") return;
    expect(replay.value.head.currentVersionId).toBe(first.value.head.currentVersionId);
    expect(replay.value.head.casVersion).toBe(1);
    expect(await countVersions(client, identityId)).toBe(1);

    const byId = await lookupProtectedIdentity({
      client,
      identity: { kind: "legacy-identity-id", id: identityId },
    });
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.value.outcome).toBe("mapped");
    if (byId.value.outcome !== "mapped") return;
    expect(byId.value.targetId).toBe(TARGET_R4.targetId);
    expect(byId.value.head.currentVersionId).toBe(first.value.head.currentVersionId);

    const identity = FROZEN_P0_GRAPH_FIXTURE.identities.find((row) => row.id === identityId);
    expect(identity).toBeDefined();
    if (!identity) return;
    const byTuple = await lookupProtectedIdentity({
      client,
      identity: {
        kind: "source-tuple",
        sourceSystem: identity.sourceSystem,
        sourceKind: identity.sourceKind,
        ownerScopeKind: identity.ownerScopeKind,
        ownerScopeId: identity.ownerScopeId,
        sourceId: identity.sourceId,
      },
    });
    expect(byTuple.ok).toBe(true);
    if (!byTuple.ok) return;
    expect(byTuple.value.outcome).toBe("mapped");
    if (byTuple.value.outcome !== "mapped") return;
    expect(byTuple.value.targetId).toBe(TARGET_R4.targetId);

    const other = await lookupProtectedIdentity({
      client,
      identity: { kind: "legacy-identity-id", id: "s7cls-lid-r5-node" },
    });
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.code).toBe("PCAT-MAP-UNMAPPED");

    const missing = await lookupProtectedIdentity({
      client,
      identity: { kind: "legacy-identity-id", id: "s7map-does-not-exist" },
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("PCAT-MAP-UNKNOWN-IDENTITY");

    const otherTuple = await lookupProtectedIdentity({
      client,
      identity: {
        kind: "source-tuple",
        sourceSystem: identity.sourceSystem,
        sourceKind: identity.sourceKind,
        ownerScopeKind: identity.ownerScopeKind,
        ownerScopeId: identity.ownerScopeId,
        sourceId: "s7cls-spec-r5-node",
      },
    });
    expect(otherTuple.ok).toBe(false);
    if (otherTuple.ok) return;
    expect(otherTuple.error.code).toBe("PCAT-MAP-UNMAPPED");

    const inferred = await lookupProtectedIdentity({
      client,
      identity: {
        kind: "source-tuple",
        sourceSystem: identity.sourceSystem,
        sourceKind: identity.sourceKind,
        ownerScopeKind: identity.ownerScopeKind,
        ownerScopeId: identity.ownerScopeId,
        sourceId: "s7map-not-an-identity",
      },
    });
    expect(inferred.ok).toBe(false);
    if (inferred.ok) return;
    expect(inferred.error.code).toBe("PCAT-MAP-UNKNOWN-IDENTITY");
  });

  it("T2 reclassify appends version N+1, CAS-advances the head, and retains prior versions", async () => {
    const identityId = "s7cls-lid-r2-root";
    const first = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R2,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== "appended") return;
    const priorId = first.value.head.version.id;

    const mutated = classifyFrozenP0Graph(reclassifiedGraph());
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;
    expect(mutated.value.graphFingerprint).not.toBe(classification.graphFingerprint);
    const r2 = mutated.value.assignments.find((row) => row.identityId === identityId);
    expect(r2?.rClass).toBe("R2");

    const next = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification: mutated.value,
      identityId,
      sourceChecksum: "sha256:s7map-source-v2",
      expectedHead: {
        casVersion: first.value.head.casVersion,
        versionId: first.value.head.currentVersionId,
      },
      outcome: TARGET_R4_RECLASS,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.status).toBe("appended");
    if (next.value.status !== "appended") return;
    expect(next.value.head.version.versionNumber).toBe(2);
    expect(next.value.head.casVersion).toBe(2);
    expect(next.value.head.currentVersionId).not.toBe(priorId);
    expect(next.value.head.version.supersedesVersionId).toBe(priorId);
    expect(next.value.head.version.targetId).toBe(TARGET_R4_RECLASS.targetId);
    expect(next.value.head.version.graphFingerprint).toBe(mutated.value.graphFingerprint);
    expect(await countVersions(client, identityId)).toBe(2);

    const prior = await client.query<{ id: string; version_number: string }>(
      `
      select id, version_number::text as version_number
      from parameter_catalog.legacy_mapping_versions
      where legacy_identity_id = $1
      order by version_number
      `,
      [identityId],
    );
    expect(prior.rows.map((row) => row.id)).toEqual([priorId, next.value.head.version.id]);
    expect(prior.rows[0]?.version_number).toBe("1");

    const head = await readCurrentMappingHead({ client, identityId });
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.value.currentVersionId).toBe(next.value.head.currentVersionId);
    expect(head.value.casVersion).toBe(2);
  });

  it("T3 in-place UPDATE of a mapping version is refused and leaves the row unchanged", async () => {
    const identityId = "s7cls-lid-r9-deprecated";
    const first = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R9,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== "appended") return;

    const refused = await rewriteMappingVersion({
      client,
      versionId: first.value.head.version.id,
      patch: { targetId: "pdef-s7map-r5a", rClass: "R4" },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("PCAT-MAP-APPEND-ONLY");

    const stored = await client.query<{ target_id: string; r_class: string }>(
      `
      select target_id, r_class
      from parameter_catalog.legacy_mapping_versions
      where id = $1
      `,
      [first.value.head.version.id],
    );
    expect(stored.rows).toEqual([{ target_id: TARGET_R9.targetId, r_class: "R9" }]);
    expect(await countVersions(client, identityId)).toBe(1);
  });

  it("T4 concurrent appends racing the same head leave one winner, one conflict, and one head", async () => {
    const identityId = "s7cls-lid-r5-node";
    const sessions = await openIndependentCatalogSessions(database.url, 2);
    try {
      const [left, right] = sessions;
      const racing = await Promise.all([
        appendMappingVersion({
          client: left,
          cutoverRunId: CUTOVER_RUN_ID,
          classification,
          identityId,
          sourceChecksum: SOURCE_CHECKSUM,
          expectedHead: null,
          outcome: TARGET_R5_A,
        }),
        appendMappingVersion({
          client: right,
          cutoverRunId: CUTOVER_RUN_ID,
          classification,
          identityId,
          sourceChecksum: SOURCE_CHECKSUM,
          expectedHead: null,
          outcome: TARGET_R5_B,
        }),
      ]);
      const statuses = racing.map((result) =>
        result.ok ? result.value.status : result.error.code,
      );
      expect(statuses.sort()).toEqual(["PCAT-MAP-CONFLICT", "appended"]);
      expect(await countHeads(client, identityId)).toBe(1);
      expect(await countVersions(client, identityId)).toBe(1);
      const head = await readCurrentMappingHead({ client, identityId });
      expect(head.ok).toBe(true);
      if (!head.ok) return;
      expect([TARGET_R5_A.targetId, TARGET_R5_B.targetId]).toContain(head.value.version.targetId);
    } finally {
      await Promise.all(sessions.map((session) => session.close()));
    }
  });

  it("T5 CAS mismatch is a typed conflict and does not overwrite the current head", async () => {
    const identityId = "s7cls-lid-r3-root";
    const first = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R3,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== "appended") return;

    const stale = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: "sha256:s7map-stale",
      expectedHead: { casVersion: 0, versionId: "lmap-stale" },
      outcome: TARGET_R4,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("PCAT-MAP-CONFLICT");

    const overwrite = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: "sha256:s7map-overwrite",
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(overwrite.ok).toBe(false);
    if (overwrite.ok) return;
    expect(overwrite.error.code).toBe("PCAT-MAP-CONFLICT");

    expect(await countVersions(client, identityId)).toBe(1);
    expect(await countHeads(client, identityId)).toBe(1);
    const head = await readCurrentMappingHead({ client, identityId });
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.value.currentVersionId).toBe(first.value.head.currentVersionId);
    expect(head.value.version.targetId).toBe(TARGET_R3.targetId);
  });

  it("T8 R0 blocked classification is not stored as a successful mapped or archived head", async () => {
    const identityId = "s7cls-lid-r0-cross";
    const blocked = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R4,
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.value.status).toBe("blocked");
    if (blocked.value.status !== "blocked") return;
    expect(blocked.value.rClass).toBe("R0");
    expect(await countVersions(client, identityId)).toBe(0);
    expect(await countHeads(client, identityId)).toBe(0);

    const head = await readCurrentMappingHead({ client, identityId });
    expect(head.ok).toBe(false);
    if (head.ok) return;
    expect(head.error.code).toBe("PCAT-MAP-UNMAPPED");

    const lookup = await lookupProtectedIdentity({
      client,
      identity: { kind: "legacy-identity-id", id: identityId },
    });
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.value.outcome).toBe("blocked");
    if (lookup.value.outcome !== "blocked") return;
    expect(lookup.value.identityId).toBe(identityId);
    expect(lookup.value.rClass).toBe("R0");
  });

  it("archived disposition lookup returns the caller-supplied archive_id exactly", async () => {
    const identityId = "s7cls-lid-r1-status";
    const archived = await appendMappingVersion({
      client,
      cutoverRunId: CUTOVER_RUN_ID,
      classification,
      identityId,
      sourceChecksum: SOURCE_CHECKSUM,
      expectedHead: null,
      outcome: TARGET_R1_ARCHIVE,
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.status).toBe("appended");
    if (archived.value.status !== "appended") return;
    expect(archived.value.head.version.archiveId).toBe(TARGET_R1_ARCHIVE.archiveId);
    expect(archived.value.head.version.targetKind).toBeNull();
    expect(archived.value.head.version.targetId).toBeNull();

    const lookup = await lookupProtectedIdentity({
      client,
      identity: { kind: "legacy-identity-id", id: identityId },
    });
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.value.outcome).toBe("archived");
    if (lookup.value.outcome !== "archived") return;
    expect(lookup.value.archiveId).toBe(TARGET_R1_ARCHIVE.archiveId);
    expect(lookup.value.head.currentVersionId).toBe(archived.value.head.currentVersionId);
  });
});
