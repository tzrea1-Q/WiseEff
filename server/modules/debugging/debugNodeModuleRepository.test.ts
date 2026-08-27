import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { listDebugNodes } from "./catalogSplitRepository";
import {
  createDebugNodeModule,
  deleteDebugNodeModuleById,
  getDebugNodeModuleById,
  listDebugNodeModules,
  moveDebugNodeModule
} from "./debugNodeModuleRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("debugNodeModuleRepository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "org-1", name: "ChargeLab" } });
    await seedCoreGraph(db, { organization: { id: "org-2", name: "OtherOrg" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedNode(input: { id: string; organizationId?: string; name: string; moduleId: string | null }) {
    await db.query(
      `insert into debug_nodes (id, organization_id, name, debug_node_module_id)
       values ($1, $2, $3, $4)`,
      [input.id, input.organizationId ?? "org-1", input.name, input.moduleId]
    );
  }

  it("listDebugNodeModules returns the org tree parents-before-children and hides other orgs", async () => {
    // Seed child-bearing root after the sibling root so insertion order cannot
    // masquerade as path order; the other-org module is the isolation decoy.
    const sibling = await createDebugNodeModule(db, { organizationId: "org-1", name: "Charging" });
    const root = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    const child = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: root.id,
      description: "battery modules",
      scope: "battery"
    });
    await createDebugNodeModule(db, { organizationId: "org-2", name: "Foreign" });

    const rows = await listDebugNodeModules(db, { organizationId: "org-1" });

    expect(rows.map((row) => row.id).sort()).toEqual([sibling.id, root.id, child.id].sort());
    expect(rows.map((row) => row.id).indexOf(root.id)).toBeLessThan(rows.map((row) => row.id).indexOf(child.id));
    const childRow = rows.find((row) => row.id === child.id);
    expect(childRow).toMatchObject({
      parentId: root.id,
      name: "Battery",
      path: `${root.path}/${child.id}`,
      depth: 2,
      description: "battery modules",
      scope: "battery"
    });
    expect(rows.some((row) => row.name === "Foreign")).toBe(false);
  });

  it("createDebugNodeModule computes path from parent", async () => {
    const root = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    const child = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: root.id
    });

    expect(child.parentId).toBe(root.id);
    expect(child.path).toBe(`${root.path}/${child.id}`);
    expect(child.depth).toBe(2);

    const stored = await db.query<{ parent_id: string; path: string; depth: number }>(
      `select parent_id, path, depth from debug_node_modules where organization_id = 'org-1' and id = $1`,
      [child.id]
    );
    expect(stored.rows[0]).toMatchObject({ parent_id: root.id, path: `${root.path}/${child.id}`, depth: 2 });

    await expect(
      createDebugNodeModule(db, { organizationId: "org-1", name: "Orphan", parentId: "missing" })
    ).rejects.toThrow(/Parent debug node module not found/);
  });

  it("moveDebugNodeModule recomputes descendant paths", async () => {
    const rootA = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    const middle = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: rootA.id
    });
    const leaf = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Cell",
      parentId: middle.id
    });
    const rootX = await createDebugNodeModule(db, { organizationId: "org-1", name: "Charging" });

    const moved = await moveDebugNodeModule(db, {
      organizationId: "org-1",
      moduleId: middle.id,
      parentId: rootX.id
    });

    expect(moved).toMatchObject({
      parentId: rootX.id,
      path: `${rootX.path}/${middle.id}`,
      depth: 2
    });
    // Descendant paths and depths follow the subtree; descendant parent_id
    // semantics are owned by the open cascade fix (#418) and stay unasserted here.
    const movedLeaf = await getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id });
    expect(movedLeaf).toMatchObject({
      path: `${rootX.path}/${middle.id}/${leaf.id}`,
      depth: 3
    });
    // The untouched sibling root keeps its original identity.
    const untouched = await getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: rootA.id });
    expect(untouched).toMatchObject({ path: rootA.path, depth: 1, parentId: null });
  });

  it("deleteDebugNodeModuleById rejects modules with child modules", async () => {
    const root = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery", parentId: root.id });

    await expect(
      deleteDebugNodeModuleById(db, { organizationId: "org-1", moduleId: root.id })
    ).rejects.toThrow(/child modules/);

    const survivor = await getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: root.id });
    expect(survivor?.id).toBe(root.id);
  });

  it("deleteDebugNodeModuleById rejects modules referenced by debug nodes and deletes empty leaves", async () => {
    const leaf = await createDebugNodeModule(db, { organizationId: "org-1", name: "Thermal" });
    await seedNode({ id: "node-thermal", name: "thermal_zone", moduleId: leaf.id });

    await expect(
      deleteDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id })
    ).rejects.toThrow(/referenced by debug nodes/);

    await db.query(`delete from debug_nodes where id = 'node-thermal'`);
    await expect(
      deleteDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id })
    ).resolves.toBe(true);
    expect(await getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id })).toBeNull();
  });

  it("deleteDebugNodeModuleById treats legacy name-only nodes as module references", async () => {
    const leaf = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery Charging" });
    await db.query(
      `insert into debug_nodes (id, organization_id, name, module, debug_node_module_id)
       values ('node-legacy-module', 'org-1', 'legacy_charge_current', $1, null)`,
      [leaf.name]
    );

    await expect(
      deleteDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id })
    ).rejects.toThrow(/referenced by debug nodes/);
    expect(await getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: leaf.id })).toMatchObject({
      id: leaf.id,
      name: leaf.name
    });
  });
});

describe.skipIf(!databaseAvailable)("listDebugNodes module tree filter", () => {
  let db: InMemoryTestDatabase;
  let rootId: string;
  let childId: string;
  let otherRootId: string;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "org-1", name: "ChargeLab" } });

    const root = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    const child = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery", parentId: root.id });
    const otherRoot = await createDebugNodeModule(db, { organizationId: "org-1", name: "Charging" });
    rootId = root.id;
    childId = child.id;
    otherRootId = otherRoot.id;

    await db.query(
      `insert into debug_nodes (id, organization_id, name, debug_node_module_id)
       values
         ('node-root', 'org-1', 'root_voltage', $1),
         ('node-child', 'org-1', 'battery_temp', $2),
         ('node-other', 'org-1', 'charge_current', $3)`,
      [rootId, childId, otherRootId]
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("returns the module's own nodes plus descendants when includeDescendants is true", async () => {
    const rows = await listDebugNodes(db, {
      organizationId: "org-1",
      moduleId: rootId,
      includeDescendants: true
    });

    // The decoy node in the unrelated root module must stay filtered out.
    expect(rows.map((row) => row.id).sort()).toEqual(["node-child", "node-root"]);
  });

  it("returns only the module's own nodes when includeDescendants is false", async () => {
    const rows = await listDebugNodes(db, {
      organizationId: "org-1",
      moduleId: rootId,
      includeDescendants: false
    });

    // The child module's node is a descendant decoy: exact filter excludes it.
    expect(rows.map((row) => row.id)).toEqual(["node-root"]);
  });
});
