import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import {
  nodeSourceKey,
  resolveBindingInstanceModuleId,
} from "./ensureInstanceModuleForBinding";
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
  kind: "business" | "driver-group" | "instance" | "unclassified";
  origin: "curated" | "auto";
  sourceKey: string | null;
};

type MappingRow = {
  organizationId: string;
  matchKind: string;
  matchValue: string;
  moduleId: string;
  priority: number;
};

function toDbRow(hit: ModuleRow) {
  return {
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
    kind: hit.kind,
    origin: hit.origin,
    source_key: hit.sourceKey,
  };
}

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
      if (text.includes("and source_key = $2")) {
        const [organizationId, sourceKey] = values as [string, string];
        const hit = [...modules.values()].find(
          (module) => module.organizationId === organizationId && module.sourceKey === sourceKey,
        );
        return { rows: hit ? [toDbRow(hit)] : [], rowCount: hit ? 1 : 0 };
      }
      if (text.includes("set") && text.includes("source_key = coalesce")) {
        const [organizationId, moduleId, sourceKey, kind, origin] = values as [
          string,
          string,
          string,
          string | null,
          string | null,
        ];
        const hit = modules.get(moduleId);
        if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
        hit.sourceKey = hit.sourceKey ?? sourceKey;
        if (kind) hit.kind = kind as ModuleRow["kind"];
        if (origin) hit.origin = origin as ModuleRow["origin"];
        return { rows: [toDbRow(hit)], rowCount: 1 };
      }
      if (text.includes("where organization_id = $1") && text.includes("and id = $2")) {
        const [organizationId, moduleId] = values as [string, string];
        const hit = [...modules.values()].find(
          (module) => module.organizationId === organizationId && module.id === moduleId,
        );
        if (!hit) return { rows: [], rowCount: 0 };
        return { rows: [toDbRow(hit)], rowCount: 1 };
      }
      if (text.includes("from parameter_modules") && text.includes("where organization_id = $1") && text.includes("and name = $2")) {
        const [organizationId, name, parentId] = values as [string, string, string | null];
        if (text.includes("order by depth asc")) {
          const hit = [...modules.values()]
            .filter((module) => module.organizationId === organizationId && module.name === name)
            .sort((left, right) => left.depth - right.depth || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))[0];
          return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
        }
        const hit = [...modules.values()].find(
          (module) =>
            module.organizationId === organizationId &&
            module.name === name &&
            (module.parentId ?? null) === (parentId ?? null),
        );
        return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
      }
      if (text.includes("insert into parameter_modules")) {
        const [
          id,
          organizationId,
          parentId,
          name,
          path,
          depth,
          sortOrder,
          description,
          scope,
          _importance,
          kind,
          origin,
          sourceKey,
        ] = values as [
          string,
          string,
          string | null,
          string,
          string,
          number,
          number,
          string,
          string,
          string?,
          string?,
          string?,
          string | null?,
        ];
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
          kind: (kind as ModuleRow["kind"]) ?? "business",
          origin: (origin as ModuleRow["origin"]) ?? "curated",
          sourceKey: sourceKey ?? null,
        };
        modules.set(id, row);
        inserts.push({ table: "parameter_modules", values });
        return { rows: [toDbRow(row)], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { db, modules, inserts };
}

function baseModule(partial: Partial<ModuleRow> & Pick<ModuleRow, "id" | "organizationId" | "name">): ModuleRow {
  return {
    parentId: null,
    path: partial.id,
    depth: 1,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    ...partial,
  };
}

