import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { listDebugNodes } from "./catalogSplitRepository";
import {
  createDebugNodeModule,
  deleteDebugNodeModuleById,
  listDebugNodeModules,
  moveDebugNodeModule
} from "./debugNodeModuleRepository";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb(rowsOrQueue: unknown[] | Array<unknown[] | ((call: QueryCall) => unknown[])> = []) {
  const calls: QueryCall[] = [];
  const queue = [...rowsOrQueue];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      let next = queue.shift();
      if (typeof next === "function") {
        queue.unshift(next);
      }
      const rows =
        next === undefined
          ? []
          : typeof next === "function"
            ? next(call)
            : next;
      return { rows: rows as Row[], rowCount: Array.isArray(rows) ? rows.length : 0 };
    }
  };

  return { db, calls };
}

describe("debugNodeModuleRepository", () => {
  it("listDebugNodeModules returns tree rows", async () => {
    const { db } = createFakeDb([
      [
        {
          id: "dm-a",
          organization_id: "org-1",
          parent_id: null,
          name: "Power",
          path: "dm-a",
          depth: 1,
          sort_order: 0,
          description: "",
          scope: "",
          created_at: "2026-07-01T10:00:00.000Z",
          updated_at: "2026-07-01T10:00:00.000Z"
        },
        {
          id: "dm-b",
          organization_id: "org-1",
          parent_id: "dm-a",
          name: "Battery",
          path: "dm-a/dm-b",
          depth: 2,
          sort_order: 0,
          description: "",
          scope: "",
          created_at: "2026-07-01T10:00:00.000Z",
          updated_at: "2026-07-01T10:00:00.000Z"
        }
      ]
    ]);

    const rows = await listDebugNodeModules(db, { organizationId: "org-1" });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "dm-a",
        parentId: null,
        name: "Power",
        path: "dm-a",
        depth: 1
      }),
      expect.objectContaining({
        id: "dm-b",
        parentId: "dm-a",
        name: "Battery",
        path: "dm-a/dm-b",
        depth: 2
      })
    ]);
  });

  it("createDebugNodeModule computes path from parent", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "dm-a",
          organization_id: "org-1",
          parent_id: null,
          name: "Power",
          path: "dm-a",
          depth: 1,
          sort_order: 0,
          description: "",
          scope: "",
          created_at: "2026-07-01T10:00:00.000Z",
          updated_at: "2026-07-01T10:00:00.000Z"
        }
      ],
      [
        {
          id: "new-id",
          organization_id: "org-1",
          parent_id: "dm-a",
          name: "Battery",
          path: "dm-a/new-id",
          depth: 2,
          sort_order: 0,
          description: "",
          scope: "",
          created_at: "2026-07-01T10:00:00.000Z",
          updated_at: "2026-07-01T10:00:00.000Z"
        }
      ]
    ]);

    const created = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: "dm-a"
    });

    expect(calls[0].text).toContain("from debug_node_modules");
    expect(calls[1].text).toContain("insert into debug_node_modules");
    expect(created.parentId).toBe("dm-a");
    expect(created.path).toMatch(/^dm-a\//);
    expect(created.depth).toBe(2);
  });

  it("moveDebugNodeModule recomputes descendant paths", async () => {
    const modules = [
      {
        id: "dm-a",
        organization_id: "org-1",
        parent_id: null,
        name: "Power",
        path: "dm-a",
        depth: 1,
        sort_order: 0,
        description: "",
        scope: "",
        created_at: "2026-07-01T10:00:00.000Z",
        updated_at: "2026-07-01T10:00:00.000Z"
      },
      {
        id: "dm-b",
        organization_id: "org-1",
        parent_id: "dm-a",
        name: "Battery",
        path: "dm-a/dm-b",
        depth: 2,
        sort_order: 0,
        description: "",
        scope: "",
        created_at: "2026-07-01T10:00:00.000Z",
        updated_at: "2026-07-01T10:00:00.000Z"
      },
      {
        id: "dm-x",
        organization_id: "org-1",
        parent_id: null,
        name: "Charging",
        path: "dm-x",
        depth: 1,
        sort_order: 1,
        description: "",
        scope: "",
        created_at: "2026-07-01T10:00:00.000Z",
        updated_at: "2026-07-01T10:00:00.000Z"
      }
    ];

    const { db, calls } = createFakeDb([
      (call: QueryCall) => {
        if (call.text.includes("from debug_node_modules")) {
          if (call.text.includes("and id = $2")) {
            const moduleId = call.values[1];
            const row = modules.find((item) => item.id === moduleId);
            if (!row) {
              return [];
            }
            const moved = calls.some((item) => item.text.includes("update debug_node_modules"));
            if (moved && moduleId === "dm-b") {
              return [{ ...row, parent_id: "dm-x", path: "dm-x/dm-b", depth: 2 }];
            }
            return [row];
          }
          return modules;
        }
        return [];
      }
    ]);

    const moved = await moveDebugNodeModule(db, {
      organizationId: "org-1",
      moduleId: "dm-b",
      parentId: "dm-x"
    });

    expect(calls.some((call) => call.text.includes("update debug_node_modules"))).toBe(true);
    expect(calls.some((call) => call.text.includes("path like $5 || '/%'"))).toBe(true);
    expect(moved?.parentId).toBe("dm-x");
    expect(moved?.path).toBe("dm-x/dm-b");
  });

  it("deleteDebugNodeModuleById rejects modules with child nodes", async () => {
    const { db } = createFakeDb([
      [{ count: "1" }]
    ]);

    await expect(
      deleteDebugNodeModuleById(db, { organizationId: "org-1", moduleId: "dm-a" })
    ).rejects.toThrow(/child modules/);
  });
});

describe("listDebugNodes module tree filter", () => {
  it("uses subtree filter when includeDescendants is true", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDebugNodes(db, {
      organizationId: "org-1",
      moduleId: "dm-a",
      includeDescendants: true
    });

    expect(calls[0].text).toContain("dm_node.path like dm_sel.path || '/%'");
    expect(calls[0].values).toContain("dm-a");
  });

  it("uses exact module id filter when includeDescendants is false", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDebugNodes(db, {
      organizationId: "org-1",
      moduleId: "dm-b",
      includeDescendants: false
    });

    expect(calls[0].text).toContain("n.debug_node_module_id = $");
    expect(calls[0].text).not.toContain("dm_node.path like");
    expect(calls[0].values).toContain("dm-b");
  });
});
