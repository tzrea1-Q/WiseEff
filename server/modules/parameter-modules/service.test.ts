import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createModuleMapping,
  disbandDriverGroupModule,
  getParameterModuleRegistry,
  recomputeBindingModules
} from "./service";

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Admin",
      email: "admin@example.com",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
    ...overrides
  } as AuthContext;
}

function makeReadableDb(): Database {
  const query = vi.fn(async (text: string) => {
    if (text.includes("from parameter_modules") && !text.includes("select id from")) {
      return {
        rows: [{
          id: "m1",
          name: "充电策略",
          parent_id: null,
          sort_order: 0,
          importance: "high",
          kind: "business",
          origin: "curated",
          source_key: null,
          path: "m1",
          parameter_count: "0",
        }],
        rowCount: 1
      };
    }
    if (text.includes("from parameter_module_mappings")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("insert into audit_events") || text.includes("into audit_events")) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    query,
    transaction: vi.fn(async (fn) => fn({ query } as never))
  } as unknown as Database;
}

describe("parameter module registry service", () => {
  it("returns the registry for viewers", async () => {
    const db = makeReadableDb();
    const result = await getParameterModuleRegistry(db, makeAuth());
    expect(result.item.modules).toHaveLength(1);
    expect(result.item.modules[0]?.name).toBe("充电策略");
  });

  it("rejects registry reads without view permission", async () => {
    const db = makeReadableDb();
    await expect(
      getParameterModuleRegistry(db, makeAuth({ permissions: [] }))
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects mapping creation without admin permission", async () => {
    const db = makeReadableDb();
    await expect(
      createModuleMapping(db, makeAuth({ permissions: ["parameter:view"] }), {
        moduleId: "m1",
        matchKind: "compatible",
        matchValue: "vendor,sc8562"
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects mapping creation for a missing module", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.startsWith("select id from parameter_modules")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const db = {
      query,
      transaction: vi.fn(async (fn) => fn({ query } as never))
    } as unknown as Database;
    await expect(
      createModuleMapping(db, makeAuth(), {
        moduleId: "missing",
        matchKind: "compatible",
        matchValue: "vendor,sc8562"
      })
    ).rejects.toBeInstanceOf(ApiError);
  });
});

type RecomputeBindingRow = {
  id: string;
  project_id: string;
  logical_node_id: string | null;
  parameter_spec_id: string;
  module_id: string;
  driver_module: string | null;
  compatible: string | null;
  instance_name: string | null;
};

function makeRecomputeDb(input: {
  bindings: RecomputeBindingRow[];
  instanceMappings?: Record<string, string>;
  conflicts?: Set<string>;
}): {
  db: Database;
  updates: Array<{ bindingId: string; moduleId: string }>;
} {
  const updates: Array<{ bindingId: string; moduleId: string }> = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("from project_parameter_bindings") && text.includes("driver_module")) {
      return { rows: input.bindings, rowCount: input.bindings.length };
    }
    if (text.includes("from parameter_module_mappings")) {
      const [, matchKind, matchValue] = values as [string, string, string];
      const moduleId =
        matchKind === "instance" ? input.instanceMappings?.[matchValue] : undefined;
      return {
        rows: moduleId ? [{ parameter_module_id: moduleId }] : [],
        rowCount: moduleId ? 1 : 0
      };
    }
    if (text.includes("insert into parameter_modules")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("from project_parameter_bindings") && text.includes("id <>")) {
      const bindingId = values[values.length - 1] as string;
      return input.conflicts?.has(bindingId)
        ? { rows: [{ id: "other-binding" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.startsWith("update project_parameter_bindings")) {
      const [moduleId, bindingId] = values as [string, string];
      updates.push({ bindingId, moduleId });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("insert into audit_events") || text.includes("into audit_events")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("delete from parameter_modules pm")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const db = {
    query,
    transaction: vi.fn(async (fn) => fn({ query } as never))
  } as unknown as Database;
  return { db, updates };
}

describe("recomputeBindingModules", () => {
  it("rewrites binding module_id from current mappings", async () => {
    const { db, updates } = makeRecomputeDb({
      bindings: [
        {
          id: "bind-1",
          project_id: "proj-1",
          logical_node_id: "ln-1",
          parameter_spec_id: "spec-1",
          module_id: "mod-old",
          driver_module: "sc8562",
          compatible: "vendor,sc8562",
          instance_name: "sc8562@6E"
        }
      ],
      instanceMappings: { "sc8562@6e": "mod-charge" }
    });

    const result = await recomputeBindingModules(db, makeAuth(), {});

    expect(result.updated).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(updates).toEqual([{ bindingId: "bind-1", moduleId: "mod-charge" }]);
  });

  it("skips bindings whose module_id is already correct", async () => {
    const { db, updates } = makeRecomputeDb({
      bindings: [
        {
          id: "bind-1",
          project_id: "proj-1",
          logical_node_id: "ln-1",
          parameter_spec_id: "spec-1",
          module_id: "mod-charge",
          driver_module: "sc8562",
          compatible: "vendor,sc8562",
          instance_name: "sc8562@6E"
        }
      ],
      instanceMappings: { "sc8562@6e": "mod-charge" }
    });

    const result = await recomputeBindingModules(db, makeAuth(), {});

    expect(result.updated).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("returns 409 with conflicting binding ids when the new unique key collides", async () => {
    const { db, updates } = makeRecomputeDb({
      bindings: [
        {
          id: "bind-1",
          project_id: "proj-1",
          logical_node_id: "ln-1",
          parameter_spec_id: "spec-1",
          module_id: "mod-old",
          driver_module: "sc8562",
          compatible: "vendor,sc8562",
          instance_name: "sc8562@6E"
        }
      ],
      instanceMappings: { "sc8562@6e": "mod-charge" },
      conflicts: new Set(["bind-1"])
    });

    await expect(recomputeBindingModules(db, makeAuth(), {})).rejects.toMatchObject({
      status: 409,
      details: { conflicts: ["bind-1"] }
    });
    expect(updates).toHaveLength(0);
  });

  it("rejects recompute without admin permission", async () => {
    const { db } = makeRecomputeDb({ bindings: [] });
    await expect(
      recomputeBindingModules(db, makeAuth({ permissions: ["parameter:view"] }), {})
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("disbandDriverGroupModule", () => {
  it("rejects modules that are not driver groups", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("from parameter_modules") && text.includes("limit 1")) {
        return {
          rows: [
            {
              id: "biz-1",
              organization_id: "org-1",
              parent_id: null,
              name: "业务",
              path: "biz-1",
              depth: 1,
              sort_order: 0,
              description: "",
              scope: "org",
              importance: "medium",
              kind: "business",
              origin: "curated",
              source_key: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const db = {
      query,
      transaction: vi.fn(async (fn) => fn({ query } as never)),
    } as unknown as Database;

    await expect(disbandDriverGroupModule(db, makeAuth(), { moduleId: "biz-1" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });

  it("drops mappings, deletes an empty driver group, and audits", async () => {
    const groupId = "dg-1";
    const deletedModules: string[] = [];
    const audits: Array<{ kind: string; action: string }> = [];

    const query = vi.fn(async (text: string, values: unknown[] = []) => {
      if (text.includes("from parameter_modules") && text.includes("limit 1")) {
        return {
          rows: [
            {
              id: groupId,
              organization_id: "org-1",
              parent_id: "biz-1",
              name: "SC8562",
              path: `biz-1/${groupId}`,
              depth: 2,
              sort_order: 0,
              description: "",
              scope: "org",
              importance: null,
              kind: "driver-group",
              origin: "curated",
              source_key: "compatible:vendor,sc8562",
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("inner join parameter_modules child") || text.includes("child.path like")) {
        return { rows: [{ id: groupId }], rowCount: 1 };
      }
      if (text.includes("delete from parameter_module_mappings") && text.includes("any($2")) {
        return {
          rows: [{ id: "map-1", match_kind: "compatible", match_value: "vendor,sc8562" }],
          rowCount: 1,
        };
      }
      if (text.includes("from project_parameter_bindings") && text.includes("driver_module")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("delete from parameter_modules pm") && text.includes("origin = 'auto'")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("kind = 'unclassified'") && text.includes("origin = 'auto'")) {
        return { rows: [], rowCount: 0 };
      }
      if (
        text.includes("select count(*)::text as count") &&
        text.includes("parent_id = $2")
      ) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (text.includes("select count(*)") && text.includes("parent_id")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (text.includes("count(*)") && text.includes("parameter_definitions")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (text.includes("delete from parameter_modules") && !text.includes(" pm")) {
        deletedModules.push(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("insert into audit_events") || text.includes("into audit_events")) {
        audits.push({ kind: String(values[6]), action: String(values[7]) });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const db = {
      query,
      transaction: vi.fn(async (fn) => fn({ query } as never)),
    } as unknown as Database;

    const result = await disbandDriverGroupModule(db, makeAuth(), { moduleId: groupId });

    expect(result).toEqual({
      removedMappings: 1,
      reparkedBindings: 0,
      deletedDescendants: 0,
    });
    expect(deletedModules).toContain(groupId);
    expect(audits.some((row) => String(row.kind).includes("driver-group-disbanded"))).toBe(true);
  });
});
