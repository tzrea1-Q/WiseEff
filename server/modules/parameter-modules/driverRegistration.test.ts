import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { registerOrClaimDriver } from "./service";

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
  kind: "business" | "driver-group" | "instance" | "logical" | "unclassified";
  origin: "curated" | "auto";
  sourceKey: string | null;
};

type MappingRow = {
  id: string;
  organizationId: string;
  moduleId: string;
  matchKind: "compatible" | "instance";
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
      isActive: true,
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
    ...overrides,
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
    source_key: module.sourceKey,
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
      !text.includes("source_key = $2")
    ) {
      const [organizationId, moduleId] = values as [string, string];
      const hit = modules.get(moduleId);
      if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
      return { rows: [toDbRow(hit)], rowCount: 1 };
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
        ModuleRow["importance"],
        ModuleRow["kind"],
        ModuleRow["origin"],
        string | null,
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
        sourceKey,
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
          row.matchValue === matchValue,
      );
      return {
        rows: hit
          ? [
              {
                id: hit.id,
                parameter_module_id: hit.moduleId,
                match_kind: hit.matchKind,
                match_value: hit.matchValue,
                priority: hit.priority,
              },
            ]
          : [],
        rowCount: hit ? 1 : 0,
      };
    }
    if (text.includes("insert into parameter_module_mappings")) {
      const [id, organizationId, moduleId, matchKind, matchValue, priority] = values as [
        string,
        string,
        string,
        MappingRow["matchKind"],
        string,
        number,
      ];
      const existing = mappings.findIndex(
        (row) =>
          row.organizationId === organizationId &&
          row.matchKind === matchKind &&
          row.matchValue === matchValue,
      );
      if (existing >= 0) {
        mappings[existing] = {
          ...mappings[existing],
          moduleId,
          priority,
        };
      } else {
        mappings.push({ id, organizationId, moduleId, matchKind, matchValue, priority });
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("update parameter_modules") && text.includes("name = $3")) {
      const [
        organizationId,
        moduleId,
        nextName,
        description,
        ,
        ,
        ,
        shouldPromote,
      ] = values as [
        string,
        string,
        string,
        string | null,
        string | null,
        number | null,
        string | null,
        boolean,
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
        number,
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
    if (text.includes("from parameter_modules") && text.includes("order by path")) {
      const [organizationId] = values as [string];
      const rows = [...modules.values()]
        .filter((module) => module.organizationId === organizationId)
        .map((module) => toDbRow(module));
      return { rows, rowCount: rows.length };
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
    transaction: vi.fn(async (fn: (tx: Queryable) => Promise<unknown>) => fn({ query } as Queryable)),
  } as unknown as Database;

  return { db, modules, mappings, audits };
}

describe("registerOrClaimDriver", () => {
  it("registers a curated driver group under a business category with exact compatible mappings", async () => {
    const { db, modules, mappings, audits } = createStatefulDb({
      modules: [
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
          sourceKey: null,
        },
      ],
    });

    const result = await registerOrClaimDriver(db, makeAuth(), {
      displayName: "hl7603",
      businessCategoryId: "biz-power",
      compatibles: ["huawei,bypass_bst_hl7603", "huawei,hl7603"],
      notes: "bypass boost",
    });

    expect(result.mode).toBe("registered");
    expect(result.item.kind).toBe("driver-group");
    expect(result.item.origin).toBe("curated");
    expect(result.item.parentId).toBe("biz-power");
    expect(result.item.name).toBe("hl7603");
    expect(result.item.description).toBe("bypass boost");
    expect(result.item.sourceKey).toBe("compatible:huawei,bypass_bst_hl7603");

    const created = [...modules.values()].find((module) => module.id === result.item.id);
    expect(created?.kind).toBe("driver-group");
    expect(mappings.map((row) => row.matchValue).sort()).toEqual([
      "huawei,bypass_bst_hl7603",
      "huawei,hl7603",
    ]);
    expect(audits.some((entry) => entry.kind === "parameter-module-driver-registered")).toBe(true);
  });

  it("rejects a non-business target category", async () => {
    const { db } = createStatefulDb({
      modules: [
        {
          id: "group-1",
          organizationId: "org-1",
          name: "sc8562",
          parentId: null,
          path: "group-1",
          depth: 1,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:sc8562",
        },
      ],
    });

    await expect(
      registerOrClaimDriver(db, makeAuth(), {
        displayName: "sc8562",
        businessCategoryId: "group-1",
        compatibles: ["sc8562"],
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("claims an existing auto driver group: moves, renames, and promotes to curated", async () => {
    const { db, modules, audits } = createStatefulDb({
      modules: [
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
          sourceKey: null,
        },
        {
          id: "biz-other",
          organizationId: "org-1",
          name: "Other",
          parentId: null,
          path: "biz-other",
          depth: 1,
          sortOrder: 1,
          description: "",
          scope: "",
          importance: "medium",
          kind: "business",
          origin: "curated",
          sourceKey: null,
        },
        {
          id: "auto-group",
          organizationId: "org-1",
          name: "bypass_bst_hl7603",
          parentId: "biz-other",
          path: "biz-other/auto-group",
          depth: 2,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:huawei,bypass_bst_hl7603",
        },
      ],
      mappings: [
        {
          id: "map-1",
          organizationId: "org-1",
          moduleId: "auto-group",
          matchKind: "compatible",
          matchValue: "huawei,bypass_bst_hl7603",
          priority: 0,
        },
      ],
    });

    const result = await registerOrClaimDriver(db, makeAuth(), {
      displayName: "hl7603",
      businessCategoryId: "biz-power",
      compatibles: ["huawei,bypass_bst_hl7603"],
      notes: "claimed",
    });

    expect(result.mode).toBe("claimed");
    expect(result.item.id).toBe("auto-group");
    expect(result.item.origin).toBe("curated");
    expect(result.item.parentId).toBe("biz-power");
    expect(result.item.name).toBe("hl7603");
    expect(modules.get("auto-group")?.origin).toBe("curated");
    expect(modules.get("auto-group")?.parentId).toBe("biz-power");
    expect(audits.some((entry) => entry.metadata?.mode === "claimed")).toBe(true);
  });
});
