import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { seedPublishedCatalog } from "../../testing/parameterCatalog/seedPublishedCatalog";
import { createRetirementTestHarness } from "../../testing/parameterCatalog/retirementHarness";
import { seedHistoricalSingletonMapping } from "../../testing/parameterCatalog/driverSource";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { catalogDriverCompatibleDiscoveryResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { seedBaselinePlatformRoles } from "../auth/baselineCatalog";
import { ensureLocalPostCutoverIdentity } from "./localPostCutover";

const organizationId = "t1066_consumers_org";
const projectId = "t1066_consumers_project";
const userId = "t1066_consumers_user";
const configSetId = "t1066_consumers_config";
const overlayCompatible = "t1066,overlay-only";
const legacyTables = ["driver_schema_overlays", "driver_schema_overlay_properties", "driver_schema_overlay_promotions"];

function disposableDatabaseOverride(value: string | undefined, sourceUrls: Array<string | undefined>) {
  const override = value?.trim() || undefined;
  if (override && sourceUrls.some(source => source &&
    decodeURIComponent(new URL(source).pathname) === decodeURIComponent(new URL(override).pathname))) {
    throw new Error("WISEEFF_TEST_EPHEMERAL_DATABASE_URL must be a disposable database distinct from the source lane.");
  }
  return override;
}

describe("disposable database override isolation", () => {
  const source = "postgres://wiseeff:wiseeff@127.0.0.1:55438/t1066";
  it.each([undefined, "", "   "])("treats absent or blank input as no override: %j", (value) => {
    expect(disposableDatabaseOverride(value, [source])).toBeUndefined();
  });
  it.each([
    "postgres://other:password@127.0.0.1:55438/t1066?application_name=override",
    "postgres://wiseeff:wiseeff@localhost:55438/t1066",
  ])("rejects another URL for the source database: %s", (value) => {
    expect(() => disposableDatabaseOverride(value, [source])).toThrow("distinct from the source lane");
  });
  it("accepts a different disposable database", () => {
    const value = "postgres://wiseeff:wiseeff@127.0.0.1:55438/t1066_disposable";
    expect(disposableDatabaseOverride(value, [source])).toBe(value);
  });
});

describe("assembled coverage and ingest ignore historical overlays on PostgreSQL", () => {
  let db: RootDatabase;
  let ephemeralDatabase: EphemeralTestDatabase | undefined;
  let storageDirectory: string;
  let harness: ReturnType<typeof createRetirementTestHarness>;

  beforeAll(async () => {
    const override = disposableDatabaseOverride(process.env.WISEEFF_TEST_EPHEMERAL_DATABASE_URL,
      [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL]);
    if (!override) ephemeralDatabase = await createEphemeralTestDatabase("overlays");
    const url = override ?? ephemeralDatabase!.url;
    db = createPostgresDatabase(url);
    const pool = getRootPostgresPool(db);
    if (!pool) throw new Error("Coverage and ingest require a native PostgreSQL pool.");
    await ensureLocalPostCutoverIdentity(db);
    await seedPublishedCatalog(pool);
    await seedBaselinePlatformRoles(db);
    storageDirectory = await mkdtemp(join(tmpdir(), "t1066_overlay_consumers-"));
    await db.query(`insert into organizations (id, name) values ($1, 'Overlay consumers')`, [organizationId]);
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'Consumer Admin', 't1066_consumers@example.com', 'Admin', true)`, [userId, organizationId]);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id, project_id)
      values ('t1066_consumers_role', $1, $2, 'admin', null)`, [userId, organizationId]);
    await db.query(`insert into projects (id, organization_id, name, code, status)
      values ($1, $2, 'Overlay consumers', 'T1066', 'initialized')`, [projectId, organizationId]);
    await db.query(`insert into dts_config_set (id, organization_id, project_id, name)
      values ($1, $2, $3, 'Overlay consumers')`, [configSetId, organizationId, projectId]);
    await seedHistoricalSingletonMapping(db, { organizationId, moduleId: "t1066_consumers_driver", compatible: "sc8562" });
    await db.query(`update driver_registrations set instance_cardinality = 'multiple'
      where attribution_subject_id = 't1066_consumers_driver-subject'`);
    await db.query(`insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value)
      values ('t1066_consumers_mapping_overlay', $1, 't1066_consumers_driver', 'compatible', $2)`, [organizationId, overlayCompatible]);
    await db.query(`insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ('t1066_consumers_spec', $1, 'manual', 'manual/t1066_consumers')`, [organizationId]);
    await db.query(`insert into parameter_spec_versions
      (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
      values ('t1066_consumers_spec_v1', 't1066_consumers_spec', 1, 'Historical', 'Historical', '{"kind":"string"}', 'active')`);
    for (const [id, owner, compatible, lifecycle] of [
      ["t1066_consumers_org_overlay", organizationId, "sc8562", "active"],
      ["t1066_consumers_platform_overlay", null, "sc8562", "active"],
      ["t1066_consumers_overlay_only", organizationId, overlayCompatible, "active"],
      ["t1066_consumers_promoted", organizationId, "sc8562", "superseded"],
    ]) {
      await db.query(`insert into driver_schema_overlays (id, organization_id, compatible, display_name, lifecycle)
        values ($1, $2, $3, 'Historical overlay', $4)`, [id, owner, compatible, lifecycle]);
      await db.query(`insert into driver_schema_overlay_properties (id, driver_schema_overlay_id, parameter_spec_id, property_key)
        values ($1, $2, 't1066_consumers_spec', $3)`, [`${id}_property`, id, compatible === "sc8562" ? "ic_role" : "t1066_overlay_value"]);
    }
    await db.query(`update driver_schema_overlays set superseded_by_schema_id = 't1066_consumers_platform_overlay'
      where id = 't1066_consumers_promoted'`);
    harness = createRetirementTestHarness({ db, legacyTables, objectStore: createLocalObjectStore(storageDirectory) });
  });

  afterAll(async () => {
    await db?.close();
    await ephemeralDatabase?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    expect(await resolveParameterIdentityMode(db)).toBe("semantic");
  });

  async function history() {
    const rows = [];
    for (const table of legacyTables) rows.push((await db.query(`select * from ${table} where id like 't1066_consumers_%' order by id`)).rows);
    return rows;
  }

  it("returns only pinned coverage despite active org/platform and superseded overlays", async () => {
    const before = await history();
    const response = await requestJson<{ items: Array<{ moduleId: string; parseCoverages: unknown[] }> }>(
      harness.server, "/api/v2/parameter-modules/driver-registry", { headers: { "X-WiseEff-User": userId } },
    );
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body.items.find((item) => item.moduleId === "t1066_consumers_driver")?.parseCoverages).toEqual([
      { compatible: "sc8562", coverage: { covered: true, driverId: "driver:wiseeff/sc8562.yaml:v1", pattern: "sc8562", source: "vendor", scope: "platform" } },
      { compatible: overlayCompatible, coverage: { covered: false } },
    ]);
    expect(await history()).toEqual(before);
  });

  it("ingests pinned nodes without materializing an overlay-only driver or copying history", async () => {
    const before = await history();
    const catalogBefore = (await db.query(`select id, subject_id, property_key, current_revision_id
      from parameter_catalog.parameter_definitions order by id`)).rows;
    const source = `/dts-v1/;
/ {
  pinned {
    compatible = "sc8562";
    ic_role = <1>;
  };
  historical {
    compatible = "${overlayCompatible}";
  };
};\n`;
    await db.query(`insert into project_parameter_files
      (id, organization_id, project_id, file_name, format, enabled, config_set_id, config_set_role, config_set_sort_order)
      values ('t1066_consumers_file', $1, $2, 't1066_consumers.dts', 'dts', true, $3, 'base', 0)`, [organizationId, projectId, configSetId]);
    await db.query(`insert into project_parameter_file_versions
      (id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id)
      values ('t1066_consumers_file_v1', 't1066_consumers_file', 1, 't1066_consumers.dts', $1, $2, '{}', 'upload', $3)`,
    [createHash("sha256").update(source).digest("hex"), Buffer.byteLength(source), userId]);
    const upload = await requestJson(harness.server,
      `/api/v1/projects/${projectId}/parameter-files/t1066_consumers_file/versions`, {
        method: "POST", headers: { "X-WiseEff-User": userId },
        body: JSON.stringify({ contentBase64: Buffer.from(source).toString("base64") }),
      });
    expect(upload.status, upload.bodyText).toBe(201);
    const revisions = await requestJson<{ items: Array<{ id: string }> }>(harness.server,
      `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions`, { headers: { "X-WiseEff-User": userId } });
    expect(revisions.status, revisions.bodyText).toBe(200);
    expect(revisions.body.items).toHaveLength(1);
    const revision = revisions.body.items[0]!;
    const response = await requestJson<{ item: { nodes: Array<{ locator: string }> } }>(harness.server,
      `/api/v2/projects/${projectId}/config-sets/${configSetId}/revisions/${revision.id}/topology`,
      { headers: { "X-WiseEff-User": userId } });
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body.item.nodes.map((node) => node.locator)).toEqual(["/", "/historical", "/pinned"]);
    const matches = await db.query<{ node_locator: string; driver_schema_version_id: string | null }>(
      `select node_locator, driver_schema_version_id from dts_logical_node_revisions
       where config_revision_id = $1 and node_locator in ('/historical', '/pinned') order by node_locator`, [revision.id]);
    expect(matches.rows).toEqual([
      { node_locator: "/historical", driver_schema_version_id: null },
      { node_locator: "/pinned", driver_schema_version_id: null },
    ]);
    const discovery = await requestJson(harness.server,
      `/api/v2/organizations/${organizationId}/driver-compatible-discovery?projectId=${projectId}`,
      { headers: { "X-WiseEff-User": userId } });
    expect(discovery.status, discovery.bodyText).toBe(200);
    const page = catalogDriverCompatibleDiscoveryResponseSchema.parse(discovery.body);
    expect(page.status).toBe("ready");
    if (page.status !== "ready") throw new Error("Published Catalog must remain available");
    expect(discovery.headers.get("X-WiseEff-Catalog-Release")).toBe(page.catalogRelease.id);
    expect(page.items.flatMap((item) => item.compatibles)).toEqual(expect.arrayContaining([
      { compatible: "sc8562", candidate: { kind: "recognized", subjectId: "csub_drv_sc8562", registrationId: null } },
      { compatible: overlayCompatible, candidate: { kind: "review-required", reason: "unknown", reviewItemIds: [expect.any(String)] } },
    ]));
    expect(await history()).toEqual(before);
    expect((await db.query(`select id, subject_id, property_key, current_revision_id
      from parameter_catalog.parameter_definitions order by id`)).rows).toEqual(catalogBefore);
  });
});
