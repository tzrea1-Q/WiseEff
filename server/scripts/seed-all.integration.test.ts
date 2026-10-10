import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runAllSeedScripts } from "../../scripts/seed-all";
import { createWiseEffServer } from "../app";
import { createPostgresDatabase, type RootDatabase } from "../shared/database/client";
import { requestJson } from "../test/testClient";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testing/testDatabase";
import { maybeEnsureLocalPostCutoverOnApiBoot } from "../modules/parameter-topology/localPostCutover";
import { seedQualityCanonicalBindings, seedQualityVisualReview } from "../../scripts/seed-quality-visual-review";
import { createLocalObjectStore } from "../modules/logs/objectStore";

let database: EphemeralTestDatabase;
let db: RootDatabase;
const storage = mkdtempSync(path.join(tmpdir(), "t1088-seed-"));
const seed = () => runAllSeedScripts({
  ...process.env, DATABASE_URL: database.url, TEST_DATABASE_URL: database.url,
  OBJECT_STORE_ROOT: storage, NODE_ENV: "development",
  WISEEFF_SEED_LEGACY_FLAT_IDENTITY: "1",
});

beforeAll(async () => {
  database = await createEphemeralTestDatabase("canonicalseed");
  db = createPostgresDatabase(database.url);
  await seed();
}, 300_000);

afterAll(async () => {
  await db?.close();
  await database?.drop();
  rmSync(storage, { recursive: true, force: true });
});

it("seeds twice through canonical owners without legacy rows and serves seeded history", async () => {
  const counts = async () => (await db.query<Record<string, number>>(`select
    (select count(*)::int from parameter_catalog.catalog_releases) as catalog,
    (select count(*)::int from parameter_catalog.parameter_definitions) as definitions,
    (select count(*)::int from parameter_catalog.definition_revisions) as revisions,
    (select count(*)::int from parameter_catalog.project_parameter_bindings) as bindings,
    (select count(*)::int from parameter_catalog.project_parameter_values) as values,
    (select count(*)::int from parameter_catalog.binding_history_events) as history,
    (select count(*)::int from dts_config_revisions) as source_revisions,
    (select count(*)::int from project_parameter_file_versions) as source_versions,
    (select count(*)::int from parameter_specs) as legacy_specs,
    (select count(*)::int from project_parameter_bindings) as legacy_bindings,
    (select count(*)::int from parameter_definitions) as legacy_definitions,
    (select count(*)::int from project_parameter_values) as legacy_values`)).rows[0]!;
  const first = await counts();
  expect(first).toMatchObject({ legacy_specs: 0, legacy_bindings: 0, legacy_definitions: 0, legacy_values: 0 });
  for (const field of ["catalog", "definitions", "revisions", "bindings", "values", "history"]) {
    expect(first[field], field).toBeGreaterThan(0);
  }
  expect(await maybeEnsureLocalPostCutoverOnApiBoot(db, { NODE_ENV: "development" })).toEqual({ status: "skipped" });
  expect((await db.query("select count(*)::int as count from parameter_identity_migration_runs")).rows).toEqual([{ count: 0 }]);
  await seed();
  expect(await counts()).toEqual(first);
  expect((await db.query("select count(*)::int as count from dts_config_revisions where project_id = 'aurora'")).rows).toEqual([{ count: 2 }]);
  const server = createWiseEffServer({ db });
  const headers = { "X-WiseEff-User": "u-xu-yun" };
  const list = await requestJson<{ items: Array<{ id: string; propertyKey: string; rawValue: string }> }>(
    server, "/api/v2/projects/aurora/parameter-bindings?limit=500", { headers });
  expect(list.status, list.bodyText).toBe(200);
  const binding = list.body.items.find((item) => item.propertyKey === "watchdog_time");
  expect(binding).toMatchObject({ rawValue: "<6000>" });
  const history = await requestJson<{ items: unknown[] }>(server, `/api/v1/parameters/${binding!.id}/history`, { headers });
  expect(history.status, history.bodyText).toBe(200);
  expect(history.body.items.length).toBeGreaterThanOrEqual(2);
  const values = await db.query<{ value: unknown }>("select value from parameter_catalog.project_parameter_values where binding_id = $1 order by created_at", [binding!.id]);
  expect(values.rows).toEqual([{ value: {} }, { value: 5000 }, { value: 6000 }]);
  const source = await db.query<{ storage_key: string; version_number: number; index_length: number }>(`select
    version.storage_key, version.version_number, length(version.parsed_index::text)::int as index_length
    from project_parameter_files file join project_parameter_file_versions version on version.id = file.current_version_id
    where file.project_id = 'aurora' and file.file_name = 'aurora-board.dts'`);
  expect(source.rows[0]).toMatchObject({ version_number: 2, index_length: expect.any(Number) });
  expect(source.rows[0]!.index_length).toBeGreaterThan(2);
  expect((await createLocalObjectStore(storage).get(source.rows[0]!.storage_key)).toString("utf8")).toContain("watchdog_time = <6000>;");
  const placement = await db.query<{ kind: string; module_id: string; logical_node_id: string }>(`select
    module.kind, placement.module_id, binding.logical_node_id
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.organization_subject_registrations registration on registration.id = binding.registration_id
    left join parameter_catalog.subject_placements placement on placement.registration_id = registration.id
    left join parameter_modules module on module.id = placement.module_id
    where binding.project_id = 'aurora'`);
  expect(placement.rows.length).toBeGreaterThan(0);
  expect(placement.rows.every((row) => row.module_id !== null)).toBe(true);
  expect(new Set(placement.rows.map((row) => row.kind))).toEqual(new Set(["driver-group", "node-type"]));
  expect(new Set(placement.rows.map((row) => row.module_id)).size).toBeGreaterThan(1);
  const instances = await db.query<{ module_id: string; logical_node_id: string }>(`select distinct
    placement.module_id, binding.logical_node_id
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
    join parameter_catalog.subject_placements placement on placement.registration_id = binding.registration_id
    where binding.project_id = 'aurora' and definition.subject_id = 'csub_drv_huawei_bypass_bst_hl7603'`);
  expect(instances.rows.length).toBeGreaterThanOrEqual(2);
  expect(new Set(instances.rows.map((row) => row.logical_node_id)).size).toBeGreaterThanOrEqual(2);
  expect(new Set(instances.rows.map((row) => row.module_id)).size).toBe(1);
}, 600_000);

