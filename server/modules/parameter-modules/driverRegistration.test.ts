import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { ApiError } from "../../shared/http/errors";
import { registerOrClaimDriver, updateDriverRegistration } from "./service";

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
  attributionSubjectId?: string | null;
};

type MappingRow = {
  id: string;
  organizationId: string;
  moduleId: string;
  matchKind: "compatible" | "instance" | "node-type";
  matchValue: string;
  priority: number;
};

type SubjectRow = {
  id: string;
  organizationId: string | null;
};

type RegistrationRow = {
  attributionSubjectId: string;
  driverNature: "physical-device" | "logical-service";
  instanceCardinality: "multiple" | "singleton-per-project";
};

type TipRevisionRow = {
  id: string;
  projectId: string;
  configSetId: string;
  organizationId: string;
  revisionNumber: number;
  status: string;
};

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Admin",
      email: "admin@example.com",
      organizationName: "ChargeLab",
      permissions: ["parameter:view", "parameter:edit", "admin:access"],
    }),
    ...overrides,
  };
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
    attribution_subject_id: module.attributionSubjectId ?? null,
  };
}

type BindingRow = {
  id: string;
  organizationId: string;
  projectId: string;
  logicalNodeId: string;
  parameterSpecId: string;
  moduleId: string;
  driverModule: string | null;
  compatible: string | null;
  instanceName: string | null;
};

