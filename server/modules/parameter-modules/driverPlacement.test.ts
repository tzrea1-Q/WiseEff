import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { reparentAutoParameterModule } from "../parameters/parameterModuleRepository";
import { getDriverRegistrationDefaultBusinessCategoryId } from "./driverPlacement";

describe("getDriverRegistrationDefaultBusinessCategoryId", () => {
  it("returns null for a missing default without moving modules", async () => {
    const query = vi.fn(async (_text: string) => ({ rows: [], rowCount: 0 }));

    await expect(getDriverRegistrationDefaultBusinessCategoryId({ query } as Queryable, {
      organizationId: "org-1",
      attributionSubjectId: "subj-auto",
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([text]) =>
      /^\s*select\b/i.test(String(text)) &&
      !/\b(insert|update|delete|merge)\b/i.test(String(text)),
    )).toBe(true);
  });
});

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
  attributionSubjectId: string | null;
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
    attribution_subject_id: hit.attributionSubjectId,
  };
}

function createPlacementDb(seed: {
  modules: ModuleRow[];
}) {
  const modules = new Map(seed.modules.map((row) => [row.id, { ...row }]));

  const db = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (text.includes("from parameter_modules") && text.includes("and id = $2")) {
        const [organizationId, moduleId] = values as [string, string];
        const hit = modules.get(moduleId);
        if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
        return { rows: [toDbRow(hit)], rowCount: 1 };
      }
      if (text.includes("from parameter_modules") && text.includes("order by path asc")) {
        const [organizationId] = values as [string];
        return {
          rows: [...modules.values()]
            .filter((row) => row.organizationId === organizationId)
            .map(toDbRow),
          rowCount: modules.size,
        };
      }
      if (text.includes("update parameter_modules") && text.includes("parent_id = case when id = $2 then $3")) {
        const [organizationId, moduleId, parentId, newPath, oldPath, depthDelta, promote] = values as [
          string,
          string,
          string | null,
          string,
          string,
          number,
          boolean,
        ];
        for (const row of modules.values()) {
          if (row.organizationId !== organizationId) continue;
          if (row.id === moduleId || row.path.startsWith(`${oldPath}/`)) {
            if (row.id === moduleId) {
              row.parentId = parentId;
              row.path = newPath;
              if (promote && row.origin === "auto") row.origin = "curated";
            } else {
              row.path = `${newPath}${row.path.slice(oldPath.length)}`;
            }
            row.depth += depthDelta;
          }
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Queryable;

  return { db, modules };
}

describe("reparentAutoParameterModule", () => {
  it("moves auto modules without promoting to curated", async () => {
    const { db, modules } = createPlacementDb({
      modules: [
        {
          id: "biz-a",
          organizationId: "org-1",
          name: "A",
          parentId: null,
          path: "biz-a",
          depth: 1,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "business",
          origin: "curated",
          sourceKey: null,
          attributionSubjectId: null,
        },
        {
          id: "biz-b",
          organizationId: "org-1",
          name: "B",
          parentId: null,
          path: "biz-b",
          depth: 1,
          sortOrder: 1,
          description: "",
          scope: "",
          importance: "medium",
          kind: "business",
          origin: "curated",
          sourceKey: null,
          attributionSubjectId: null,
        },
        {
          id: "drv-auto",
          organizationId: "org-1",
          name: "AutoDrv",
          parentId: "biz-a",
          path: "biz-a/drv-auto",
          depth: 2,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "auto",
          sourceKey: "compatible:vendor,auto",
          attributionSubjectId: "subj-auto",
        },
      ],
    });

    const result = await reparentAutoParameterModule(db, {
      organizationId: "org-1",
      moduleId: "drv-auto",
      parentId: "biz-b",
    });

    expect(result.status).toBe("moved");
    expect(modules.get("drv-auto")?.parentId).toBe("biz-b");
    expect(modules.get("drv-auto")?.origin).toBe("auto");
  });

  it("skips curated modules", async () => {
    const { db } = createPlacementDb({
      modules: [
        {
          id: "biz-b",
          organizationId: "org-1",
          name: "B",
          parentId: null,
          path: "biz-b",
          depth: 1,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "business",
          origin: "curated",
          sourceKey: null,
          attributionSubjectId: null,
        },
        {
          id: "drv-curated",
          organizationId: "org-1",
          name: "CuratedDrv",
          parentId: "biz-b",
          path: "biz-b/drv-curated",
          depth: 2,
          sortOrder: 0,
          description: "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "curated",
          sourceKey: "compatible:vendor,curated",
          attributionSubjectId: "subj-curated",
        },
      ],
    });

    const result = await reparentAutoParameterModule(db, {
      organizationId: "org-1",
      moduleId: "drv-curated",
      parentId: "biz-b",
    });
    expect(result).toEqual({ status: "skipped", reason: "curated" });
  });
});
