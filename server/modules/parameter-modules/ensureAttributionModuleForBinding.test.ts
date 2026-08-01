import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import {
  resolveAttributionModuleForBinding,
} from "./ensureAttributionModuleForBinding";
import { nodeTypeSourceKey } from "./modulePlacement";
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
  kind: "business" | "driver-group" | "node-type" | "unclassified";
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
      if (text.includes("origin = 'auto'") && text.includes("kind <> $3")) {
        const [organizationId, moduleId, kind] = values as [string, string, ModuleRow["kind"]];
        const hit = modules.get(moduleId);
        if (!hit || hit.organizationId !== organizationId || hit.origin !== "auto" || hit.kind === kind) {
          return { rows: [], rowCount: 0 };
        }
        hit.kind = kind;
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
            .filter(
              (module) =>
                module.organizationId === organizationId &&
                module.name === name &&
                (!text.includes("kind = 'business'") || module.kind === "business"),
            )
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
      if (text.includes("from attribution_subjects")) {
        return { rows: [], rowCount: 0 };
      }
      if (
        text.includes("insert into attribution_subjects") ||
        text.includes("insert into driver_registrations") ||
        text.includes("insert into node_type_definitions") ||
        text.includes("update driver_registrations")
      ) {
        inserts.push({ table: "attribution", values });
        return { rows: [{ id: values[0], default_business_category_module_id: values[1] ?? null }], rowCount: 1 };
      }
      if (text.includes("from driver_registrations")) {
        return { rows: [], rowCount: 0 };
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

describe("resolveAttributionModuleForBinding", () => {
  it("resolves bindings through a compatible mapping to the driver group", async () => {
    const { db } = createFakeDb({
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

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });

    expect(moduleId).toBe("mod-hl7603-group");
  });

  it("resolves bindings through a node-type mapping", async () => {
    const { db } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-hl7603-type",
          organizationId: "org-1",
          name: "hl7603",
          parentId: "mod-hl7603-group",
          path: "x/mod-hl7603-type",
          depth: 4,
          kind: "node-type",
          origin: "auto",
          sourceKey: nodeTypeSourceKey("hl7603"),
        }),
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "node-type",
          matchValue: "hl7603",
          moduleId: "mod-hl7603-type",
          priority: 500,
        },
      ],
    });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });

    expect(moduleId).toBe("mod-hl7603-type");
  });

  it("materializes node-type modules with nodetype source keys during auto discovery", async () => {
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
      ],
      mappings: [],
    });

    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "battery0",
      nodeLocator: "/battery_charge_balance/battery0",
    });

    const created = [...modules.values()].find((module) => module.kind === "node-type");
    expect(created?.name).toBe("battery0");
    expect(created?.sourceKey).toBe(nodeTypeSourceKey("battery0"));
  });

  it("preserves a curated rename across re-ingest via source_key (no duplicate)", async () => {
    const sourceKey = nodeTypeSourceKey("hl7603");
    const { db, modules, inserts } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-hl7603-type",
          organizationId: "org-1",
          name: "备用电源旁路",
          parentId: "mod-charger-ic",
          path: "x/mod-hl7603-type",
          depth: 3,
          kind: "node-type",
          origin: "curated",
          sourceKey,
        }),
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "node-type",
          matchValue: "hl7603",
          moduleId: "mod-hl7603-type",
          priority: 500,
        },
      ],
    });

    const first = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });
    const second = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "bypass_bst_hl7603",
      compatible: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@6E",
      nodeLocator: "/amba/i2c@FF24E000/hl7603@6E",
    });

    expect(first).toBe("mod-hl7603-type");
    expect(second).toBe("mod-hl7603-type");
    expect(modules.get("mod-hl7603-type")?.name).toBe("备用电源旁路");
    expect(modules.get("mod-hl7603-type")?.origin).toBe("curated");
    expect([...modules.values()].filter((module) => module.sourceKey === sourceKey)).toHaveLength(1);
  });

  it("does not create per-instance modules for unit-addressed nodes", async () => {
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
      ],
      mappings: [],
    });

    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "new-driver",
      compatible: "vendor,new-driver",
      instanceName: "new_driver@10",
      nodeLocator: "/amba/i2c@FF24E000/new_driver@10",
    });

    expect([...modules.values()].some((module) => module.name === "new_driver@10")).toBe(false);
    expect([...modules.values()].some((module) => module.name === "new_driver" && module.kind === "node-type")).toBe(
      true,
    );
  });

  it("parks scaffolding drivers on the org unclassified root without provisional buckets", async () => {
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

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "amba-bus",
      compatible: "arm,amba-bus",
      instanceName: "amba",
      nodeLocator: "/amba",
    });

    expect(moduleId).toBe(unclassifiedId);
    expect([...modules.values()].some((module) => module.name.startsWith("未分类 · "))).toBe(false);
  });

  it("maps DTS root instance `/` through the board node-type mapping", async () => {
    const { db } = createFakeDb({
      modules: [
        baseModule({
          id: "mod-board",
          organizationId: "org-1",
          name: "board",
          parentId: "mod-board-identity",
          path: "mod-power/mod-board-identity/mod-board",
          depth: 3,
          sortOrder: 1,
          kind: "node-type",
          origin: "auto",
          sourceKey: nodeTypeSourceKey("board"),
        }),
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "node-type",
          matchValue: "board",
          moduleId: "mod-board",
          priority: 500,
        },
      ],
    });

    const moduleId = await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: null,
      compatible: null,
      instanceName: "/",
      nodeLocator: "/",
    });

    expect(moduleId).toBe("mod-board");
  });

  it("places a new auto driver-group under registration default when set (not heuristic)", async () => {
    const { db, modules, inserts } = createFakeDb({
      modules: [
        baseModule({
          id: "biz-wireless",
          organizationId: "org-1",
          name: "Wireless Charging",
          kind: "business",
          origin: "curated",
        }),
        baseModule({
          id: "biz-board",
          organizationId: "org-1",
          name: "Board Identity",
          kind: "business",
          origin: "curated",
        }),
      ],
      mappings: [],
    });

    // Seed registration default via fake query interception.
    (db.query as ReturnType<typeof vi.fn>).mockImplementation(async (text: string, values: unknown[] = []) => {
      if (text.includes("from attribution_subjects") && text.includes("source_key = $2")) {
        return { rows: [{ id: "subj-sc8562" }], rowCount: 1 };
      }
      if (text.includes("from driver_registrations") && text.includes("default_business_category_module_id")) {
        return { rows: [{ default_business_category_module_id: "biz-wireless" }], rowCount: 1 };
      }
      if (
        text.includes("insert into attribution_subjects") ||
        text.includes("insert into driver_registrations") ||
        text.includes("insert into node_type_definitions") ||
        text.includes("update driver_registrations")
      ) {
        inserts.push({ table: "attribution", values });
        return { rows: [{ id: values[0], default_business_category_module_id: values[1] ?? null }], rowCount: 1 };
      }
      if (text.includes("and source_key = $2") && text.includes("from parameter_modules")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from parameter_modules") && text.includes("and id = $2")) {
        const [organizationId, moduleId] = values as [string, string];
        const hit = [...modules.values()].find(
          (module) => module.organizationId === organizationId && module.id === moduleId,
        );
        return { rows: hit ? [toDbRow(hit)] : [], rowCount: hit ? 1 : 0 };
      }
      if (text.includes("from parameter_modules") && text.includes("and name = $2")) {
        const [organizationId, name, parentId] = values as [string, string, string | null];
        if (text.includes("order by depth asc")) {
          const hit = [...modules.values()]
            .filter(
              (module) =>
                module.organizationId === organizationId &&
                module.name === name &&
                (!text.includes("kind = 'business'") || module.kind === "business"),
            )
            .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))[0];
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
      if (text.includes("from parameter_module_mappings")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "vendor,sc8562",
      instanceName: "sc8562@1",
      // Heuristic would pick Charge Pump IC / Board Identity — default must win.
      nodeLocator: "/board",
    });

    const created = [...modules.values()].find((module) => module.kind === "driver-group");
    expect(created?.parentId).toBe("biz-wireless");
    expect(created?.origin).toBe("auto");
  });

  it("does not reparent an existing auto driver-group on re-ingest", async () => {
    const { db, modules } = createFakeDb({
      modules: [
        baseModule({
          id: "biz-old",
          organizationId: "org-1",
          name: "Old Cat",
          kind: "business",
        }),
        baseModule({
          id: "drv-auto",
          organizationId: "org-1",
          name: "sc8562",
          parentId: "biz-old",
          path: "biz-old/drv-auto",
          depth: 2,
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:vendor,sc8562",
        }),
      ],
      mappings: [
        {
          organizationId: "org-1",
          matchKind: "compatible",
          matchValue: "vendor,sc8562",
          moduleId: "drv-auto",
          priority: 300,
        },
      ],
    });

    await resolveAttributionModuleForBinding(db, {
      organizationId: "org-1",
      driverModule: "sc8562",
      compatible: "vendor,sc8562",
      instanceName: "sc8562@1",
      nodeLocator: "/wireless/sc8562@1",
    });

    expect(modules.get("drv-auto")?.parentId).toBe("biz-old");
  });
});
