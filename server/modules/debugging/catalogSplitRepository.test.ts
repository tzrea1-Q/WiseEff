/**
 * Behavior-level integration coverage for the debug node/binding catalog
 * split: logical nodes without protocol columns, per-protocol bindings with
 * organization scoping, runtime listings, and debug node module CRUD against
 * a real database. Asserts returned records and subsequent reads — never SQL
 * text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  archiveDebugNodeBinding,
  countDebugNodesForModule,
  createDebugNode,
  createDebugNodeModule,
  deleteDebugNode,
  deleteDebugNodeModule,
  getDebugNodeBinding,
  getDebugNodeModuleById,
  getDebugNodeModuleByName,
  listDebugNodeBindings,
  listDebugNodeModules,
  listDebugNodes,
  listRuntimeDebugNodes,
  moveDebugNodeModule,
  renameDebugNodeModuleReferences,
  updateDebugNodeModule,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("catalogSplitRepository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "org-1", name: "ChargeLab" } });
    await seedCoreGraph(db, { organization: { id: "org-2", name: "Foreign Org" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("creates logical debug nodes carrying metadata only, with no protocol binding attached", async () => {
    const created = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Created node",
      description: "Node metadata only"
    });

    expect(created).toMatchObject({
      organizationId: "org-1",
      name: "Created node",
      description: "Node metadata only",
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null,
      enabled: true,
      archivedAt: null
    });
    // The catalog split keeps protocol/node-path/access-mode off the node itself:
    // a fresh node has no bindings and is invisible to every runtime protocol list.
    await expect(listDebugNodeBindings(db, { organizationId: "org-1", nodeId: created.id })).resolves.toEqual([]);
    await expect(listRuntimeDebugNodes(db, { organizationId: "org-1", protocol: "hdc" })).resolves.toEqual([]);
    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed.map((node) => node.id)).toEqual([created.id]);
  });

  it("deletes an unreferenced node with its bindings and protects nodes with operation history", async () => {
    const removable = await createDebugNode(db, { organizationId: "org-1", name: "Removable node" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: removable.id,
      protocol: "hdc",
      nodePath: "/sys/removable",
      accessMode: "RW",
      enabled: true
    });

    await expect(deleteDebugNode(db, { organizationId: "org-1", nodeId: removable.id })).resolves.toEqual({
      status: "deleted",
      bindingCount: 1
    });
    await expect(getDebugNodeBinding(db, { organizationId: "org-1", nodeId: removable.id, protocol: "hdc", includeDisabled: true })).resolves.toBeNull();
    await expect(listDebugNodes(db, { organizationId: "org-1", includeArchived: true })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: removable.id })])
    );

    await seedCoreGraph(db, {
      organization: { id: "org-1" },
      users: [{ id: "user-1" }]
    });
    await db.query(
      `insert into debugging_devices (id, organization_id, name, transport, status, firmware)
       values ('device-history', 'org-1', 'History device', 'simulator', 'online', 'test')`
    );
    await db.query(
      `insert into debugging_targets (id, organization_id, device_id, target_ref, label, status)
       values ('target-history', 'org-1', 'device-history', 'simulator://history', 'History target', 'detected')`
    );
    await db.query(
      `insert into debugging_sessions (id, organization_id, device_id, target_id, actor_user_id, status)
       values ('session-history', 'org-1', 'device-history', 'target-history', 'user-1', 'active')`
    );
    const protectedNode = await createDebugNode(db, { organizationId: "org-1", name: "Protected node" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: protectedNode.id,
      protocol: "adb",
      nodePath: "/sys/protected",
      accessMode: "RO",
      enabled: true
    });
    await db.query(
      `insert into node_operations (
         id, organization_id, session_id, node_id, node_path, operation_type, status, actor_user_id
       ) values ('operation-history', 'org-2', 'session-history', $1, '/sys/protected', 'read', 'succeeded', 'user-1')`,
      [protectedNode.id]
    );

    await expect(deleteDebugNode(db, { organizationId: "org-1", nodeId: protectedNode.id })).resolves.toEqual({
      status: "protected",
      operationCount: 1
    });
    await expect(listDebugNodes(db, { organizationId: "org-1", includeArchived: true })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: protectedNode.id })])
    );
    await expect(
      getDebugNodeBinding(db, { organizationId: "org-1", nodeId: protectedNode.id, protocol: "adb", includeDisabled: true })
    ).resolves.toEqual(expect.objectContaining({ nodeId: protectedNode.id }));
  });

  it("upserts and archives debug node bindings scoped to the logical node", async () => {
    const node = await createDebugNode(db, { organizationId: "org-1", name: "Battery current" });

    const created = await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RO",
      enabled: true,
      notes: "ADB lab path"
    });
    expect(created).toMatchObject({
      nodeId: node.id,
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RO",
      enabled: true,
      notes: "ADB lab path"
    });

    // A second upsert for the same (node, protocol) updates the same binding row.
    const updated = await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "adb",
      nodePath: "/sys/adb/updated",
      accessMode: "RW",
      enabled: true,
      notes: null
    });
    expect(updated?.id).toBe(created?.id);
    expect(updated).toMatchObject({ nodePath: "/sys/adb/updated", accessMode: "RW", notes: null });

    const archived = await archiveDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "adb"
    });
    expect(archived?.enabled).toBe(false);
    // Enabled-only reads no longer see the archived binding.
    await expect(
      getDebugNodeBinding(db, { organizationId: "org-1", nodeId: node.id, protocol: "adb" })
    ).resolves.toBeNull();
  });

  it("returns null when upserting a binding for a node outside the organization scope", async () => {
    const foreignNode = await createDebugNode(db, { organizationId: "org-2", name: "Foreign node" });

    const binding = await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: foreignNode.id,
      protocol: "hdc",
      nodePath: "/sys/hdc/current",
      accessMode: "RW",
      enabled: true
    });

    expect(binding).toBeNull();
    // Nothing was written for either organization.
    await expect(listDebugNodeBindings(db, { organizationId: "org-1", nodeId: foreignNode.id })).resolves.toEqual([]);
    await expect(listDebugNodeBindings(db, { organizationId: "org-2", nodeId: foreignNode.id })).resolves.toEqual([]);
  });

  it("lists bindings for a logical node ordered by protocol", async () => {
    const node = await createDebugNode(db, { organizationId: "org-1", name: "Battery current" });
    const otherNode = await createDebugNode(db, { organizationId: "org-1", name: "Voltage" });
    // Insert hdc before adb: the listing order must come from the database.
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current",
      accessMode: "RW",
      enabled: true
    });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RW",
      enabled: true
    });
    // Another node's binding stays out of this node's listing.
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: otherNode.id,
      protocol: "hdc",
      nodePath: "/sys/voltage",
      accessMode: "RO",
      enabled: true
    });

    const bindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: node.id });

    expect(bindings).toEqual([
      expect.objectContaining({ nodeId: node.id, protocol: "adb", nodePath: "/sys/adb/current" }),
      expect.objectContaining({ nodeId: node.id, protocol: "hdc", nodePath: "/sys/class/power_supply/battery/current" })
    ]);
  });

  it("returns enabled debug node bindings by node and protocol, hiding disabled ones unless asked", async () => {
    const node = await createDebugNode(db, { organizationId: "org-1", name: "Battery current" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current",
      accessMode: "RW",
      enabled: true
    });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RO",
      enabled: false
    });

    await expect(
      getDebugNodeBinding(db, { organizationId: "org-1", nodeId: node.id, protocol: "hdc" })
    ).resolves.toMatchObject({
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current",
      accessMode: "RW",
      enabled: true
    });
    // The disabled adb binding is invisible to the enabled-only read but reachable when asked.
    await expect(
      getDebugNodeBinding(db, { organizationId: "org-1", nodeId: node.id, protocol: "adb" })
    ).resolves.toBeNull();
    await expect(
      getDebugNodeBinding(db, { organizationId: "org-1", nodeId: node.id, protocol: "adb", includeDisabled: true })
    ).resolves.toMatchObject({ protocol: "adb", enabled: false });
  });

  it("listRuntimeDebugNodes returns only enabled nodes with an enabled binding for the protocol", async () => {
    const bound = await createDebugNode(db, { organizationId: "org-1", name: "Battery current" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: bound.id,
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current",
      accessMode: "RW",
      enabled: true
    });
    // Decoys: disabled binding, wrong protocol, unbound node, and a foreign-org pair.
    const disabledBinding = await createDebugNode(db, { organizationId: "org-1", name: "Disabled binding" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: disabledBinding.id,
      protocol: "hdc",
      nodePath: "/sys/disabled",
      accessMode: "RW",
      enabled: false
    });
    const adbOnly = await createDebugNode(db, { organizationId: "org-1", name: "ADB only" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: adbOnly.id,
      protocol: "adb",
      nodePath: "/sys/adb/only",
      accessMode: "RW",
      enabled: true
    });
    await createDebugNode(db, { organizationId: "org-1", name: "Unbound" });
    const foreign = await createDebugNode(db, { organizationId: "org-2", name: "Foreign" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-2",
      nodeId: foreign.id,
      protocol: "hdc",
      nodePath: "/sys/foreign",
      accessMode: "RW",
      enabled: true
    });

    const nodes = await listRuntimeDebugNodes(db, { organizationId: "org-1", protocol: "hdc" });

    expect(nodes).toEqual([
      expect.objectContaining({
        id: bound.id,
        protocol: "hdc",
        nodePath: "/sys/class/power_supply/battery/current",
        accessMode: "RW"
      })
    ]);
  });

  it("listRuntimeDebugNodes omits nodes without an enabled binding for the requested protocol", async () => {
    const node = await createDebugNode(db, { organizationId: "org-1", name: "HDC only" });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/hdc/only",
      accessMode: "RW",
      enabled: true
    });

    await expect(listRuntimeDebugNodes(db, { organizationId: "org-1", protocol: "adb" })).resolves.toEqual([]);
  });

  it("creates, lists, updates, renames references, and deletes debug node modules", async () => {
    const module = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      description: "Battery nodes",
      scope: "Lab"
    });
    expect(module).toMatchObject({ name: "Battery", description: "Battery nodes", scope: "Lab" });

    const listed = await listDebugNodeModules(db, { organizationId: "org-1" });
    expect(listed.map((row) => row.id)).toEqual([module.id]);

    // Two nodes reference the module by name; a third belongs to another module.
    await createDebugNode(db, { organizationId: "org-1", name: "Current", module: "Battery", moduleId: module.id });
    await createDebugNode(db, { organizationId: "org-1", name: "Voltage", module: "Battery", moduleId: module.id });
    await createDebugNode(db, { organizationId: "org-1", name: "Other", module: "Thermal" });
    await expect(countDebugNodesForModule(db, { organizationId: "org-1", moduleName: "Battery" })).resolves.toBe(2);

    const renamed = await updateDebugNodeModule(db, {
      organizationId: "org-1",
      moduleId: module.id,
      name: "Battery Charging"
    });
    expect(renamed?.name).toBe("Battery Charging");
    await renameDebugNodeModuleReferences(db, {
      organizationId: "org-1",
      fromModule: "Battery",
      toModule: "Battery Charging"
    });
    // Node references follow the rename; the unrelated module's node does not.
    await expect(
      countDebugNodesForModule(db, { organizationId: "org-1", moduleName: "Battery Charging" })
    ).resolves.toBe(2);
    await expect(countDebugNodesForModule(db, { organizationId: "org-1", moduleName: "Battery" })).resolves.toBe(0);
    await expect(countDebugNodesForModule(db, { organizationId: "org-1", moduleName: "Thermal" })).resolves.toBe(1);

    // Deleting a module still referenced by nodes is refused (the fake-db
    // predecessor queued zero counts and never saw this guard).
    await expect(
      deleteDebugNodeModule(db, { organizationId: "org-1", moduleName: "Battery Charging" })
    ).rejects.toThrow("Cannot delete debug node module referenced by debug nodes");

    const empty = await createDebugNodeModule(db, { organizationId: "org-1", name: "Empty" });
    const deleted = await deleteDebugNodeModule(db, { organizationId: "org-1", moduleName: "Empty" });
    expect(deleted).toBe(true);
    await expect(getDebugNodeModuleByName(db, { organizationId: "org-1", name: "Empty" })).resolves.toBeNull();
    const remaining = await listDebugNodeModules(db, { organizationId: "org-1" });
    expect(remaining.map((row) => row.id)).toEqual([module.id]);
    expect(remaining.map((row) => row.id)).not.toContain(empty.id);
  });

  it("moveDebugNodeModule reparents only the moved node while re-prefixing descendant paths", async () => {
    const root = await createDebugNodeModule(db, { organizationId: "org-1", name: "Power" });
    const moved = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: root.id
    });
    const child = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Cells",
      parentId: moved.id
    });
    const grandchild = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Balancing",
      parentId: child.id
    });
    const target = await createDebugNodeModule(db, { organizationId: "org-1", name: "Charging" });

    const result = await moveDebugNodeModule(db, {
      organizationId: "org-1",
      moduleId: moved.id,
      parentId: target.id
    });

    expect(result).toMatchObject({
      id: moved.id,
      parentId: target.id,
      path: `${target.id}/${moved.id}`,
      depth: 2
    });
    // Descendants keep their immediate parent (#415): only the moved node's
    // parent_id changes, while every descendant path is re-prefixed.
    await expect(
      getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: child.id })
    ).resolves.toMatchObject({
      parentId: moved.id,
      path: `${target.id}/${moved.id}/${child.id}`,
      depth: 3
    });
    await expect(
      getDebugNodeModuleById(db, { organizationId: "org-1", moduleId: grandchild.id })
    ).resolves.toMatchObject({
      parentId: child.id,
      path: `${target.id}/${moved.id}/${child.id}/${grandchild.id}`,
      depth: 4
    });
    // UI-facing invariant: the parent_id chain agrees with the materialized path
    // for every row after the move.
    const rows = await listDebugNodeModules(db, { organizationId: "org-1" });
    const pathById = new Map(rows.map((row) => [row.id, row.path]));
    for (const row of rows) {
      const parentPath = row.parentId ? pathById.get(row.parentId) : null;
      expect(`${row.id} -> ${row.path}`).toBe(
        `${row.id} -> ${parentPath ? `${parentPath}/${row.id}` : row.id}`
      );
    }
  });
});
