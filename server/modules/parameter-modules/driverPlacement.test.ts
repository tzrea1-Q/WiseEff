import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import {
  replayAutoDriverGroupToRegistrationDefault,
  setDriverRegistrationDefaultBusinessCategoryId,
} from "./driverPlacement";
import { reparentAutoParameterModule } from "../parameters/parameterModuleRepository";

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
  defaults: Map<string, string | null>;
}) {
  const modules = new Map(seed.modules.map((row) => [row.id, { ...row }]));
  const defaults = new Map(seed.defaults);

  const db: Queryable = {
    query: vi.fn(async (text, values = []) => {
      if (text.includes("from attribution_subjects") && text.includes("subject_kind")) {
        return { rows: [{ subject_kind: "driver-registration", organization_id: null }], rowCount: 1 };
      }
      if (text.includes("from driver_registrations") && text.includes("default_business_category_module_id")) {
        const [subjectId] = values as [string];
        return {
          rows: [{ default_business_category_module_id: defaults.get(subjectId) ?? null }],
          rowCount: 1,
        };
      }
      if (text.includes("update driver_registrations") && text.includes("set default_business_category_module_id = $2")) {
        const [subjectId, defaultId] = values as [string, string | null];
        defaults.set(subjectId, defaultId);
        return { rows: [], rowCount: 1 };
      }
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
  };

  return { db, modules, defaults };
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
      defaults: new Map([["subj-auto", "biz-b"]]),
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
      defaults: new Map([["subj-curated", "biz-b"]]),
    });

    const result = await reparentAutoParameterModule(db, {
      organizationId: "org-1",
      moduleId: "drv-curated",
      parentId: "biz-b",
    });
    expect(result).toEqual({ status: "skipped", reason: "curated" });
  });
});

describe("replayAutoDriverGroupToRegistrationDefault", () => {
  it("moves auto driver-group to registration default and freezes curated", async () => {
    const { db, modules, defaults } = createPlacementDb({
      modules: [
        {
          id: "biz-old",
          organizationId: "org-1",
          name: "Old",
          parentId: null,
          path: "biz-old",
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
          id: "biz-new",
          organizationId: "org-1",
          name: "New",
          parentId: null,
          path: "biz-new",
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
          parentId: "biz-old",
          path: "biz-old/drv-auto",
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
        {
          id: "drv-curated",
          organizationId: "org-1",
          name: "CuratedDrv",
          parentId: "biz-old",
          path: "biz-old/drv-curated",
          depth: 2,
          sortOrder: 1,
          description: "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "curated",
          sourceKey: "compatible:vendor,curated",
          attributionSubjectId: "subj-curated",
        },
      ],
      defaults: new Map([
        ["subj-auto", "biz-new"],
        ["subj-curated", "biz-new"],
      ]),
    });

    const autoCounts = await replayAutoDriverGroupToRegistrationDefault(db, {
      organizationId: "org-1",
      moduleId: "drv-auto",
    });
    expect(autoCounts).toEqual({ moved: 1, skippedCurated: 0, skippedMissingDefault: 0 });
    expect(modules.get("drv-auto")?.parentId).toBe("biz-new");
    expect(modules.get("drv-auto")?.origin).toBe("auto");

    const curatedCounts = await replayAutoDriverGroupToRegistrationDefault(db, {
      organizationId: "org-1",
      moduleId: "drv-curated",
    });
    expect(curatedCounts).toEqual({ moved: 0, skippedCurated: 1, skippedMissingDefault: 0 });
    expect(modules.get("drv-curated")?.parentId).toBe("biz-old");

    await setDriverRegistrationDefaultBusinessCategoryId(db, {
      attributionSubjectId: "subj-auto",
      defaultBusinessCategoryModuleId: "biz-old",
    });
    expect(defaults.get("subj-auto")).toBe("biz-old");
  });

  it("counts missing default without moving", async () => {
    const { db } = createPlacementDb({
      modules: [
        {
          id: "drv-auto",
          organizationId: "org-1",
          name: "AutoDrv",
          parentId: null,
          path: "drv-auto",
          depth: 1,
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
      defaults: new Map([["subj-auto", null]]),
    });

    const counts = await replayAutoDriverGroupToRegistrationDefault(db, {
      organizationId: "org-1",
      moduleId: "drv-auto",
    });
    expect(counts).toEqual({ moved: 0, skippedCurated: 0, skippedMissingDefault: 1 });
  });
});