function createStatefulDb(seed: {
  modules?: ModuleRow[];
  mappings?: MappingRow[];
  subjects?: SubjectRow[];
  registrations?: RegistrationRow[];
  tipRevisions?: TipRevisionRow[];
  bindings?: BindingRow[];
}) {
  const modules = new Map((seed.modules ?? []).map((module) => [module.id, { ...module }]));
  const mappings = [...(seed.mappings ?? [])];
  const bindings = [...(seed.bindings ?? [])];
  const subjects = new Map((seed.subjects ?? []).map((subject) => [subject.id, { ...subject }]));
  const registrations = new Map(
    (seed.registrations ?? []).map((registration) => [
      registration.attributionSubjectId,
      { ...registration },
    ]),
  );
  const tipRevisions = [...(seed.tipRevisions ?? [])];
  const audits: Array<{
    kind: string;
    organizationId: string | null;
    metadata: Record<string, unknown>;
  }> = [];
  const syncCalls: Array<{ organizationId: string; projectId: string; configRevisionId: string }> =
    [];

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (
      text.includes("from parameter_modules pm") &&
      text.includes("inner join attribution_subjects subject") &&
      text.includes("inner join driver_registrations dr") &&
      text.includes("pm.kind = 'driver-group'")
    ) {
      const [organizationId, moduleId] = values as [string, string];
      const hit = modules.get(moduleId);
      if (!hit || hit.organizationId !== organizationId || !hit.attributionSubjectId) {
        return { rows: [], rowCount: 0 };
      }
      const subject = subjects.get(hit.attributionSubjectId);
      const registration = registrations.get(hit.attributionSubjectId);
      if (!subject || !registration) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            module_id: hit.id,
            attribution_subject_id: hit.attributionSubjectId,
            subject_organization_id: subject.organizationId,
            driver_nature: registration.driverNature,
            instance_cardinality: registration.instanceCardinality,
          },
        ],
        rowCount: 1,
      };
    }
    if (
      text.includes("update driver_registrations") &&
      text.includes("driver_nature = $2") &&
      text.includes("instance_cardinality = $3")
    ) {
      const [subjectId, driverNature, instanceCardinality] = values as [
        string,
        RegistrationRow["driverNature"],
        RegistrationRow["instanceCardinality"],
      ];
      const hit = registrations.get(subjectId);
      if (!hit) return { rows: [], rowCount: 0 };
      hit.driverNature = driverNature;
      hit.instanceCardinality = instanceCardinality;
      return { rows: [], rowCount: 1 };
    }
    if (
      text.includes("from dts_config_revisions") &&
      text.includes("distinct on (project_id, config_set_id)") &&
      text.includes("status <> 'resolving'")
    ) {
      const [organizationId] = values as [string];
      const sorted = tipRevisions
        .filter((revision) => revision.organizationId === organizationId)
        .sort((left, right) => {
          if (left.projectId !== right.projectId) {
            return left.projectId.localeCompare(right.projectId);
          }
          if (left.configSetId !== right.configSetId) {
            return left.configSetId.localeCompare(right.configSetId);
          }
          return right.revisionNumber - left.revisionNumber;
        });
      const seen = new Set<string>();
      const rows = [];
      for (const revision of sorted) {
        const key = `${revision.projectId}:${revision.configSetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ id: revision.id, project_id: revision.projectId });
      }
      return { rows, rowCount: rows.length };
    }
    if (
      text.includes("from dts_logical_node_revisions lnr") &&
      text.includes("instance_cardinality = 'singleton-per-project'")
    ) {
      const [organizationId, projectId, configRevisionId] = values as [string, string, string];
      syncCalls.push({ organizationId, projectId, configRevisionId });
      return { rows: [], rowCount: 0 };
    }
    if (
      text.includes("update identity_mapping_tasks") &&
      text.includes("task_kind = 'singleton-cardinality'")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("from parameter_modules") && text.includes("source_key = $2")) {
      const [organizationId, sourceKey] = values as [string, string];
      const hit = [...modules.values()].find(
        (module) => module.organizationId === organizationId && module.sourceKey === sourceKey,
      );
      return hit ? { rows: [toDbRow(hit)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
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
    if (
      text.includes("from parameter_module_mappings mm") &&
      text.includes("inner join parameter_modules pm")
    ) {
      const [organizationId, matchKind, matchValue] = values as [string, string, string];
      const hit = mappings.find(
        (row) =>
          row.organizationId === organizationId &&
          row.matchKind === matchKind &&
          row.matchValue === matchValue,
      );
      return {
        rows: hit ? [{ parameter_module_id: hit.moduleId }] : [],
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
    if (text.includes("from project_parameter_bindings") && text.includes("driver_module")) {
      const [organizationId, projectId] = values as [string, string | null];
      const rows = bindings
        .filter(
          (binding) =>
            binding.organizationId === organizationId &&
            (projectId == null || binding.projectId === projectId),
        )
        .map((binding) => ({
          id: binding.id,
          project_id: binding.projectId,
          logical_node_id: binding.logicalNodeId,
          parameter_spec_id: binding.parameterSpecId,
          module_id: binding.moduleId,
          driver_module: binding.driverModule,
          compatible: binding.compatible,
          instance_name: binding.instanceName,
          node_locator: null,
        }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes("from project_parameter_bindings") && text.includes("id <>")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("update project_parameter_bindings") && text.includes("module_id = $1")) {
      const [moduleId, bindingId, organizationId] = values as [string, string, string];
      const hit = bindings.find(
        (binding) => binding.id === bindingId && binding.organizationId === organizationId,
      );
      if (hit) hit.moduleId = moduleId;
      return { rows: [], rowCount: hit ? 1 : 0 };
    }
    if (text.includes("id = any($2::text[])")) {
      const [organizationId, moduleIds] = values as [string, string[]];
      const rows = moduleIds
        .map((moduleId) => modules.get(moduleId))
        .filter((module): module is ModuleRow => Boolean(module && module.organizationId === organizationId))
        .map((module) => ({ id: module.id, name: module.name }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes("delete from parameter_modules pm") && text.includes("未分类 · %")) {
      return { rows: [], rowCount: 0 };
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
    if (text.includes("update parameter_modules") && text.includes("parent_id = case when id = $2 then $3")) {
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
      const organizationId = (values[1] as string | null) ?? null;
      const kind = String(values[6] ?? "");
      const rawMetadata = values[11];
      const metadata =
        typeof rawMetadata === "string"
          ? (JSON.parse(rawMetadata) as Record<string, unknown>)
          : ((rawMetadata as Record<string, unknown>) ?? {});
      audits.push({ kind, organizationId, metadata });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const db = {
    query,
    transaction: vi.fn(async (fn: (tx: Queryable) => Promise<unknown>) => fn({ query } as Queryable)),
  } as unknown as Database;

  return { db, modules, mappings, bindings, audits, registrations, syncCalls, query };
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
    expect(result.apply.affectedBindings).toBe(0);
  });

  it("applies scoped binding recompute for registered compatibles without a full-org pass", async () => {
    const { db, bindings, audits } = createStatefulDb({
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
          id: "mod-unclassified",
          organizationId: "org-1",
          name: "未分类",
          parentId: null,
          path: "mod-unclassified",
          depth: 1,
          sortOrder: 999,
          description: "",
          scope: "",
          importance: "medium",
          kind: "unclassified",
          origin: "auto",
          sourceKey: null,
        },
      ],
      bindings: [
        {
          id: "bind-1",
          organizationId: "org-1",
          projectId: "proj-1",
          logicalNodeId: "ln-1",
          parameterSpecId: "spec-1",
          moduleId: "mod-unclassified",
          driverModule: "hl7603",
          compatible: "huawei,hl7603",
          instanceName: "hl7603@0",
        },
      ],
    });

    const result = await registerOrClaimDriver(db, makeAuth(), {
      displayName: "hl7603",
      businessCategoryId: "biz-power",
      compatibles: ["huawei,hl7603"],
    });

    expect(result.mode).toBe("registered");
    expect(result.apply.affectedBindings).toBe(1);
    expect(result.apply.toModuleId).toBe(result.item.id);
    expect(bindings[0]?.moduleId).toBe(result.item.id);
    expect(audits.some((entry) => entry.metadata?.affectedBindings === 1)).toBe(true);
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

describe("updateDriverRegistration", () => {
  const orgDriverSeed = {
    modules: [
      {
        id: "driver-1",
        organizationId: "org-1",
        name: "hl7603",
        parentId: "biz-power",
        path: "biz-power/driver-1",
        depth: 2,
        sortOrder: 0,
        description: "",
        scope: "",
        importance: "medium" as const,
        kind: "driver-group" as const,
        origin: "curated" as const,
        sourceKey: "compatible:hl7603",
        attributionSubjectId: "asub-org-1",
      },
    ],
    subjects: [{ id: "asub-org-1", organizationId: "org-1" as string | null }],
    registrations: [
      {
        attributionSubjectId: "asub-org-1",
        driverNature: "physical-device" as const,
        instanceCardinality: "multiple" as const,
      },
    ],
  };

  it("updates nature/cardinality and writes org-scoped audit metadata", async () => {
    const { db, audits, registrations } = createStatefulDb(orgDriverSeed);

    const result = await updateDriverRegistration(db, makeAuth(), {
      moduleId: "driver-1",
      driverNature: "logical-service",
      instanceCardinality: "singleton-per-project",
    });

    expect(result).toEqual({
      moduleId: "driver-1",
      driverNature: "logical-service",
      instanceCardinality: "singleton-per-project",
      attributionSubjectId: "asub-org-1",
    });
    expect(registrations.get("asub-org-1")).toMatchObject({
      driverNature: "logical-service",
      instanceCardinality: "singleton-per-project",
    });

    const audit = audits.find(
      (entry) => entry.kind === "parameter-module-driver-registration-updated",
    );
    expect(audit?.organizationId).toBe("org-1");
    expect(audit?.metadata).toMatchObject({
      moduleId: "driver-1",
      attributionSubjectId: "asub-org-1",
      actorRoles: ["admin"],
      before: {
        driverNature: "physical-device",
        instanceCardinality: "multiple",
      },
      after: {
        driverNature: "logical-service",
        instanceCardinality: "singleton-per-project",
      },
    });
  });

  it("rejects org admin updates to platform-tier subjects", async () => {
    const { db } = createStatefulDb({
      modules: [
        {
          ...orgDriverSeed.modules[0],
          attributionSubjectId: "asub-platform",
        },
      ],
      subjects: [{ id: "asub-platform", organizationId: null }],
      registrations: [
        {
          attributionSubjectId: "asub-platform",
          driverNature: "physical-device",
          instanceCardinality: "multiple",
        },
      ],
    });

    await expect(
      updateDriverRegistration(db, makeAuth(), {
        moduleId: "driver-1",
        driverNature: "logical-service",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("allows platform-admin to update org subjects and audits under the subject org id", async () => {
    const { db, audits } = createStatefulDb(orgDriverSeed);
    const platformAuth = makeAuth({
      roles: [{ projectId: null, roleId: "platform-admin" }],
    });

    await updateDriverRegistration(db, platformAuth, {
      moduleId: "driver-1",
      instanceCardinality: "singleton-per-project",
    });

    const audit = audits.find(
      (entry) => entry.kind === "parameter-module-driver-registration-updated",
    );
    expect(audit?.organizationId).toBe("org-1");
    expect(audit?.metadata).toMatchObject({
      actorRoles: ["platform-admin"],
      after: { instanceCardinality: "singleton-per-project" },
    });
  });

  it("re-syncs singleton-cardinality tasks for tip revisions when cardinality changes", async () => {
    const { db, syncCalls, query } = createStatefulDb({
      ...orgDriverSeed,
      tipRevisions: [
        {
          id: "rev-tip",
          projectId: "proj-1",
          configSetId: "cs-1",
          organizationId: "org-1",
          revisionNumber: 3,
          status: "resolved",
        },
        {
          id: "rev-old",
          projectId: "proj-1",
          configSetId: "cs-1",
          organizationId: "org-1",
          revisionNumber: 2,
          status: "resolved",
        },
      ],
    });

    await updateDriverRegistration(db, makeAuth(), {
      moduleId: "driver-1",
      instanceCardinality: "singleton-per-project",
    });

    expect(
      query.mock.calls.some(
        ([text]) =>
          typeof text === "string" &&
          text.includes("distinct on (project_id, config_set_id)") &&
          text.includes("from dts_config_revisions"),
      ),
    ).toBe(true);
    expect(syncCalls).toEqual([
      {
        organizationId: "org-1",
        projectId: "proj-1",
        configRevisionId: "rev-tip",
      },
    ]);
  });
});
