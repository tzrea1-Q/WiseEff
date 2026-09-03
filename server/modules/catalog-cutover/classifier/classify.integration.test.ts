import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import {
  CLASSIFIER_VERSION,
  classifyFrozenP0Graph,
  classifyPopulatedP0Graph,
  fingerprintP0Graph,
} from "./index";
import { FROZEN_P0_GRAPH_FIXTURE } from "./__fixtures__/p0GraphFixture";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const CUTOVER_RUN_ID = "s7cls-cutover-r0-block";

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
      [
        subject.id,
        subject.organizationId,
        subject.subjectKind,
        subject.id,
        subject.id,
      ],
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
      $1, $2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sha256:s7cls-release', $3, 'sha256:s7cls-plan', 'P6', 'running'
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

describe("populated P0 full-graph classifier", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s7cls");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    await seedFrozenP0Inventory(client);
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.close();
  }, CATALOG_HOOK_TIMEOUT_MS);

  it("classifies every seeded identity on real PostgreSQL and ledgers only R0 blockers", async () => {
    const populated = await classifyPopulatedP0Graph({
      client,
      graph: FROZEN_P0_GRAPH_FIXTURE,
      cutoverRunId: CUTOVER_RUN_ID,
    });
    if (!populated.ok) throw new Error(`${populated.error.code}: ${populated.error.detail}`);
    expect(populated.ok).toBe(true);

    const frozen = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(populated.value.assignments).toEqual(frozen.value.assignments);
    expect(populated.value.conservation.conserved).toBe(true);

    const inventory = await client.query<{ n: string }>(
      "select count(*)::bigint as n from parameter_catalog.legacy_identities",
    );
    expect(Number(inventory.rows[0]?.n)).toBe(populated.value.conservation.classifiedCount);
    expect(Number(inventory.rows[0]?.n)).toBe(FROZEN_P0_GRAPH_FIXTURE.identities.length);

    const ledger = await client.query<{
      legacy_identity_id: string;
      r_class: string;
      disposition: string;
      mapping_version_id: string | null;
      classifier_version: string;
    }>(
      `
      select legacy_identity_id, r_class, disposition, mapping_version_id, classifier_version
      from parameter_catalog.parameter_catalog_classification_ledger
      where cutover_run_id = $1
      order by legacy_identity_id
      `,
      [CUTOVER_RUN_ID],
    );
    const r0Ids = populated.value.assignments
      .filter((assignment) => assignment.rClass === "R0")
      .map((assignment) => assignment.identityId)
      .sort();
    expect(ledger.rows.map((row) => row.legacy_identity_id)).toEqual(r0Ids);
    expect(ledger.rows.every((row) => row.r_class === "R0")).toBe(true);
    expect(ledger.rows.every((row) => row.disposition === "blocked")).toBe(true);
    expect(ledger.rows.every((row) => row.mapping_version_id === null)).toBe(true);
    expect(ledger.rows.every((row) => row.classifier_version === CLASSIFIER_VERSION)).toBe(
      true,
    );

    const mappingCount = await client.query<{ n: string }>(
      "select count(*)::bigint as n from parameter_catalog.legacy_mapping_versions",
    );
    const archiveCount = await client.query<{ n: string }>(
      "select count(*)::bigint as n from parameter_catalog.parameter_catalog_archives",
    );
    expect(mappingCount.rows[0]?.n).toBe("0");
    expect(archiveCount.rows[0]?.n).toBe("0");
  });

  it("fails closed when the P0 graph samples a subset of stored identities", async () => {
    const sampled = {
      ...FROZEN_P0_GRAPH_FIXTURE,
      identities: FROZEN_P0_GRAPH_FIXTURE.identities.slice(0, 3),
    };
    const result = await classifyPopulatedP0Graph({
      client,
      graph: sampled,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-CLASS-SOURCE-CONSERVATION");
  });
});