it("quality and visual review seeds use canonical source pins without legacy parameter rows", async () => {
  vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "true");
  vi.stubEnv("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME", new URL(database.url).pathname.slice(1));
  vi.stubEnv("OBJECT_STORE_ROOT", storage);
  try {
    const canonical = await seedQualityCanonicalBindings(db);
    expect(canonical.written.aurora).toBeGreaterThan(0);
    const fixture = await seedQualityVisualReview(db);
    const request = await db.query(`select request.status, request.source_pin_id, definition.property_key
      from project_parameter_value_change_requests request
      join parameter_catalog.parameter_definitions definition on definition.id = request.definition_id
      where request.id = $1`, [fixture.requestId]);
    expect(request.rows).toEqual([expect.objectContaining({ status: "pending", property_key: "cccv_0", source_pin_id: expect.any(String) })]);
    expect((await db.query("select count(*)::int as count from project_parameter_bindings")).rows).toEqual([{ count: 0 }]);
    expect((await db.query("select count(*)::int as count from parameter_specs")).rows).toEqual([{ count: 0 }]);
  } finally {
    vi.unstubAllEnvs();
  }
}, 120_000);

it("preserves legacy finalize for a mixed cohort despite complete canonical source pins", async () => {
  await expect(db.transaction(async (tx) => {
    await tx.query(`insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ('t1088-mixed-spec', 'org-chargelab', 'manual', 't1088-mixed-spec')`);
    await expect(maybeEnsureLocalPostCutoverOnApiBoot(tx, { NODE_ENV: "development" }))
      .rejects.toThrow(/baseline.*no mapped binding revisions/);
    throw new Error("mixed-cohort-rollback");
  })).rejects.toThrow("mixed-cohort-rollback");
});
