import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  archiveDebugNodeBinding,
  countDebugNodesForModule,
  createDebugNode,
  createDebugNodeModule,
  deleteDebugNodeModule,
  getDebugNodeBinding,
  listDebugNodeBindings,
  listDebugNodeModules,
  listRuntimeDebugNodes,
  renameDebugNodeModuleReferences,
  updateDebugNodeModule,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      const next = results.shift() ?? [];
      const rows = typeof next === "function" ? next(call) : next;
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { calls, db };
}

const timestamp = "2026-07-01T10:00:00.000Z";

function debugNodeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "node-1",
    organization_id: "org-1",
    project_id: "aurora",
    name: "Battery current",
    description: "Charge current node",
    detailed_description: "",
    module: "Battery",
    value_kind: "scalar",
    value_format: "raw",
    normalization_mode: "trim",
    max_value_bytes: null,
    enabled: true,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

function debugNodeBindingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "node-1:hdc",
    organization_id: "org-1",
    project_id: "aurora",
    node_id: "node-1",
    protocol: "hdc",
    node_path: "/sys/class/power_supply/battery/current",
    access_mode: "RW",
    enabled: true,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

describe("catalogSplitRepository", () => {
  it("creates logical debug nodes without protocol columns", async () => {
    const { db, calls } = createFakeDb([[debugNodeRow({ id: "node-created", name: "Created node" })]]);

    const created = await createDebugNode(db, {
      organizationId: "org-1",
      projectId: "aurora",
      name: "Created node",
      description: "Node metadata only"
    });

    expect(calls[0].text).toContain("insert into debug_nodes");
    expect(calls[0].text).not.toContain("protocol");
    expect(calls[0].text).not.toContain("node_path");
    expect(calls[0].text).not.toContain("access_mode");
    expect(calls[0].values).toEqual([
      expect.any(String),
      "org-1",
      "aurora",
      "Created node",
      "Node metadata only",
      "",
      "",
      "scalar",
      "raw",
      "trim",
      null,
      true
    ]);
    expect(created).toMatchObject({ id: "node-created", name: "Created node", projectId: "aurora" });
  });

  it("upserts and archives debug node bindings scoped to the logical node", async () => {
    const { db, calls } = createFakeDb([
      [debugNodeBindingRow({ protocol: "adb", id: "node-1:adb", enabled: true })],
      [debugNodeBindingRow({ protocol: "adb", id: "node-1:adb", enabled: false })]
    ]);

    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      projectId: "aurora",
      nodeId: "node-1",
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RO",
      enabled: true,
      notes: "ADB lab path"
    });
    await archiveDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: "node-1",
      protocol: "adb"
    });

    expect(calls[0].text).toContain("insert into debug_node_bindings");
    expect(calls[0].text).toContain("from debug_nodes n");
    expect(calls[0].text).toContain("n.id = $4");
    expect(calls[0].text).toContain("n.organization_id = $2");
    expect(calls[0].text).toContain("on conflict (node_id, protocol) do update");
    expect(calls[0].text).toContain("where debug_node_bindings.organization_id = excluded.organization_id");
    expect(calls[0].values).toEqual([
      "node-1:adb",
      "org-1",
      "aurora",
      "node-1",
      "adb",
      "/sys/adb/current",
      "RO",
      true,
      "ADB lab path"
    ]);
    expect(calls[1].text).toContain("enabled = false");
    expect(calls[1].values).toEqual(["org-1", "node-1", "adb"]);
  });

  it("returns null when upserting a binding for a node outside the organization scope", async () => {
    const { db, calls } = createFakeDb([[]]);

    const binding = await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: "node-other-org",
      protocol: "hdc",
      nodePath: "/sys/hdc/current",
      accessMode: "RW",
      enabled: true
    });

    expect(calls[0].text).toContain("from debug_nodes n");
    expect(binding).toBeNull();
  });

  it("lists bindings for a logical node", async () => {
    const { db, calls } = createFakeDb([
      [
        debugNodeBindingRow({ protocol: "hdc" }),
        debugNodeBindingRow({ protocol: "adb", id: "node-1:adb", node_path: "/sys/adb/current" })
      ]
    ]);

    const bindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: "node-1" });

    expect(calls[0].text).toContain("from debug_node_bindings");
    expect(calls[0].values).toEqual(["org-1", "node-1"]);
    expect(bindings).toEqual([
      expect.objectContaining({ nodeId: "node-1", protocol: "hdc", enabled: true }),
      expect.objectContaining({ nodeId: "node-1", protocol: "adb", nodePath: "/sys/adb/current" })
    ]);
  });

  it("returns enabled debug node bindings by node and protocol", async () => {
    const { db, calls } = createFakeDb([[debugNodeBindingRow()]]);

    const binding = await getDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: "node-1",
      protocol: "hdc"
    });

    expect(calls[0].text).toContain("from debug_node_bindings");
    expect(calls[0].text).toContain("enabled = true");
    expect(calls[0].values).toEqual(["org-1", "node-1", "hdc"]);
    expect(binding).toMatchObject({
      nodeId: "node-1",
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current",
      accessMode: "RW",
      enabled: true
    });
  });

  it("listRuntimeDebugNodes inner-joins enabled bindings and filters by protocol", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          ...debugNodeRow(),
          protocol: "hdc",
          node_path: "/sys/class/power_supply/battery/current",
          access_mode: "RW"
        }
      ]
    ]);

    const nodes = await listRuntimeDebugNodes(db, {
      organizationId: "org-1",
      projectId: "aurora",
      protocol: "hdc"
    });

    expect(calls[0].text).toContain("from debug_nodes n");
    expect(calls[0].text).toContain("inner join debug_node_bindings b on b.node_id = n.id");
    expect(calls[0].text).toContain("b.enabled = true");
    expect(calls[0].text).toContain("b.protocol = $3");
    expect(calls[0].values).toEqual(["org-1", "aurora", "hdc"]);
    expect(nodes).toEqual([
      expect.objectContaining({
        id: "node-1",
        protocol: "hdc",
        nodePath: "/sys/class/power_supply/battery/current",
        accessMode: "RW"
      })
    ]);
  });

  it("listRuntimeDebugNodes omits nodes without an enabled binding for the requested protocol", async () => {
    const { db } = createFakeDb([[]]);

    const nodes = await listRuntimeDebugNodes(db, {
      organizationId: "org-1",
      projectId: "aurora",
      protocol: "adb"
    });

    expect(nodes).toEqual([]);
  });

  it("creates, lists, updates, renames references, and deletes debug node modules", async () => {
    const moduleRow = {
      name: "Battery",
      description: "Battery nodes",
      owner: "Power",
      scope: "Lab",
      created_at: timestamp,
      updated_at: timestamp
    };
    const { db, calls } = createFakeDb([[moduleRow], [moduleRow], [{ count: "2" }], [moduleRow], [], []]);

    await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      description: "Battery nodes",
      owner: "Power",
      scope: "Lab"
    });
    const listed = await listDebugNodeModules(db, { organizationId: "org-1" });
    const nodeCount = await countDebugNodesForModule(db, { organizationId: "org-1", moduleName: "Battery" });
    await updateDebugNodeModule(db, {
      organizationId: "org-1",
      moduleName: "Battery",
      name: "Battery Charging"
    });
    await renameDebugNodeModuleReferences(db, {
      organizationId: "org-1",
      fromModule: "Battery",
      toModule: "Battery Charging"
    });
    await deleteDebugNodeModule(db, { organizationId: "org-1", moduleName: "Battery Charging" });

    expect(calls[0].text).toContain("insert into debug_node_modules");
    expect(listed).toHaveLength(1);
    expect(nodeCount).toBe(2);
    expect(calls[3].values).toEqual(expect.arrayContaining(["org-1", "Battery", "Battery Charging"]));
    expect(calls[4].text).toContain("update debug_nodes");
    expect(calls[5].text).toContain("delete from debug_node_modules");
  });
});
