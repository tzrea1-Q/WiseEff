import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createParameterModuleBodySchema } from "./schemas";
import { createParameterModuleForAuth } from "./service";

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
  importance: "high" | "medium" | "low";
  kind: "business" | "driver-group" | "node-type" | "unclassified";
  origin: "curated" | "auto";
  sourceKey: string | null;
};

type MappingRow = {
  id: string;
  organizationId: string;
  moduleId: string;
  matchKind: "compatible" | "node-type";
  matchValue: string;
  priority: number;
};

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

function toDbRow(module: ModuleRow) {
  return {
    id: module.id,
    organization_id: module.organizationId,
    parent_id: module.parentId,
    name: module.name,
    path: module.path,
    depth: module.depth,
    sort_order: module.sortOrder,
    description: module.description,
    scope: module.scope,
    importance: module.importance,
    kind: module.kind,
    origin: module.origin,
    source_key: module.sourceKey
  };
}

function createStatefulDb(seed: { modules?: ModuleRow[]; mappings?: MappingRow[] }) {
  const modules = new Map((seed.modules ?? []).map((module) => [module.id, { ...module }]));
  const mappings = [...(seed.mappings ?? [])];
  const audits: Array<{ kind: string; metadata: Record<string, unknown> }> = [];

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (
      text.includes("from parameter_modules") &&
      text.includes("organization_id = $1") &&
      text.includes("id = $2") &&
      text.includes("limit 1") &&
      !text.includes("source_key = $2") &&
      !text.includes("name = $2")
    ) {
      const [organizationId, moduleId] = values as [string, string];
      const hit = modules.get(moduleId);
      if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
      return { rows: [toDbRow(hit)], rowCount: 1 };
    }
    if (
      text.includes("from parameter_modules") &&
      text.includes("name = $2") &&
      text.includes("coalesce(parent_id")
    ) {
      const [organizationId, name, parentId] = values as [string, string, string | null];
      const hit = [...modules.values()].find(
        (module) =>
          module.organizationId === organizationId &&
          module.name === name &&
          (module.parentId ?? null) === (parentId ?? null)
      );
      return {
        rows: hit ? [toDbRow(hit)] : [],
        rowCount: hit ? 1 : 0
      };
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
        importance,
        kind,
        origin,
        sourceKey
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
        ModuleRow["importance"],
        ModuleRow["kind"],
        ModuleRow["origin"],
        string | null
      ];
      const row: ModuleRow = {
        id,
        organizationId,
        parentId,
        name,
        path,
        depth,
        sortOrder,
        description,
        scope,
        importance,
        kind,
        origin,
        sourceKey
      };
      modules.set(id, row);
      return { rows: [toDbRow(row)], rowCount: 1 };
    }
    if (
      text.includes("from parameter_module_mappings") &&
      text.includes("match_kind = 'compatible'") &&
      text.includes("match_value = $2")
    ) {
      const [organizationId, matchValue] = values as [string, string];
      const hit = mappings.find(
        (row) =>
          row.organizationId === organizationId &&
          row.matchKind === "compatible" &&
          row.matchValue === matchValue
      );
      return {
        rows: hit
          ? [
              {
                id: hit.id,
                parameter_module_id: hit.moduleId,
                match_kind: hit.matchKind,
                match_value: hit.matchValue,
                priority: hit.priority
              }
            ]
          : [],
        rowCount: hit ? 1 : 0
      };
    }
    if (text.includes("insert into parameter_module_mappings")) {
      const [id, organizationId, moduleId, matchKind, matchValue, priority] = values as [
        string,
        string,
        string,
        MappingRow["matchKind"],
        string,
        number
      ];
      mappings.push({ id, organizationId, moduleId, matchKind, matchValue, priority });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("update parameter_modules") && text.includes("name = $3")) {
      const [organizationId, moduleId, nextName, description, , , , shouldPromote] = values as [
        string,
        string,
        string,
        string | null,
        string | null,
        number | null,
        string | null,
        boolean
      ];
      const hit = modules.get(moduleId);
      if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
      hit.name = nextName;
      if (description !== null) hit.description = description;
      if (shouldPromote) hit.origin = "curated";
      return { rows: [toDbRow(hit)], rowCount: 1 };
    }
    if (text.includes("update parameter_modules") && text.includes("parent_id = $3")) {
      const [organizationId, moduleId, parentId, newPath, oldPath, depthDelta] = values as [
        string,
        string,
        string | null,
        string,
        string,
        number
      ];
      for (const module of modules.values()) {
        if (module.organizationId !== organizationId) continue;
        if (module.id === moduleId || module.path.startsWith(`${oldPath}/`)) {
          if (module.id === moduleId) {
            module.parentId = parentId;
            if (module.origin === "auto") module.origin = "curated";
          }
          module.path =
            module.id === moduleId ? newPath : `${newPath}${module.path.slice(oldPath.length)}`;
          module.depth += depthDelta;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("into audit_events") || text.includes("insert into audit_events")) {
      const kind = String(values[6] ?? "");
      const rawMetadata = values[11];
      const metadata =
        typeof rawMetadata === "string"
          ? (JSON.parse(rawMetadata) as Record<string, unknown>)
          : ((rawMetadata as Record<string, unknown>) ?? {});
      audits.push({ kind, metadata });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const db = {
    query,
    transaction: vi.fn(async (fn: (tx: Queryable) => Promise<unknown>) => fn({ query } as Queryable))
  } as unknown as Database;

  return { db, modules, mappings, audits };
}

const seedTree = (): ModuleRow[] => [
  {
    id: "biz-power",
    organizationId: "org-1",
    name: "Power",
    parentId: null,
    path: "biz-power",
    depth: 1,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "high",
    kind: "business",
    origin: "curated",
    sourceKey: null
  },
  {
    id: "dg-sc8562",
    organizationId: "org-1",
    name: "sc8562",
    parentId: "biz-power",
    path: "biz-power/dg-sc8562",
    depth: 2,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "driver-group",
    origin: "auto",
    sourceKey: "compatible:huawei,sc8562"
  }
];

describe("createParameterModuleBodySchema", () => {
  it("rejects driver-group without compatibles", () => {
    const result = createParameterModuleBodySchema.safeParse({
      name: "hl7603",
      kind: "driver-group",
      parentId: "biz-power",
      compatibles: []
    });
    expect(result.success).toBe(false);
  });

  it("accepts node-type kind and rejects instance kind", () => {
    expect(
      createParameterModuleBodySchema.safeParse({
        name: "usb0",
        kind: "node-type",
        parentId: "biz-power",
        sourceKey: "nodetype:usb0"
      }).success
    ).toBe(true);
    expect(
      createParameterModuleBodySchema.safeParse({
        name: "usb0",
        kind: "instance",
        parentId: "dg-1",
        sourceKey: "path:/soc/usb@0"
      }).success
    ).toBe(false);
  });
});

describe("createParameterModuleForAuth", () => {
  it("creates curated business, driver-group, and node-type modules with parent rules", async () => {
    const { db, modules, mappings } = createStatefulDb({ modules: seedTree() });

    const business = await createParameterModuleForAuth(db, makeAuth(), {
      name: "Thermal",
      kind: "business",
      importance: "high"
    });
    expect(business.kind).toBe("business");
    expect(business.origin).toBe("curated");
    expect(business.parentId).toBeNull();

    const driverGroup = await createParameterModuleForAuth(db, makeAuth(), {
      name: "hl7603",
      kind: "driver-group",
      parentId: "biz-power",
      compatibles: ["huawei,bypass_bst_hl7603"],
      description: "pre-upload"
    });
    expect(driverGroup.kind).toBe("driver-group");
    expect(driverGroup.origin).toBe("curated");
    expect(driverGroup.parentId).toBe("biz-power");
    expect(mappings.some((row) => row.matchValue === "huawei,bypass_bst_hl7603")).toBe(true);

    const nodeType = await createParameterModuleForAuth(db, makeAuth(), {
      name: "regulator-dummy",
      kind: "node-type",
      parentId: "biz-power",
      sourceKey: "nodetype:regulator-dummy"
    });
    expect(nodeType.kind).toBe("node-type");
    expect(nodeType.origin).toBe("curated");
    expect(nodeType.parentId).toBe("biz-power");
    expect(nodeType.sourceKey).toBe("nodetype:regulator-dummy");

    expect([...modules.values()].some((module) => module.id === nodeType.id)).toBe(true);
  });

  it("rejects invalid parents", async () => {
    const { db } = createStatefulDb({ modules: seedTree() });

    await expect(
      createParameterModuleForAuth(db, makeAuth(), {
        name: "bad-dg",
        kind: "driver-group",
        parentId: "dg-sc8562",
        compatibles: ["huawei,x"]
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" } satisfies Partial<ApiError>);

    // node-type may nest under driver-group (ADR-0010 / ADR-0013).
    const nested = await createParameterModuleForAuth(db, makeAuth(), {
      name: "nested-under-driver",
      kind: "node-type",
      parentId: "dg-sc8562",
      sourceKey: "nodetype:usb0"
    });
    expect(nested.parentId).toBe("dg-sc8562");
    expect(nested.kind).toBe("node-type");

    await expect(
      createParameterModuleForAuth(db, makeAuth(), {
        name: "bad-node-type-root",
        kind: "node-type",
        parentId: null,
        sourceKey: "nodetype:regulator-dummy"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" } satisfies Partial<ApiError>);
  });

  it("claims an existing compatible mapping when creating a driver-group", async () => {
    const { db, modules } = createStatefulDb({
      modules: seedTree(),
      mappings: [
        {
          id: "map-1",
          organizationId: "org-1",
          moduleId: "dg-sc8562",
          matchKind: "compatible",
          matchValue: "huawei,sc8562",
          priority: 0
        }
      ]
    });

    const result = await createParameterModuleForAuth(db, makeAuth(), {
      name: "sc8562-claimed",
      kind: "driver-group",
      parentId: "biz-power",
      compatibles: ["huawei,sc8562"]
    });

    expect(result.id).toBe("dg-sc8562");
    expect(result.name).toBe("sc8562-claimed");
    expect(modules.get("dg-sc8562")?.origin).toBe("curated");
  });
});
