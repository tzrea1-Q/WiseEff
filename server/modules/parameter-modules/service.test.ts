import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createModuleMapping,
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
        rows: [{ id: "m1", name: "充电策略", parent_id: null, sort_order: 0, importance: "high" }],
        rowCount: 1
      };
    }
    if (text.includes("from parameter_module_mappings")) {
      return { rows: [], rowCount: 0 };
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
        matchKind: "driver",
        matchValue: "sc8562"
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
        matchKind: "driver",
        matchValue: "sc8562"
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
  driverMappings?: Record<string, string>;
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
        matchKind === "driver" ? input.driverMappings?.[matchValue] : undefined;
      return {
        rows: moduleId ? [{ parameter_module_id: moduleId }] : [],
        rowCount: moduleId ? 1 : 0
      };
    }
    if (text.includes("insert into parameter_modules")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("from project_parameter_bindings") && text.includes("id <>")) {
      // conflict pre-check: exclude id is the last value
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
          compatible: null,
          instance_name: null
        }
      ],
      driverMappings: { sc8562: "mod-charge" }
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
          compatible: null,
          instance_name: null
        }
      ],
      driverMappings: { sc8562: "mod-charge" }
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
          compatible: null,
          instance_name: null
        }
      ],
      driverMappings: { sc8562: "mod-charge" },
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
