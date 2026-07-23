import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { resolveBindingInstanceModuleId } from "./ensureInstanceModuleForBinding";
import { unclassifiedModuleId } from "./resolveModuleForBinding";

type ModuleRow = {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  description: string;
  scope: string;
  importance: "medium";
};

type MappingRow = {
  organizationId: string;
  matchKind: string;
  matchValue: string;
  moduleId: string;
  priority: number;
};

function createFakeDb(input: {
  modules?: ModuleRow[];
  mappings?: MappingRow[];
}) {
  const modules = new Map((input.modules ?? []).map((module) => [module.id, { ...module }]));
  const mappings = [...(input.mappings ?? [])];
  const inserts: Array<{ table: string; values: unknown[] }> = [];

  const db: Queryable = {
    query: vi.fn(async (text, values = []) => {
      if (text.includes("from parameter_module_mappings")) {
        const [organizationId, matchKind, matchValue] = values as [string, string, string];
        const hit = mappings
          .filter(
            (row) =>
              row.organizationId === organizationId &&
              row.matchKind === matchKind &&
              row.matchValue === matchValue,
          )
          .sort((a, b) => b.priority - a.priority)[0];
        return { rows: hit ? [{ parameter_module_id: hit.moduleId }] : [], rowCount: hit ? 1 : 0 };
      }
      if (text.includes("where organization_id = $1") && text.includes("and id = $2")) {
        const [organizationId, moduleId] = values as [string, string];
        const hit = [...modules.values()].find(
          (module) => module.organizationId === organizationId && module.id === moduleId,
        );
        if (!hit) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: hit.id,
              organization_id: hit.organizationId,
              parent_id: hit.parentId,
              name: hit.name,
              path: hit.path,
              depth: hit.depth,
              sort_order: hit.sortOrder,
              description: hit.description,
              scope: hit.scope,
              importance: hit.importance,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("from parameter_modules") && text.includes("where organization_id = $1") && text.includes("and name = $2")) {
        const [organizationId, name, parentId] = values as [string, string, string | null];
        const hit = [...modules.values()].find(
          (module) =>
            module.organizationId === organizationId &&
            module.name === name &&
            (module.parentId ?? null) === (parentId ?? null),
        );
        return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
      }
      if (text.includes("insert into parameter_modules")) {
        const [id, organizationId, parentId, name, path, depth, sortOrder, description, scope] =
          values as [string, string, string | null, string, string, number, number, string, string, string?];
        if (modules.has(id)) {
          return { rows: [], rowCount: 0 };
        }
        const row: ModuleRow = {
          id,
          organizationId,
          name,
          parentId,
          path,
          depth,
          sortOrder,
          description,
          scope,
          importance: "medium",
        };
        modules.set(id, row);
        inserts.push({ table: "parameter_modules", values });
        return {
          rows: [
            {
              id,
              organization_id: organizationId,
              parent_id: parentId,
              name,
              path,
              depth,
              sort_order: sortOrder,
              description,
              scope,
              importance: "medium",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { db, modules, inserts };
}

describe("resolveBindingInstanceModuleId", () => {
  it("creates instance modules under a mapped compatible driver group for Type U", async () => {
    const { db, modules, inserts } = createFakeDb({
      modules: [
        {
          id: "mod-hl7603-group",
          organizationId: "org-1",
          name: "hl7603",
          parentId: "mod-charger-ic",
          path: "mod-charger-ic/mod-hl7603-group",
          depth: 3,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
        },
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "huawei,bypass_bst_hl7603",
          moduleId: "mod-hl7603-group",
          priority: 300,
        },
      ],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });

    expect(moduleId).not.toBe("mod-hl7603-group");
    expect([...modules.values()].some((module) => module.name === "hl7603@6E")).toBe(true);
    expect(inserts.some((entry) => entry.values.includes("hl7603@6E"))).toBe(true);
  });

  it("nests Type C instances under the parent instance module", async () => {
    const { db, modules } = createFakeDb({
      modules: [
        {
          id: "mod-bcb",
          organizationId: "org-1",
          name: "battery_charge_balance",
          parentId: "mod-battery-balance",
          path: "x/mod-bcb",
          depth: 3,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
        },
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "instance",
          matchValue: "battery_charge_balance",
          moduleId: "mod-bcb",
          priority: 500,
        },
      ],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "battery0",
      nodeLocator: "/battery_charge_balance/battery0",
    });

    const created = [...modules.values()].find((module) => module.id === moduleId);
    expect(created?.name).toBe("battery0");
    expect(created?.parentId).toBe("mod-bcb");
  });

  it("uses a provisional unclassified child module when compatible is unmapped", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        {
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          parentId: null,
          path: unclassifiedId,
          depth: 1,
          sortOrder: 999,
          description: "",
          scope: "",
          importance: "medium",
        },
      ],
      mappings: [],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: "new-driver",
      compatible: "vendor,new-driver",
      instanceName: "new_driver@10",
      nodeLocator: "/amba/i2c@FF24E000/new_driver@10",
    });

    const created = [...modules.values()].find((module) => module.id === moduleId);
    expect(created?.name).toBe("未分类 · new-driver");
    expect(created?.parentId).toBe(unclassifiedId);
  });

  it("does not create 未分类 · scaffolding buckets for bus/gpio/gic drivers", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        {
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          parentId: null,
          path: unclassifiedId,
          depth: 1,
          sortOrder: 999,
          description: "",
          scope: "",
          importance: "medium",
        },
      ],
      mappings: [],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: "amba-bus",
      compatible: "arm,amba-bus",
      instanceName: "amba",
      nodeLocator: "/amba",
    });

    expect(moduleId).toBe(unclassifiedId);
    expect([...modules.values()].some((module) => module.name.startsWith("未分类 · "))).toBe(false);
  });
});
