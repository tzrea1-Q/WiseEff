import type { ParameterModule, ParameterModuleMapping } from "@/domain/parameter-topology/moduleRegistry";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "@/domain/modules/moduleTree";
import type { DriverRegistryEntry } from "@/application/ports/ParameterModuleRegistryRepository";

export const MODULE_KIND_LABEL: Record<ParameterModule["kind"], string> = {
  business: "业务分类",
  "driver-group": "驱动组",
  "node-type": "节点类型",
  unclassified: "未分类"
};

export const MODULE_ORIGIN_LABEL: Record<ParameterModule["origin"], string> = {
  curated: "人工维护",
  auto: "自动发现"
};

export const IMPORTANCE_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export function toAttributionFlatNodes(modules: readonly ParameterModule[]): FlatModuleNode[] {
  const byId = new Map(modules.map((module) => [module.id, module]));

  const pathFor = (id: string): string => {
    const segments: string[] = [];
    let current = byId.get(id);
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      segments.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return `/${segments.join("/")}`;
  };

  return modules.map((module) => {
    const path = pathFor(module.id);
    return {
      id: module.id,
      name: module.name,
      parentId: module.parentId,
      path,
      depth: path.split("/").filter(Boolean).length,
      sortOrder: module.sortOrder
    };
  });
}

