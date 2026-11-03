import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runAllSeedScripts } from "../../scripts/seed-all";
import { createWiseEffServer } from "../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../shared/database/client";
import { requestJson } from "../test/testClient";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testing/testDatabase";
import { maybeEnsureLocalPostCutoverOnApiBoot } from "../modules/parameter-topology/localPostCutover";
import { seedQualityCanonicalBindings, seedQualityVisualReview } from "../../scripts/seed-quality-visual-review";
import { createLocalObjectStore } from "../modules/logs/objectStore";
import { seedPublishedCatalog, readSeededCatalogPointer } from "../testing/parameterCatalog/seedPublishedCatalog";
import { seedCurrentDemoCatalog } from "../testing/parameterCatalog/seedCurrentDemoCatalog";
import { claimCatalogChildOwners } from "../../scripts/catalog-claim-child-owners";
import { VENDOR_OWNED_RELEASE_ID } from "../../scripts/compile-owned-vendor-catalog-release";

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
    (select count(*)::int from parameter_catalog.organization_subject_registrations) as registrations,
    (select count(*)::int from parameter_catalog.subject_placements) as placements,
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
  const placement = await db.query<{ kind: string; name: string; module_id: string; logical_node_id: string }>(`select
    module.kind, module.name, effective.module_id, binding.logical_node_id
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.organization_subject_registrations registration on registration.id = binding.registration_id
    left join parameter_catalog.registration_effective_module effective on effective.registration_id = registration.id
    left join parameter_modules module on module.id = effective.module_id
    where binding.project_id = 'aurora'`);
  expect(placement.rows.length).toBeGreaterThan(0);
  expect(placement.rows.every((row) => row.module_id !== null)).toBe(true);
  expect(placement.rows.every((row) => row.kind === "business" || row.kind === "unclassified")).toBe(true);
  expect(new Set(placement.rows.map((row) => row.module_id)).size).toBe(11);
  expect([...new Set(placement.rows.map((row) => row.name))].sort()).toEqual([
    "Battery Authentication", "Battery Balance", "Battery Gauge", "Battery Protection", "Battery Thermal",
    "Board Identity", "Charge Pump IC", "Charger IC", "Charging Policy", "Direct Charging", "Wireless Charging",
  ]);
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

