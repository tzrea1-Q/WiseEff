import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { ObjectStore } from "../logs/objectStore";
import type { DtsPowerSeedProjectFile } from "../../../scripts/dts-power-seed";
import { seedM1DtsFiles, seedM1SemanticTopology } from "../../../scripts/seed-m1-parameters";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const primarySource = readFileSync(join(seedDir, "aurora-board.dts"), "utf8");

const ORG_ID = "org-chargelab";
const USER_ID = "u-xu-yun";
const PROJECT_ID = "aurora";

const databaseAvailable = await isTestDatabaseAvailable();

function createInMemoryObjectStore(): ObjectStore {
  return {
    async put(input) {
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      return {
        storageKey: `${input.organizationId}/${checksumSha256}-${input.fileName}`,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.length,
        checksumSha256
      };
    },
    async get() {
      throw new Error("not used");
    }
  };
}

/**
 * The shared local dev Postgres instance this suite runs against already
 * carries substantial `aurora` topology data from unrelated dev/demo seed
 * runs (config revisions, bindings, etc.). The test's own BEGIN/ROLLBACK
 * wrapper isolates writes it makes, but it starts from whatever the DB
 * already has committed. Clear this project's topology rows first so
 * assertions about revision counts and distinct module assignments reflect
 * only what this test seeds, not accumulated history.
 */
async function resetProjectTopology(db: InMemoryTestDatabase) {
  // parameter_spec_matcher_overrides references parameter_spec_review_tasks
  // without cascade, so it must be cleared before dts_config_revisions cascades
  // those review tasks away.
  await db.query(`delete from parameter_spec_matcher_overrides where project_id = $1`, [PROJECT_ID]);

  // dts_config_revisions cascades most descendant rows (logical nodes,
  // occurrences, occurrence spec decisions, review/identity tasks). Clear it
  // first so those decision rows (which reference bindings without cascade)
  // are gone before we touch project_parameter_bindings directly below.
  await db.query(`delete from dts_config_revisions where project_id = $1`, [PROJECT_ID]);

  const bindingRefTables = [
    "parameter_history_entries:project_parameter_binding_id",
    "parameter_drafts:project_parameter_binding_id",
    "parameter_change_requests:project_parameter_binding_id",
    "parameter_submission_items:project_parameter_binding_id",
    "parameter_file_sync_conflicts:project_parameter_binding_id",
    "debugging_parameters:project_parameter_binding_id",
    "node_operations:project_parameter_binding_id"
  ];
  for (const entry of bindingRefTables) {
    const [table, column] = entry.split(":");
    await db.query(
      `update ${table} set ${column} = null
       where ${column} in (select id from project_parameter_bindings where project_id = $1)`,
      [PROJECT_ID]
    );
  }
  await db.query(`delete from project_parameter_bindings where project_id = $1`, [PROJECT_ID]);
  await db.query(`delete from project_parameter_files where project_id = $1`, [PROJECT_ID]);
  await db.query(`delete from dts_config_set where project_id = $1`, [PROJECT_ID]);
}

async function seedMinimalGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'ChargeLab')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Xu Yun', 'xu@chargelab.cn', 'Platform Owner', true)
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [USER_ID, ORG_ID]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Aurora', 'AUR', 'initialized')
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [PROJECT_ID, ORG_ID]
  );
}

async function seedTwoDistinctModuleMappings(db: InMemoryTestDatabase) {
  await db.query(
    `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
     values ($1, $2, null, 'Charge Pump IC', $1, 1, 0, '', '')
     on conflict (id) do nothing`,
    ["pmod-seed-charge-pump-ic", ORG_ID]
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
     values ($1, $2, null, 'Charger IC', $1, 1, 1, '', '')
     on conflict (id) do nothing`,
    ["pmod-seed-charger-ic", ORG_ID]
  );
  // sc8562@6E -> Charge Pump IC; hl7603@77 -> Charger IC. Both properties exist
  // on distinct instances so the seed can demonstrate multiple modules.
  await db.query(
    `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, 'instance', $4, 500)
     on conflict (organization_id, match_kind, match_value) do update set parameter_module_id = excluded.parameter_module_id`,
    ["pmap-seed-sc8562-6e", ORG_ID, "pmod-seed-charge-pump-ic", "sc8562@6e"]
  );
  await db.query(
    `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, 'instance', $4, 500)
     on conflict (organization_id, match_kind, match_value) do update set parameter_module_id = excluded.parameter_module_id`,
    ["pmap-seed-hl7603-77", ORG_ID, "pmod-seed-charger-ic", "hl7603@77"]
  );
}

describe.skipIf(!databaseAvailable)("seedM1SemanticTopology", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedMinimalGraph(db);
    // The shared dev DB can carry a large accumulated history for the `aurora`
    // project (many prior config revisions and bindings); the cascading
    // cleanup below can take longer than the default hook timeout.
    await resetProjectTopology(db);
    await seedTwoDistinctModuleMappings(db);
  }, 60_000);

  afterEach(async () => {
    await db?.rollback();
  });

  it("writes module_id on every binding and assigns distinct modules for distinct instances", async () => {
    const objectStore = createInMemoryObjectStore();
    const projectFile: DtsPowerSeedProjectFile = {
      projectId: "aurora",
      fileName: "aurora-board.dts",
      artifactFileName: "aurora-board.dts",
      source: primarySource
    };

    await seedM1DtsFiles(db!, objectStore, [projectFile]);
    await seedM1SemanticTopology(db!, [projectFile]);

    const nullModuleCount = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where module_id is null`
    );
    expect(Number(nullModuleCount.rows[0]?.count ?? "1")).toBe(0);

    const totalBindings = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where project_id = $1`,
      [PROJECT_ID]
    );
    expect(Number(totalBindings.rows[0]?.count ?? "0")).toBeGreaterThan(0);

    const distinctModules = await db!.query<{ module_id: string }>(
      `select distinct module_id from project_parameter_bindings where project_id = $1`,
      [PROJECT_ID]
    );
    const moduleIds = distinctModules.rows.map((row) => row.module_id);
    expect(moduleIds).toContain("pmod-seed-charge-pump-ic");
    expect(moduleIds).toContain("pmod-seed-charger-ic");
    expect(moduleIds.length).toBeGreaterThan(1);
  });

  it("is idempotent across reruns and does not duplicate config revisions", async () => {
    const objectStore = createInMemoryObjectStore();
    const projectFile: DtsPowerSeedProjectFile = {
      projectId: "aurora",
      fileName: "aurora-board.dts",
      artifactFileName: "aurora-board.dts",
      source: primarySource
    };

    await seedM1DtsFiles(db!, objectStore, [projectFile]);
    await seedM1SemanticTopology(db!, [projectFile]);
    await seedM1SemanticTopology(db!, [projectFile]);

    const revisions = await db!.query<{ count: string }>(
      `select count(*)::text as count from dts_config_revisions where project_id = $1`,
      [PROJECT_ID]
    );
    expect(Number(revisions.rows[0]?.count ?? "0")).toBe(1);
  });
});