/** Business categories only — for move / classify targets. */
export function toBusinessFlatNodes(modules: readonly ParameterModule[]): FlatModuleNode[] {
  const business = modules.filter((module) => module.kind === "business");
  const byId = new Map(business.map((module) => [module.id, module]));

  const pathFor = (moduleId: string): string => {
    const segments: string[] = [];
    let current: ParameterModule | undefined = byId.get(moduleId);
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      segments.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return `/${segments.join("/")}`;
  };

  return business
    .map((module) => {
      const path = pathFor(module.id);
      return {
        id: module.id,
        name: module.name,
        parentId: module.parentId && byId.has(module.parentId) ? module.parentId : null,
        path,
        depth: path.split("/").filter(Boolean).length,
        sortOrder: module.sortOrder
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Expand root business categories only — nested business / driver groups stay collapsed. */
export function defaultExpandedModuleIds(modules: readonly ParameterModule[]): Set<string> {
  return new Set(
    modules
      .filter((module) => module.kind === "business" && module.parentId === null)
      .map((module) => module.id)
  );
}

export function mappingsForModule(
  mappings: readonly ParameterModuleMapping[],
  moduleId: string
): ParameterModuleMapping[] {
  return mappings.filter((mapping) => mapping.moduleId === moduleId);
}

export type AttributionFilters = {
  kinds: Array<ParameterModule["kind"]>;
  origins: Array<ParameterModule["origin"]>;
  hideNotYetObserved: boolean;
  /** When true, keep only driver-groups whose parse coverage is incomplete. */
  onlyUncoveredParse: boolean;
};

export const DEFAULT_ATTRIBUTION_FILTERS: AttributionFilters = {
  kinds: ["business", "driver-group", "node-type", "unclassified"],
  origins: ["curated", "auto"],
  hideNotYetObserved: false,
  onlyUncoveredParse: false
};

export type DriverCoverageSummary = {
  total: number;
  covered: number;
  overlayCovered: number;
  platformCovered: number;
  shadowedCount: number;
  promotedCount: number;
};

export function isPromotedParseCoverage(
  coverage: DriverRegistryEntry["parseCoverages"][number]["coverage"],
): boolean {
  return Boolean(coverage.covered && coverage.promoted);
}

export function isOverlayParseCoverage(coverage: DriverRegistryEntry["parseCoverages"][number]["coverage"]): boolean {
  return coverage.covered && coverage.scope === "organization" && !coverage.promoted;
}

export function isShadowedParseCoverage(
  coverage: DriverRegistryEntry["parseCoverages"][number]["coverage"]
): boolean {
  return Boolean(
    coverage.covered &&
      !coverage.promoted &&
      coverage.shadowedBy &&
      coverage.shadowedBy.length > 0,
  );
}

/** moduleId → parse coverage rollup, derived from listDriverRegistry(). */
export function summarizeDriverCoverage(
  entries: readonly DriverRegistryEntry[]
): ReadonlyMap<string, DriverCoverageSummary> {
  const map = new Map<string, DriverCoverageSummary>();
  for (const entry of entries) {
    const total = entry.parseCoverages.length;
    let covered = 0;
    let overlayCovered = 0;
    let platformCovered = 0;
    let shadowedCount = 0;
    let promotedCount = 0;
    for (const row of entry.parseCoverages) {
      if (!row.coverage.covered) continue;
      covered += 1;
      if (isPromotedParseCoverage(row.coverage)) {
        promotedCount += 1;
      } else if (isShadowedParseCoverage(row.coverage)) {
        shadowedCount += 1;
      }
      if (isOverlayParseCoverage(row.coverage)) {
        overlayCovered += 1;
      } else {
        platformCovered += 1;
      }
    }
    map.set(entry.moduleId, { total, covered, overlayCovered, platformCovered, shadowedCount, promotedCount });
  }
  return map;
}

export type CreateModuleKind = "business" | "driver-group" | "node-type";

/** Curated empty nodes that have not been observed via ingest yet. */
export function isNotYetObservedModule(module: ParameterModule): boolean {
  return (
    module.origin === "curated" &&
    module.parameterCount === 0 &&
    (module.kind === "driver-group" || module.kind === "node-type")
  );
}

/** @deprecated Prefer {@link isNotYetObservedModule}. */
export function isNotYetObservedDriverGroup(module: ParameterModule): boolean {
  return isNotYetObservedModule(module);
}

export function allowedCreateKindsForParent(
  parentKind: ParameterModule["kind"] | null | undefined
): CreateModuleKind[] {
  if (parentKind == null) return ["business"];
  if (parentKind === "business") return ["business", "driver-group", "node-type"];
  if (parentKind === "driver-group") return ["node-type"];
  if (parentKind === "node-type") return ["node-type"];
  return [];
}

export function parentCandidatesForCreateKind(
  modules: readonly ParameterModule[],
  kind: CreateModuleKind
): Array<{ id: string | null; name: string }> {
  if (kind === "business") {
    return [
      { id: null, name: "（根级）" },
      ...modules
        .filter((module) => module.kind === "business")
        .map((module) => ({ id: module.id, name: module.name }))
    ];
  }
  if (kind === "driver-group") {
    return modules
      .filter((module) => module.kind === "business")
      .map((module) => ({ id: module.id, name: module.name }));
  }
  if (kind === "node-type") {
    return modules
      .filter(
        (module) =>
          module.kind === "business" || module.kind === "driver-group" || module.kind === "node-type"
      )
      .map((module) => ({ id: module.id, name: module.name }));
  }
  return [];
}

/** Tree nodes for create-dialog parent picker (`ModuleTreeSelect`). */
export function parentFlatNodesForCreateKind(
  modules: readonly ParameterModule[],
  kind: CreateModuleKind
): FlatModuleNode[] {
  if (kind === "node-type") {
    return toAttributionFlatNodes(
      modules.filter(
        (module) =>
          module.kind === "business" || module.kind === "driver-group" || module.kind === "node-type"
      )
    );
  }
  return toBusinessFlatNodes(modules);
}

export function isValidCreateParent(
  modules: readonly ParameterModule[],
  kind: CreateModuleKind,
  parentId: string | null
): boolean {
  if (kind === "business") {
    if (parentId === null) return true;
    return modules.some((module) => module.id === parentId && module.kind === "business");
  }
  if (kind === "driver-group") {
    return Boolean(parentId) && modules.some((module) => module.id === parentId && module.kind === "business");
  }
  return (
    Boolean(parentId) &&
    modules.some(
      (module) =>
        module.id === parentId &&
        (module.kind === "business" || module.kind === "driver-group" || module.kind === "node-type")
    )
  );
}

/**
 * Keep a module if it matches filters, or if an ancestor/descendant does so the tree
 * stays connected for matching rows.
 */
export function filterModulesForAttribution(
  modules: readonly ParameterModule[],
  filters: AttributionFilters,
  coverage?: ReadonlyMap<string, DriverCoverageSummary>
): ParameterModule[] {
  const kindSet = new Set(filters.kinds);
  const originSet = new Set(filters.origins);
  const byId = new Map(modules.map((module) => [module.id, module]));

  const matches = (module: ParameterModule) => {
    if (!kindSet.has(module.kind) || !originSet.has(module.origin)) return false;
    if (filters.hideNotYetObserved && isNotYetObservedModule(module)) return false;
    if (filters.onlyUncoveredParse) {
      if (module.kind !== "driver-group") return false;
      const summary = coverage?.get(module.id);
      if (!summary || summary.total === 0 || summary.covered >= summary.total) return false;
    }
    return true;
  };

  const matchedIds = new Set(modules.filter(matches).map((module) => module.id));

  const keep = new Set<string>();
  for (const id of matchedIds) {
    let current = byId.get(id);
    while (current) {
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return modules.filter((module) => keep.has(module.id));
}

export function buildAttributionTree(
  modules: readonly ParameterModule[],
  filters: AttributionFilters,
  coverage?: ReadonlyMap<string, DriverCoverageSummary>
): ModuleTreeNode[] {
  const visible = filterModulesForAttribution(modules, filters, coverage);
  return buildModuleTree(toAttributionFlatNodes(visible));
}

/** Org-scoped fallback bucket — read-only on the server; no rename/move/delete. */
export function isUnclassifiedRoot(module: ParameterModule): boolean {
  return module.kind === "unclassified" && module.parentId === null;
}

export type ModuleActionDecision = { allowed: true } | { allowed: false; reason: string };

export function renameModuleDecision(module: ParameterModule): ModuleActionDecision {
  if (isUnclassifiedRoot(module)) {
    return { allowed: false, reason: "未分类根为只读，不可重命名。" };
  }
  return { allowed: true };
}

export function editModuleDetailsDecision(module: ParameterModule): ModuleActionDecision {
  return renameModuleDecision(module);
}

export function addChildModuleDecision(module: ParameterModule): ModuleActionDecision {
  if (module.kind === "business" || module.kind === "driver-group") {
    return { allowed: true };
  }
  if (module.kind === "node-type") {
    return { allowed: false, reason: "节点类型下不可再添加子模块。" };
  }
  return { allowed: false, reason: "该模块类型不可添加子模块。" };
}

export function moveModuleDecision(module: ParameterModule): ModuleActionDecision {
  if (module.kind === "business" || module.kind === "driver-group" || module.kind === "node-type") {
    return { allowed: true };
  }
  return { allowed: false, reason: "未分类根不可移动。" };
}

export function deleteModuleDecision(module: ParameterModule): ModuleActionDecision {
  if (module.kind === "node-type") {
    return { allowed: false, reason: "节点类型不可删除，请改挂到其它父级或联系运维。" };
  }
  if (module.kind === "unclassified") {
    return { allowed: false, reason: "未分类根不可删除。" };
  }
  if (module.kind === "business" || module.kind === "driver-group") {
    return { allowed: true };
  }
  return { allowed: false, reason: "该模块不可删除。" };
}

export function canRenameModule(module: ParameterModule): boolean {
  return renameModuleDecision(module).allowed;
}

/** Same gate as rename: edit name / description / scope via the module dialog. */
export function canEditModuleDetails(module: ParameterModule): boolean {
  return editModuleDetailsDecision(module).allowed;
}

/** Unclassified root has no mutations; expose a view entry so Admins can inspect / open the queue. */
export function canViewUnclassifiedRoot(module: ParameterModule): boolean {
  return isUnclassifiedRoot(module);
}

export function canAddChildModule(module: ParameterModule): boolean {
  return addChildModuleDecision(module).allowed;
}

export function canMoveModule(module: ParameterModule): boolean {
  return moveModuleDecision(module).allowed;
}

export function siblingModules(
  modules: readonly ParameterModule[],
  module: ParameterModule
): ParameterModule[] {
  return modules
    .filter((candidate) => candidate.parentId === module.parentId)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN")
    );
}

export function sortOrderSwapUpdates(
  module: ParameterModule,
  direction: "up" | "down",
  modules: readonly ParameterModule[]
): Array<{ id: string; sortOrder: number }> | null {
  const siblings = siblingModules(modules, module);
  const index = siblings.findIndex((candidate) => candidate.id === module.id);
  if (index < 0) return null;
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return null;
  const peer = siblings[swapIndex]!;
  return [
    { id: module.id, sortOrder: peer.sortOrder },
    { id: peer.id, sortOrder: module.sortOrder }
  ];
}

export function siblingModuleNames(
  modules: readonly ParameterModule[],
  parentId: string | null,
  excludeId?: string
): string[] {
  return modules
    .filter((module) => module.parentId === parentId && module.id !== excludeId)
    .map((module) => module.name);
}

export type SubtreeAttributionCounts = {
  parameterCount: number;
  definitionCount: number;
};

/**
 * Mock/local rollup of *direct* registry counts. API `GET /api/v2/parameter-modules`
 * already returns subtree totals — the tree must display those fields, not re-sum.
 * Definition rollup here is a sum of stored direct `definitionCount`s (mock seeds
 * do not share specs across siblings). Server `rollupSubtreeAttributionCounts`
 * unions distinct spec ids.
 */
export function aggregateSubtreeAttributionCounts(
  modules: readonly ParameterModule[]
): ReadonlyMap<string, SubtreeAttributionCounts> {
  const direct = new Map(
    modules.map((module) => [
      module.id,
      {
        parameterCount: module.parameterCount,
        definitionCount: module.definitionCount
      }
    ])
  );
  const childrenByParent = new Map<string, string[]>();
  for (const module of modules) {
    if (!module.parentId) continue;
    const siblings = childrenByParent.get(module.parentId) ?? [];
    siblings.push(module.id);
    childrenByParent.set(module.parentId, siblings);
  }

  const totals = new Map<string, SubtreeAttributionCounts>();
  const visiting = new Set<string>();

  const totalFor = (moduleId: string): SubtreeAttributionCounts => {
    const cached = totals.get(moduleId);
    if (cached !== undefined) return cached;
    const own = direct.get(moduleId) ?? { parameterCount: 0, definitionCount: 0 };
    if (visiting.has(moduleId)) return own;
    visiting.add(moduleId);
    let parameterCount = own.parameterCount;
    let definitionCount = own.definitionCount;
    for (const childId of childrenByParent.get(moduleId) ?? []) {
      const child = totalFor(childId);
      parameterCount += child.parameterCount;
      definitionCount += child.definitionCount;
    }
    visiting.delete(moduleId);
    const next = { parameterCount, definitionCount };
    totals.set(moduleId, next);
    return next;
  };

  for (const module of modules) {
    totalFor(module.id);
  }
  return totals;
}

/** @deprecated Prefer {@link aggregateSubtreeAttributionCounts}. */
export function aggregateSubtreeParameterCounts(
  modules: readonly ParameterModule[]
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const [id, counts] of aggregateSubtreeAttributionCounts(modules)) {
    totals.set(id, counts.parameterCount);
  }
  return totals;
}

export function canDeleteModule(module: ParameterModule): boolean {
  return deleteModuleDecision(module).allowed;
}

export function canEditImportance(module: ParameterModule): boolean {
  return module.kind === "business";
}

/** Manual kind correction among business / node-type (ADR-0010). */
export function canReclassifyModule(module: ParameterModule): boolean {
  if (isUnclassifiedRoot(module)) return false;
  return module.kind === "business" || module.kind === "node-type";
}

export function deleteActionLabel(module: ParameterModule): string {
  return module.kind === "driver-group" ? "解散驱动组" : "删除模块";
}
