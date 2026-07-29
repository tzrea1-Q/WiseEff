import type { ParameterModule, ParameterModuleMapping } from "@/domain/parameter-topology/moduleRegistry";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "@/domain/modules/moduleTree";
import type { DriverRegistryEntry } from "@/application/ports/ParameterModuleRegistryRepository";

export const MODULE_KIND_LABEL: Record<ParameterModule["kind"], string> = {
  business: "业务分类",
  "driver-group": "驱动组",
  instance: "器件实例",
  logical: "逻辑节点",
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

export function countInstanceChildren(
  modules: readonly ParameterModule[],
  parentId: string
): number {
  return modules.filter(
    (module) => module.parentId === parentId && module.kind === "instance"
  ).length;
}

export type AttributionFilters = {
  kinds: Array<ParameterModule["kind"]>;
  origins: Array<ParameterModule["origin"]>;
  hideNotYetObserved: boolean;
  /** When true, keep only driver-groups whose parse coverage is incomplete. */
  onlyUncoveredParse: boolean;
};

export const DEFAULT_ATTRIBUTION_FILTERS: AttributionFilters = {
  kinds: ["business", "driver-group", "instance", "logical", "unclassified"],
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

export type CreateModuleKind = "business" | "driver-group" | "instance" | "logical";

/** Curated empty nodes that have not been observed via ingest yet. */
export function isNotYetObservedModule(module: ParameterModule): boolean {
  return (
    module.origin === "curated" &&
    module.parameterCount === 0 &&
    (module.kind === "driver-group" || module.kind === "instance" || module.kind === "logical")
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
  if (parentKind === "business") return ["business", "driver-group", "logical"];
  if (parentKind === "driver-group") return ["instance"];
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
  if (kind === "driver-group" || kind === "logical") {
    return modules
      .filter((module) => module.kind === "business")
      .map((module) => ({ id: module.id, name: module.name }));
  }
  return modules
    .filter((module) => module.kind === "driver-group")
    .map((module) => ({ id: module.id, name: module.name }));
}

/** Tree nodes for create-dialog parent picker (`ModuleTreeSelect`). */
export function parentFlatNodesForCreateKind(
  modules: readonly ParameterModule[],
  kind: CreateModuleKind
): FlatModuleNode[] {
  if (kind === "instance") {
    return toAttributionFlatNodes(
      modules.filter((module) => module.kind === "business" || module.kind === "driver-group")
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
  if (kind === "driver-group" || kind === "logical") {
    return Boolean(parentId) && modules.some((module) => module.id === parentId && module.kind === "business");
  }
  return Boolean(parentId) && modules.some((module) => module.id === parentId && module.kind === "driver-group");
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

export function canRenameModule(module: ParameterModule): boolean {
  return !isUnclassifiedRoot(module);
}

/** Same gate as rename: edit name / description / scope via the module dialog. */
export function canEditModuleDetails(module: ParameterModule): boolean {
  return canRenameModule(module);
}

/** Unclassified root has no mutations; expose a view entry so Admins can inspect / open the queue. */
export function canViewUnclassifiedRoot(module: ParameterModule): boolean {
  return isUnclassifiedRoot(module);
}

export function canAddChildModule(module: ParameterModule): boolean {
  return module.kind === "business" || module.kind === "driver-group";
}

export function canMoveModule(module: ParameterModule): boolean {
  return module.kind === "business" || module.kind === "driver-group" || module.kind === "logical";
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

/**
 * Registry `parameterCount` is direct bindings on that module_id.
 * Attribution params hang on instance leaves, so parents are usually 0 unless rolled up.
 * Returns subtree totals (self + all descendants) for tree display.
 */
export function aggregateSubtreeParameterCounts(
  modules: readonly ParameterModule[]
): ReadonlyMap<string, number> {
  const direct = new Map(modules.map((module) => [module.id, module.parameterCount]));
  const childrenByParent = new Map<string, string[]>();
  for (const module of modules) {
    if (!module.parentId) continue;
    const siblings = childrenByParent.get(module.parentId) ?? [];
    siblings.push(module.id);
    childrenByParent.set(module.parentId, siblings);
  }

  const totals = new Map<string, number>();
  const visiting = new Set<string>();

  const totalFor = (moduleId: string): number => {
    const cached = totals.get(moduleId);
    if (cached !== undefined) return cached;
    if (visiting.has(moduleId)) return direct.get(moduleId) ?? 0;
    visiting.add(moduleId);
    let sum = direct.get(moduleId) ?? 0;
    for (const childId of childrenByParent.get(moduleId) ?? []) {
      sum += totalFor(childId);
    }
    visiting.delete(moduleId);
    totals.set(moduleId, sum);
    return sum;
  };

  for (const module of modules) {
    totalFor(module.id);
  }
  return totals;
}

export function canDeleteModule(module: ParameterModule): boolean {
  if (module.kind === "instance") return false;
  if (module.kind === "logical") return false;
  if (module.kind === "unclassified") return false;
  return module.kind === "business" || module.kind === "driver-group";
}

export function canEditImportance(module: ParameterModule): boolean {
  return module.kind === "business";
}

/** Manual kind correction among business / instance / logical (ADR-0006). */
export function canReclassifyModule(module: ParameterModule): boolean {
  if (isUnclassifiedRoot(module)) return false;
  return module.kind === "business" || module.kind === "instance" || module.kind === "logical";
}

export function deleteActionLabel(module: ParameterModule): string {
  return module.kind === "driver-group" ? "解散驱动组" : "删除模块";
}
