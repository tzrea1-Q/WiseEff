import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runAllSeedScripts } from "../../scripts/seed-all";
import { seedQualityCanonicalBindings, seedQualityVisualReview } from "../../scripts/seed-quality-visual-review";
import { createPostgresDatabase, type RootDatabase } from "../shared/database/client";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testing/testDatabase";

const runtimes: Array<{ database: EphemeralTestDatabase; db: RootDatabase; storage: string }> = [];
const moduleTree = `with recursive modules as (
  select id, organization_id, kind, origin, source_key, name::text as name_path
    from parameter_modules where parent_id is null
  union all
  select child.id, child.organization_id, child.kind, child.origin, child.source_key,
         parent.name_path || '/' || child.name
    from parameter_modules child join modules parent on parent.id = child.parent_id
     and parent.organization_id = child.organization_id
)`;

async function canonicalOutput(db: RootDatabase) {
  const modules = await db.query(`${moduleTree}
    select module.organization_id, module.name_path, module.kind, module.origin, module.source_key,
           count(distinct binding.id)::int as parameter_count,
           count(distinct placement.id)::int as placement_count
      from modules module
      left join parameter_catalog.subject_placements placement
        on placement.module_id = module.id and placement.organization_id = module.organization_id
      left join parameter_catalog.organization_subject_registrations registration
        on registration.current_placement_id = placement.id and registration.status = 'active'
      left join parameter_catalog.current_project_parameter_bindings binding
        on binding.registration_id = registration.id and binding.organization_id = registration.organization_id
     group by module.organization_id, module.name_path, module.kind, module.origin, module.source_key
     order by module.organization_id, module.name_path collate "C"`);
  const registrations = await db.query(`${moduleTree}
    select registration.organization_id, registration.subject_id, registration.status,
           registration.registration_method, registration.proof, module.name_path, placement.origin
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id = registration.current_placement_id
      join modules module on module.id = placement.module_id and module.organization_id = placement.organization_id
     order by registration.organization_id, registration.subject_id collate "C"`);
  const bindings = await db.query(`${moduleTree}
    select binding.organization_id, binding.project_id, binding.subject_id,
           definition.property_key, binding.catalog_release_id, binding.effective_revision_id,
           module.name_path, value.source_ref, value.value_kind, value.value, value.value_digest
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
      join parameter_catalog.organization_subject_registrations registration on registration.id = binding.registration_id
      join parameter_catalog.subject_placements placement on placement.id = registration.current_placement_id
      join modules module on module.id = placement.module_id and module.organization_id = placement.organization_id
      join parameter_catalog.project_parameter_values value on value.id = binding.current_value_id
     order by binding.organization_id, binding.project_id, binding.subject_id collate "C",
              definition.property_key collate "C", value.source_ref collate "C"`);
  expect(modules.rows.length).toBeGreaterThan(0);
  expect(registrations.rows.length).toBeGreaterThan(0);
  expect(bindings.rows.length).toBeGreaterThan(0);
  return { modules: modules.rows, registrations: registrations.rows, bindings: bindings.rows };
}

beforeAll(async () => {
  for (const label of ["seeda", "seedb"]) {
    const database = await createEphemeralTestDatabase(label);
    const db = createPostgresDatabase(database.url);
    const storage = mkdtempSync(path.join(tmpdir(), "t1080seed-"));
    runtimes.push({ database, db, storage });
    await runAllSeedScripts({
      ...process.env, DATABASE_URL: database.url, TEST_DATABASE_URL: database.url,
      OBJECT_STORE_ROOT: storage, NODE_ENV: "development", WISEEFF_SEED_LEGACY_FLAT_IDENTITY: "1",
    });
  }
}, 600_000);

afterAll(async () => {
  for (const runtime of runtimes) {
    await runtime.db.close();
    await runtime.database.drop();
    rmSync(runtime.storage, { recursive: true, force: true });
  }
});

it("produces byte-identical canonical module counts, placements, registrations and current values", async () => {
  const first = await canonicalOutput(runtimes[0]!.db);
  const second = await canonicalOutput(runtimes[1]!.db);
  expect(second).toEqual(first);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
});

it("keeps the same canonical outputs after quality Catalog and review seeding", async () => {
  try {
    for (const runtime of runtimes) {
      vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "true");
      vi.stubEnv("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME", new URL(runtime.database.url).pathname.slice(1));
      vi.stubEnv("OBJECT_STORE_ROOT", runtime.storage);
      await seedQualityCanonicalBindings(runtime.db);
      const fixture = await seedQualityVisualReview(runtime.db);
      expect(fixture.requestId).toEqual(expect.any(String));
    }
    const first = await canonicalOutput(runtimes[0]!.db);
    const second = await canonicalOutput(runtimes[1]!.db);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  } finally {
    vi.unstubAllEnvs();
  }
}, 120_000);