describe("resolveBindingInstanceModuleId", () => {
  it("creates instance modules under a mapped compatible driver group for Type U", async () => {
    const { db, modules, inserts } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-hl7603-group",
          organizationId: "org-1",
          name: "hl7603",
          parentId: "mod-charger-ic",
          path: "mod-charger-ic/mod-hl7603-group",
          depth: 3,
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:huawei,bypass_bst_hl7603",
        }),
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
    const created = [...modules.values()].find((module) => module.id === moduleId);
    expect(created?.name).toBe("hl7603@6E");
    expect(created?.sourceKey).toBe("node:amba/i2c@FF24E000/hl7603@6E");
    expect(created?.kind).toBe("instance");
    expect(created?.origin).toBe("auto");
    expect(inserts.some((entry) => entry.values.includes("hl7603@6E"))).toBe(true);
  });

  it("preserves a curated rename across re-ingest via source_key (no duplicate)", async () => {
    const sourceKey = nodeSourceKey("/amba/i2c@FF24E000/hl7603@6E", "hl7603@6E");
    const { db, modules, inserts } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-hl7603-group",
          organizationId: "org-1",
          name: "hl7603",
          parentId: "mod-charger-ic",
          path: "mod-charger-ic/mod-hl7603-group",
          depth: 3,
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:huawei,bypass_bst_hl7603",
        }),
        baseModule({
          id: "mod-hl7603-instance",
          organizationId: "org-1",
          name: "备用电源旁路",
          parentId: "mod-hl7603-group",
          path: "mod-charger-ic/mod-hl7603-group/mod-hl7603-instance",
          depth: 4,
          kind: "instance",
          origin: "curated",
          sourceKey,
        }),
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

    const first = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });
    const second = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });

    expect(first).toBe("mod-hl7603-instance");
    expect(second).toBe("mod-hl7603-instance");
    expect(modules.get("mod-hl7603-instance")?.name).toBe("备用电源旁路");
    expect(modules.get("mod-hl7603-instance")?.origin).toBe("curated");
    expect([...modules.values()].filter((module) => module.sourceKey === sourceKey)).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });

  it("nests Type C instances under the parent instance module", async () => {
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-bcb",
          organizationId: "org-1",
          name: "battery_charge_balance",
          parentId: "mod-battery-balance",
          path: "x/mod-bcb",
          depth: 3,
          kind: "instance",
          origin: "auto",
          sourceKey: "node:battery_charge_balance",
        }),
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
    expect(created?.sourceKey).toBe("node:battery_charge_balance/battery0");
  });

  it("uses a provisional unclassified child module when compatible is unmapped", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          parentId: null,
          path: unclassifiedId,
          depth: 1,
          sortOrder: 999,
          kind: "unclassified",
          origin: "auto",
        }),
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
    expect(created?.kind).toBe("unclassified");
    expect(created?.sourceKey).toBe("unclassified:new-driver");
  });

  it("does not create 未分类 · scaffolding buckets for bus/gpio/gic drivers", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          parentId: null,
          path: unclassifiedId,
          depth: 1,
          sortOrder: 999,
          kind: "unclassified",
          origin: "auto",
        }),
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

  it("maps DTS root instance `/` to board under nested Board Identity (never creates `/`)", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          kind: "unclassified",
          origin: "auto",
          sortOrder: 999,
        }),
        baseModule({
          id: "mod-power",
          organizationId: "org-1",
          name: "Power",
          sortOrder: 1,
        }),
        baseModule({
          id: "mod-board-identity",
          organizationId: "org-1",
          name: "Board Identity",
          parentId: "mod-power",
          path: "mod-power/mod-board-identity",
          depth: 2,
          sortOrder: 10,
        }),
        baseModule({
          id: "mod-board",
          organizationId: "org-1",
          name: "board",
          parentId: "mod-board-identity",
          path: "mod-power/mod-board-identity/mod-board",
          depth: 3,
          sortOrder: 1,
          kind: "instance",
          origin: "auto",
          sourceKey: "node:board",
        }),
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "instance",
          matchValue: "board",
          moduleId: "mod-board",
          priority: 500,
        },
      ],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "/",
      nodeLocator: "/",
    });

    expect(moduleId).toBe("mod-board");
    expect([...modules.values()].some((module) => module.name === "/")).toBe(false);
  });

  it("ensures board under nested Board Identity when root `/` has no instance mapping", async () => {
    const unclassifiedId = unclassifiedModuleId("org-1");
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: unclassifiedId,
          organizationId: "org-1",
          name: "未分类",
          kind: "unclassified",
          origin: "auto",
          sortOrder: 999,
        }),
        baseModule({
          id: "mod-power",
          organizationId: "org-1",
          name: "Power",
          sortOrder: 1,
        }),
        baseModule({
          id: "mod-board-identity",
          organizationId: "org-1",
          name: "Board Identity",
          parentId: "mod-power",
          path: "mod-power/mod-board-identity",
          depth: 2,
          sortOrder: 10,
        }),
      ],
      mappings: [],
    });

    const moduleId = await resolveBindingInstanceModuleId(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "/",
      nodeLocator: "/",
    });

    const created = [...modules.values()].find((module) => module.id === moduleId);
    expect(created?.name).toBe("board");
    expect(created?.parentId).toBe("mod-board-identity");
    expect(created?.sourceKey).toBe("node:board");
    expect([...modules.values()].some((module) => module.name === "/")).toBe(false);
    expect(moduleId).not.toBe(unclassifiedId);
  });
});
