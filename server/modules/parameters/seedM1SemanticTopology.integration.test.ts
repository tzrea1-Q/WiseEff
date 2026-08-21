import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { DtsPowerSeedProjectFile } from "../../../scripts/dts-power-seed";
import { seedM1DtsFiles, seedM1SemanticTopology } from "../../../scripts/seed-m1-parameters";
import { insertAttributionSubjectForNewModule } from "../parameter-modules/attributionSubjectRepository";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const primarySource = readFileSync(join(seedDir, "aurora-board.dts"), "utf8");

const ORG_ID = "org-chargelab";
const USER_ID = "u-xu-yun";
const PROJECT_ID = "aurora";

const databaseAvailable = await isTestDatabaseAvailable();

async function seedDriverGroupMappings(db: InMemoryTestDatabase) {
  const chargePumpSubjectId = await insertAttributionSubjectForNewModule(db, {
    moduleId: "pmod-seed-charge-pump-ic",
    organizationId: ORG_ID,
    kind: "driver-group",
    displayName: "Charge Pump IC",
    origin: "curated",
    sourceKey: "compatible:fixture:sc8562",
  });
  const chargerSubjectId = await insertAttributionSubjectForNewModule(db, {
    moduleId: "pmod-seed-charger-ic",
    organizationId: ORG_ID,
    kind: "driver-group",
    displayName: "Charger IC",
    origin: "curated",
    sourceKey: "compatible:fixture:huawei,bypass_bst_hl7603",
  });
  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order, description, scope, kind, origin,
       attribution_subject_id
     )
     values ($1, $2, null, 'Charge Pump IC', $1, 1, 0, '', '', 'driver-group', 'curated', $3)
     on conflict (id) do update set
       kind = excluded.kind,
       attribution_subject_id = coalesce(parameter_modules.attribution_subject_id, excluded.attribution_subject_id)`,
    ["pmod-seed-charge-pump-ic", ORG_ID, chargePumpSubjectId]
  );
  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order, description, scope, kind, origin,
       attribution_subject_id
     )
     values ($1, $2, null, 'Charger IC', $1, 1, 1, '', '', 'driver-group', 'curated', $3)
     on conflict (id) do update set
       kind = excluded.kind,
       attribution_subject_id = coalesce(parameter_modules.attribution_subject_id, excluded.attribution_subject_id)`,
    ["pmod-seed-charger-ic", ORG_ID, chargerSubjectId]
  );
  // sc8562 compatible -> Charge Pump IC; hl7603 compatible -> Charger IC.
  // Two hl7603 topology instances share the driver-group module; bindings differ by logical_node_id.
  await db.query(
    `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, 'compatible', $4, 500)
     on conflict (organization_id, match_kind, match_value) do update set parameter_module_id = excluded.parameter_module_id`,
    ["pmap-seed-sc8562", ORG_ID, "pmod-seed-charge-pump-ic", "sc8562"]
  );
  await db.query(
    `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, 'compatible', $4, 500)
     on conflict (organization_id, match_kind, match_value) do update set parameter_module_id = excluded.parameter_module_id`,
    ["pmap-seed-hl7603", ORG_ID, "pmod-seed-charger-ic", "huawei,bypass_bst_hl7603"]
  );
}

describe.skipIf(!databaseAvailable)("seedM1SemanticTopology", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: ORG_ID, name: "ChargeLab" },
      users: [
        {
          id: USER_ID,
          name: "Xu Yun",
          email: "xu@chargelab.cn",
          title: "Platform Owner"
        }
      ],
      projects: [{ id: PROJECT_ID, name: "Aurora", code: "AUR", status: "initialized" }]
    });
    await seedDriverGroupMappings(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("writes module_id on every binding and assigns driver-group modules per compatible", async () => {
    const objectStore = createMemoryObjectStore();
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

    const moduleKinds = await db!.query<{ kind: string }>(
      `select distinct pm.kind
       from project_parameter_bindings ppb
       inner join parameter_modules pm on pm.id = ppb.module_id
       where ppb.project_id = $1`,
      [PROJECT_ID]
    );
    expect(moduleKinds.rows.map((row) => row.kind).sort()).toEqual(
      expect.arrayContaining(["driver-group"])
    );
    for (const row of moduleKinds.rows) {
      expect(["driver-group", "node-type", "unclassified"]).toContain(row.kind);
    }

    const distinctModules = await db!.query<{ module_id: string }>(
      `select distinct module_id from project_parameter_bindings where project_id = $1`,
      [PROJECT_ID]
    );
    const moduleIds = distinctModules.rows.map((row) => row.module_id);
    expect(moduleIds).toContain("pmod-seed-charge-pump-ic");
    expect(moduleIds).toContain("pmod-seed-charger-ic");
    expect(moduleIds.length).toBeGreaterThan(1);

    const hl7603Bindings = await db!.query<{
      module_id: string;
      logical_node_id: string;
      unit_address: string;
    }>(
      `select ppb.module_id, ppb.logical_node_id, lnr.unit_address
       from project_parameter_bindings ppb
       inner join dts_logical_node_revisions lnr on lnr.logical_node_id = ppb.logical_node_id
       inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
       where ppb.project_id = $1
         and cr.project_id = $1
         and lnr.name = 'hl7603'
         and lnr.unit_address in ('75', '77')
       group by ppb.module_id, ppb.logical_node_id, lnr.unit_address`,
      [PROJECT_ID]
    );
    const hl7603Rows = hl7603Bindings.rows;
    expect(hl7603Rows.length).toBeGreaterThanOrEqual(2);
    const hl7603ModuleIds = new Set(hl7603Rows.map((row) => row.module_id));
    const hl7603LogicalNodeIds = new Set(hl7603Rows.map((row) => row.logical_node_id));
    expect(hl7603ModuleIds.size).toBe(1);
    expect(hl7603LogicalNodeIds.size).toBeGreaterThanOrEqual(2);
    expect([...hl7603ModuleIds][0]).toBe("pmod-seed-charger-ic");
  });

  it("is idempotent across reruns and does not duplicate config revisions", async () => {
    const objectStore = createMemoryObjectStore();
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
