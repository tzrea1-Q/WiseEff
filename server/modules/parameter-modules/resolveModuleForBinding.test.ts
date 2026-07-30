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
  it("prefers a compatible mapping over a node-type mapping", async () => {
    const { db } = createFakeDb({
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "richtek,sc8562",
          moduleId: "mod-compatible",
          priority: 0,
        },
        {
          organizationId: "org-1",
          matchKind: "node-type",
          matchValue: "sc8562",
          moduleId: "mod-nodetype",
          priority: 0,
        },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      nodeType: "sc8562",
    });

    expect(moduleId).toBe("mod-compatible");
  });

  it("falls back to a node-type mapping when no compatible mapping matches", async () => {
    const { db } = createFakeDb({
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "node-type",
          matchValue: "middle_cpu",
          moduleId: "mod-middle-cpu",
          priority: 0,
        },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "middle_cpu",
      compatible: null,
      nodeType: "middle_cpu",
    });

    expect(moduleId).toBe("mod-middle-cpu");
  });

  it("treats DTS-quoted compatible as equal to an unquoted mapping value", async () => {
    const { db } = createFakeDb({
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "mt,mt5788",
          moduleId: "mod-mt5788",
          priority: 300,
        },
      ],
    });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "mt5788",
      compatible: '"mt,mt5788"',
      nodeType: null,
    });

    expect(moduleId).toBe("mod-mt5788");
  });

  it("does not match retired instance mappings", async () => {
    const { db, insertedModules } = createFakeDb({
      mappings: [
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
      nodeType: "sc8562",
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    expect(insertedModules).toHaveLength(1);
  });

  it("ensures and returns the deterministic unclassified module when no mapping matches", async () => {
    const { db, insertedModules } = createFakeDb({ mappings: [] });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "richtek,sc8562",
      nodeType: "sc8562",
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
    expect(insertedModules).toHaveLength(1);
    expect(insertedModules[0]).toMatchObject({ organizationId: "org-1", name: "未分类" });
  });

  it("never returns null/undefined even when driver/compatible/nodeType are all null", async () => {
    const { db } = createFakeDb({ mappings: [] });

    const moduleId = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null,
    });

    expect(moduleId).toBe(unclassifiedModuleId("org-1"));
  });

  it("is stable across organizations (id is org-scoped) and idempotent across calls", async () => {
    const { db } = createFakeDb({ mappings: [] });

    const first = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null,
    });
    const second = await resolveModuleIdForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      nodeType: null,
    });
    const otherOrg = await resolveModuleIdForBinding(db, {
      organizationId: "org-2",
      driverModule: null,
      compatible: null,
      nodeType: null,
    });

    expect(first).toBe(second);
    expect(first).not.toBe(otherOrg);
  });
});
