import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { resolveModuleIdForBinding, unclassifiedModuleId } from "./resolveModuleForBinding";

type MappingRow = { organizationId: string; matchKind: string; matchValue: string; moduleId: string; priority: number };

function createFakeDb(input: { mappings: MappingRow[]; existingModuleIds?: Set<string> }): {
  db: Queryable;
  insertedModules: Array<{ id: string; organizationId: string; name: string }>;
} {
  const modules = new Set(input.existingModuleIds ?? []);
  const insertedModules: Array<{ id: string; organizationId: string; name: string }> = [];

  const db: Queryable = {
    query: vi.fn(async (text, values = []) => {
      if (text.includes("from parameter_module_mappings")) {
        const [organizationId, matchKind, matchValue] = values as [string, string, string];
        const matches = input.mappings
          .filter(
            (row) =>
              row.organizationId === organizationId &&
              row.matchKind === matchKind &&
              row.matchValue === matchValue,
          )
          .sort((a, b) => b.priority - a.priority);
        return {
          rows: matches[0] ? [{ parameter_module_id: matches[0].moduleId }] : [],
          rowCount: matches.length,
        };
      }
      if (text.includes("insert into parameter_modules")) {
        const [id, organizationId, name] = values as [string, string, string];
        if (!modules.has(id)) {
          modules.add(id);
          insertedModules.push({ id, organizationId, name });
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { db, insertedModules };
}

describe("resolveModuleIdForBinding", () => {
  it("prefers an instance mapping over compatible and driver mappings", async () => {
    const { db } = createFakeDb({
      mappings: [
        { organizationId: "org-1", matchKind: "driver", matchValue: "sc8562", moduleId: "mod-driver", priority: 0 },
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "richtek,sc8562",
          moduleId: "mod-compatible",
          priority: 0,
        },
        {
          organizationId: "org-1",
          matchKind: "instance",
          matchValue: "sc8562@6e",
          moduleId: "mod-instance",
          priority: 0,
        },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      instanceName: "sc8562@6E",
    });

    expect(moduleId).toBe("mod-instance");
  });

  it("falls back to a compatible mapping when no instance mapping matches", async () => {
    const { db } = createFakeDb({
      mappings: [
        { organizationId: "org-1", matchKind: "driver", matchValue: "sc8562", moduleId: "mod-driver", priority: 0 },
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "richtek,sc8562",
          moduleId: "mod-compatible",
          priority: 0,
        },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      instanceName: "sc8562@6E",
    });

    expect(moduleId).toBe("mod-compatible");
  });

  it("falls back to a driver mapping when no instance/compatible mapping matches", async () => {
    const { db } = createFakeDb({
      mappings: [
        { organizationId: "org-1", matchKind: "driver", matchValue: "sc8562", moduleId: "mod-driver", priority: 0 },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      instanceName: "sc8562@6E",
    });

    expect(moduleId).toBe("mod-driver");
  });

  it("ensures and returns the deterministic unclassified module when no mapping matches", async () => {
    const { db, insertedModules } = createFakeDb({ mappings: [] });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      instanceName: "sc8562@6E",
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    expect(insertedModules).toHaveLength(1);
    expect(insertedModules[0]).toMatchObject({ organizationId: "org-1", name: "未分类" });
  });

  it("never returns null/undefined even when driver/compatible/instance are all null", async () => {
    const { db } = createFakeDb({ mappings: [] });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: null,
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
  });

  it("is stable across organizations (id is org-scoped) and idempotent across calls", async () => {
    const { db } = createFakeDb({ mappings: [] });

    const first = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: null,
    });
    const second = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: null,
    });
    const otherOrg = await resolveModuleIdForBinding(db, {
      organizationId: "org-2",
      driverModule: null,
      compatible: null,
      instanceName: null,
    });

    expect(first).toBe(second);
    expect(first).not.toBe(otherOrg);
  });
});
