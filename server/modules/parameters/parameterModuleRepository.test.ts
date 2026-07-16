import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { listParameters } from "./repository";
import {
  createParameterModule,
  listParameterModules,
  moveParameterModule
} from "./parameterModuleRepository";

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
      // Cutover probes must not consume the test SQL queue.
      if (text.includes("parameter_identity_cutovers")) {
        return { rows: [{ c: "0" } as Row], rowCount: 1 };
      }
      if (text.includes("information_schema.tables") && text.includes("parameter_definitions")) {
        return { rows: [{ c: "1" } as Row], rowCount: 1 };
      }
      calls.push(call);
      let next = queue.shift();
      if (typeof next === "function") {
        // Reuse the same handler for subsequent queries when only one handler is provided.
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

describe("parameterModuleRepository", () => {
  it("listParameterModules returns tree rows", async () => {
    const { db } = createFakeDb([
      [
        {
          id: "pm-a",
          organization_id: "org-1",
          parent_id: null,
          name: "Power",
          path: "pm-a",
          depth: 1,
          sort_order: 0,
          description: "",
          scope: ""
        },
        {
          id: "pm-b",
          organization_id: "org-1",
          parent_id: "pm-a",
          name: "Battery",
          path: "pm-a/pm-b",
          depth: 2,
          sort_order: 0,
          description: "",
          scope: ""
        }
      ]
    ]);

    const rows = await listParameterModules(db, { organizationId: "org-1" });

    expect(rows).toEqual([
      {
        id: "pm-a",
        parentId: null,
        name: "Power",
        path: "pm-a",
        depth: 1,
        sortOrder: 0,
        description: "",
        scope: ""
      },
      {
        id: "pm-b",
        parentId: "pm-a",
        name: "Battery",
        path: "pm-a/pm-b",
        depth: 2,
        sortOrder: 0,
        description: "",
        scope: ""
      }
    ]);
  });

  it("createParameterModule computes path from parent", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "pm-a",
          organization_id: "org-1",
          parent_id: null,
          name: "Power",
          path: "pm-a",
          depth: 1,
          sort_order: 0,
          description: "",
          scope: ""
        }
      ],
      [
        {
          id: "new-id",
          organization_id: "org-1",
          parent_id: "pm-a",
          name: "Battery",
          path: "pm-a/new-id",
          depth: 2,
          sort_order: 0,
          description: "",
          scope: ""
        }
      ]
    ]);

    const created = await createParameterModule(db, {
      organizationId: "org-1",
      name: "Battery",
      parentId: "pm-a"
    });

    expect(calls[0].text).toContain("from parameter_modules");
    expect(calls[1].text).toContain("insert into parameter_modules");
    expect(calls[1].values[3]).toBe("Battery");
    expect(created.parentId).toBe("pm-a");
    expect(created.path).toMatch(/^pm-a\//);
    expect(created.depth).toBe(2);
  });

  it("moveParameterModule recomputes descendant paths", async () => {
    const modules = [
      {
        id: "pm-a",
        organization_id: "org-1",
        parent_id: null,
        name: "Power",
        path: "pm-a",
        depth: 1,
        sort_order: 0,
        description: "",
        scope: ""
      },
      {
        id: "pm-b",
        organization_id: "org-1",
        parent_id: "pm-a",
        name: "Battery",
        path: "pm-a/pm-b",
        depth: 2,
        sort_order: 0,
        description: "",
        scope: ""
      },
      {
        id: "pm-x",
        organization_id: "org-1",
        parent_id: null,
        name: "Charging",
        path: "pm-x",
        depth: 1,
        sort_order: 1,
        description: "",
        scope: ""
      }
    ];

    const { db, calls } = createFakeDb([
      (call: QueryCall) => {
        if (call.text.includes("from parameter_modules")) {
          if (call.text.includes("and id = $2")) {
            const moduleId = call.values[1];
            const row = modules.find((item) => item.id === moduleId);
            if (!row) {
              return [];
            }
            const moved = calls.some((item) => item.text.includes("update parameter_modules"));
            if (moved && moduleId === "pm-b") {
              return [{ ...row, parent_id: "pm-x", path: "pm-x/pm-b", depth: 2 }];
            }
            return [row];
          }
          return modules;
        }
        return [];
      }
    ]);

    const moved = await moveParameterModule(db, {
      organizationId: "org-1",
      moduleId: "pm-b",
      parentId: "pm-x"
    });

    expect(calls.some((call) => call.text.includes("update parameter_modules"))).toBe(true);
    expect(calls.some((call) => call.text.includes("path like $5 || '/%'"))).toBe(true);
    expect(moved?.parentId).toBe("pm-x");
    expect(moved?.path).toBe("pm-x/pm-b");
  });
});

describe("listParameters module tree filter", () => {
  it("uses subtree filter when includeDescendants is true", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listParameters(db, {
      organizationId: "org-1",
      projectId: "proj-1",
      moduleId: "pm-a",
      includeDescendants: true
    });

    expect(calls[0].text).toContain("pm_node.path like pm_sel.path || '/%'");
    expect(calls[0].values).toContain("pm-a");
  });

  it("uses exact module id filter when includeDescendants is false", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listParameters(db, {
      organizationId: "org-1",
      moduleId: "pm-b",
      includeDescendants: false
    });

    expect(calls[0].text).toContain("pd.parameter_module_id = $");
    expect(calls[0].text).not.toContain("pm_node.path like");
    expect(calls[0].values).toContain("pm-b");
  });
});
