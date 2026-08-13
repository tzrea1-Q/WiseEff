import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import { resolveAttributionModuleForBinding } from "./ensureAttributionModuleForBinding";
import { nodeTypeSourceKey } from "./modulePlacement";
import { unclassifiedModuleId } from "./resolveModuleForBinding";

const databaseAvailable = await isTestDatabaseAvailable();

type ModuleRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  origin: string;
  source_key: string | null;
  attribution_subject_id: string | null;
};

describe.skipIf(!databaseAvailable)("resolveAttributionModuleForBinding", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "org-1", name: "ChargeLab" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedMapping(input: {
    matchKind: "compatible" | "node-type";
    matchValue: string;
    moduleId: string;
    priority?: number;
  }) {
    await db.query(
      `insert into parameter_module_mappings (id, organization_id, parameter_module_id, match_kind, match_value, priority)
       values ($1, 'org-1', $2, $3, $4, $5)`,
      [
        `map-${input.matchKind}-${input.matchValue}`,
        input.moduleId,
        input.matchKind,
        input.matchValue,
        input.priority ?? 0
      ]
    );
  }

  async function allModules(): Promise<ModuleRow[]> {
    const result = await db.query<ModuleRow>(
      `select id, parent_id, name, kind, origin, source_key, attribution_subject_id
       from parameter_modules where organization_id = 'org-1' order by name asc, id asc`
    );
    return result.rows;
  }

  it("resolves bindings through a compatible mapping to the driver group", async () => {
    const group = await createParameterModule(db, {
      organizationId: "org-1",
      name: "hl7603",
      kind: "driver-group",
      origin: "auto",
      sourceKey: "compatible:huawei,bypass_bst_hl7603"
    });
    await seedMapping({
      matchKind: "compatible",
      matchValue: "huawei,bypass_bst_hl7603",
      moduleId: group.id,
      priority: 300
    });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E"
    });

    expect(moduleId).toBe(group.id);
  });

  it("resolves bindings through a node-type mapping", async () => {
    const nodeType = await createParameterModule(db, {
      organizationId: "org-1",
      name: "hl7603",
      kind: "node-type",
      origin: "auto",
      sourceKey: nodeTypeSourceKey("hl7603")
    });
    await seedMapping({
      matchKind: "node-type",
      matchValue: "hl7603",
      moduleId: nodeType.id,
      priority: 500
    });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E"
    });

    expect(moduleId).toBe(nodeType.id);
  });

  it("materializes node-type modules with nodetype source keys during auto discovery", async () => {
    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "battery0",
      nodeLocator: "/battery_charge_balance/battery0"
    });

    // No mapping exists, so the binding still lands on unclassified…
    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    // …but the durable node-type module was materialized with its stable key
    // and a linked attribution subject (post-0088 invariant).
    const created = (await allModules()).find((row) => row.kind === "node-type");
    expect(created).toMatchObject({
      name: "battery0",
      origin: "auto",
      source_key: nodeTypeSourceKey("battery0")
    });
    expect(created?.attribution_subject_id).not.toBeNull();
  });

  it("preserves a curated rename across re-ingest via source_key (no duplicate)", async () => {
    const sourceKey = nodeTypeSourceKey("hl7603");
    const curated = await createParameterModule(db, {
      organizationId: "org-1",
      name: "备用电源旁路",
      kind: "node-type",
      origin: "curated",
      sourceKey
    });
    await seedMapping({ matchKind: "node-type", matchValue: "hl7603", moduleId: curated.id, priority: 500 });

    const first = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E"
    });
    const second = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E"
    });

    expect(first).toBe(curated.id);
    expect(second).toBe(curated.id);
    const rows = (await allModules()).filter((row) => row.source_key === sourceKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "备用电源旁路", origin: "curated" });
  });

  it("does not create per-instance modules for unit-addressed nodes", async () => {
    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "new-driver",
      compatible: "vendor,new-driver",
      instanceName: "new_driver@10",
      nodeLocator: "/amba/i2c@FF24E000/new_driver@10"
    });

    const modules = await allModules();
    expect(modules.some((row) => row.name === "new_driver@10")).toBe(false);
    expect(modules.some((row) => row.name === "new_driver" && row.kind === "node-type")).toBe(true);
  });

  it("parks scaffolding drivers on the org unclassified root without provisional buckets", async () => {
    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "amba-bus",
      compatible: "arm,amba-bus",
      instanceName: "amba",
      nodeLocator: "/amba"
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    const modules = await allModules();
    expect(modules.some((row) => row.name.startsWith("未分类 · "))).toBe(false);
    // Scaffolding never materializes driver-groups or node-types.
    expect(modules.filter((row) => row.kind !== "unclassified")).toEqual([]);
  });

  it("maps DTS root instance `/` through the board node-type mapping", async () => {
    const board = await createParameterModule(db, {
      organizationId: "org-1",
      name: "board",
      kind: "node-type",
      origin: "auto",
      sourceKey: nodeTypeSourceKey("board")
    });
    await seedMapping({ matchKind: "node-type", matchValue: "board", moduleId: board.id, priority: 500 });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "/",
      nodeLocator: "/"
    });

    expect(moduleId).toBe(board.id);
    // The board root is scaffolding for materialization: nothing new was created.
    expect(await allModules()).toHaveLength(1);
  });

  it("places a new auto driver-group under registration default when set (not heuristic)", async () => {
    const wireless = await createParameterModule(db, { organizationId: "org-1", name: "Wireless Charging" });
    // Heuristic decoy: businessCategoryForNodePath('/board') would pick this one.
    const boardIdentity = await createParameterModule(db, { organizationId: "org-1", name: "Board Identity" });
    await db.query(
      `insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
       values ('subj-sc8562', 'org-1', 'driver-registration', 'sc8562', 'auto', 'compatible:vendor,sc8562')`
    );
    await db.query(
      `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes, default_business_category_module_id)
       values ('subj-sc8562', 'physical-device', 'multiple', '', $1)`,
      [wireless.id]
    );

    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "vendor,sc8562",
      instanceName: "sc8562@1",
      nodeLocator: "/board"
    });

    const created = (await allModules()).find((row) => row.kind === "driver-group");
    expect(created).toMatchObject({
      origin: "auto",
      source_key: "compatible:vendor,sc8562",
      attribution_subject_id: "subj-sc8562"
    });
    expect(created?.parent_id).toBe(wireless.id);
    expect(created?.parent_id).not.toBe(boardIdentity.id);
  });

  it("does not reparent an existing auto driver-group on re-ingest", async () => {
    const oldCat = await createParameterModule(db, { organizationId: "org-1", name: "Old Cat" });
    const group = await createParameterModule(db, {
      organizationId: "org-1",
      name: "sc8562",
      parentId: oldCat.id,
      kind: "driver-group",
      origin: "auto",
      sourceKey: "compatible:vendor,sc8562"
    });
    await seedMapping({ matchKind: "compatible", matchValue: "vendor,sc8562", moduleId: group.id, priority: 300 });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "vendor,sc8562",
      instanceName: "sc8562@1",
      // The heuristic would suggest Wireless Charging for this path — it must not move.
      nodeLocator: "/wireless/sc8562@1"
    });

    expect(moduleId).toBe(group.id);
    const stored = (await allModules()).find((row) => row.id === group.id);
    expect(stored?.parent_id).toBe(oldCat.id);
  });
});