it("organizes battery authentication as one driver and one owned checker with two independent instances", async () => {
  const driverId = "csub_drv_huawei_batt_info";
  const childId = "csub_nt_battery_checker";
  const subjects = await db.query(`select id, kind, canonical_key, owner_subject_id
    from parameter_catalog.catalog_subjects where id = any($1::text[]) order by id`, [[driverId, childId]]);
  expect(subjects.rows).toEqual([
    { id: driverId, kind: "driver", canonical_key: "huawei,batt_info", owner_subject_id: null },
    { id: childId, kind: "node-type", canonical_key: "battery_checker", owner_subject_id: driverId },
  ]);
  const placements = await db.query<{ subject_id: string; module_id: string | null; effective_module_id: string; name: string; kind: string; status: string }>(`select
    registration.subject_id, registration.status, placement.module_id, effective.module_id as effective_module_id, module.name, module.kind
    from parameter_catalog.organization_subject_registrations registration
    join parameter_catalog.subject_placements placement on placement.id = registration.current_placement_id
    join parameter_catalog.registration_effective_module effective on effective.registration_id = registration.id
    join parameter_modules module on module.id = effective.module_id
    where registration.organization_id = 'org-chargelab' and registration.subject_id = any($1::text[])
    order by registration.subject_id`, [[driverId, childId]]);
  expect(placements.rows).toHaveLength(2);
  expect(placements.rows[0]).toMatchObject({ subject_id: driverId, module_id: expect.any(String), name: "Battery Authentication", kind: "business", status: "active" });
  expect(placements.rows[1]).toMatchObject({ subject_id: childId, module_id: null, name: "Battery Authentication", kind: "business", status: "active" });
  expect(placements.rows[1]!.effective_module_id).toBe(placements.rows[0]!.effective_module_id);

  const definitions = await db.query(`select subject_id, property_key from parameter_catalog.parameter_definitions
    where subject_id = any($1::text[]) order by subject_id, property_key`, [[driverId, childId]]);
  expect(definitions.rows).toEqual([
    { subject_id: driverId, property_key: "sn-check-type" },
    { subject_id: childId, property_key: "matchable" },
    { subject_id: childId, property_key: "spare-cycles" },
  ]);
  const bindings = await db.query<{ id: string; project_id: string; logical_node_id: string; definition_id: string; property_key: string; value: unknown; node_locator: string }>(`select
    binding.id, binding.project_id, binding.logical_node_id, binding.definition_id, definition.property_key, value.value, logical.node_locator
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
    join parameter_catalog.project_parameter_values value on value.id = binding.current_value_id
    join parameter_catalog.project_value_source_pins pin on pin.project_value_id = value.id and pin.binding_id = binding.id
    join dts_logical_node_revisions logical on logical.logical_node_id = binding.logical_node_id and logical.config_revision_id = pin.config_revision_id
    where binding.organization_id = 'org-chargelab' and binding.subject_id = any($1::text[])
    order by binding.project_id, logical.node_locator, definition.property_key`, [[driverId, childId]]);
  for (const project of ["atlas", "aurora", "nebula"]) {
    const rows = bindings.rows.filter((row) => row.project_id === project);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.logical_node_id)).size).toBe(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(5);
    for (const property of ["matchable", "spare-cycles"]) {
      const instances = rows.filter((row) => row.property_key === property);
      expect(instances).toHaveLength(2);
      expect(instances.map((row) => row.node_locator.split("/").at(-1))).toEqual(["battery_checker@0", "battery_checker@1"]);
      expect(new Set(instances.map((row) => row.definition_id)).size).toBe(1);
    }
    const refs = rows.filter((row) => row.property_key === "matchable");
    expect(JSON.stringify(refs[0]!.value)).toContain("fm1230");
    expect(JSON.stringify(refs[0]!.value)).toContain("t91407");
    expect(JSON.stringify(refs[0]!.value)).not.toContain("fm1230_1");
    expect(JSON.stringify(refs[1]!.value)).toContain("fm1230_1");
    expect(JSON.stringify(refs[1]!.value)).toContain("t91407_1");
  }
  expect(bindings.rows.filter((row) => row.project_id === "atlas" && row.property_key === "spare-cycles").map((row) => row.value)).toEqual([167, 167]);
  const server = createWiseEffServer({ db });
  const response = await requestJson<{ items: Array<{ id: string; propertyKey: string; rawValue: string }> }>(
    server, "/api/v2/projects/atlas/parameter-bindings?limit=500", { headers: { "X-WiseEff-User": "u-xu-yun" } });
  expect(response.status, response.bodyText).toBe(200);
  const ids = new Set(bindings.rows.filter((row) => row.project_id === "atlas").map((row) => row.id));
  const apiRows = response.body.items.filter((row) => ids.has(row.id));
  expect(apiRows).toHaveLength(5);
  expect(apiRows.filter((row) => row.propertyKey === "matchable").map((row) => row.rawValue).sort())
    .toEqual(["<&fm1230 &t91407>", "<&fm1230_1 &t91407_1>"].sort());
  const subject = await requestJson<{ item: { registration: { id: string } } }>(
    server, `/api/v2/catalog/subjects/${childId}`, { headers: { "X-WiseEff-User": "u-xu-yun" } });
  expect(subject.status, subject.bodyText).toBe(200);
  expect(subject.body.item).toMatchObject({ id: childId, ownerSubjectId: driverId, canonicalName: "battery_checker",
    registration: { status: "active", placement: { structural: true, ownerSubjectId: driverId } },
    definitionCounts: { active: 2, deprecated: 0, retired: 0 } });
  const registration = await requestJson<{ item: unknown }>(server,
    `/api/v2/organizations/org-chargelab/subject-registrations/${subject.body.item.registration.id}`,
    { headers: { "X-WiseEff-User": "u-xu-yun" } });
  expect(registration.status, registration.bodyText).toBe(200);
  expect(registration.body.item).toMatchObject({ subjectId: childId, ownerSubjectId: driverId, structural: true,
    impact: { bindingCount: 12, projectCount: 3 } });
});

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

it("recovers an offline demo interrupted after owner claims but before successor installation", async () => {
  const isolated = await createEphemeralTestDatabase("ownerretry");
  const root = createPostgresDatabase(isolated.url);
  try {
    const pool = getRootPostgresPool(root)!;
    const previous = await seedPublishedCatalog(pool);
    const claimed = await claimCatalogChildOwners(root, path.join(process.cwd(), "schemas/dts"), true, { requireEmptyDemo: true });
    expect(claimed.candidates).toHaveLength(6);
    expect(claimed.candidates.every((row) => row.status === "claimed")).toBe(true);
    expect(await readSeededCatalogPointer(pool)).toMatchObject({ kind: "installed", current: previous });
    const before = (await root.query("select id, owner_subject_id from parameter_catalog.catalog_subjects order by id")).rows;
    expect(await seedCurrentDemoCatalog(root)).toMatchObject({ id: VENDOR_OWNED_RELEASE_ID });
    expect((await root.query("select id, owner_subject_id from parameter_catalog.catalog_subjects order by id")).rows).toEqual(before);
    expect(await seedCurrentDemoCatalog(root)).toMatchObject({ id: VENDOR_OWNED_RELEASE_ID });
  } finally { await root.close(); await isolated.drop(); }
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
