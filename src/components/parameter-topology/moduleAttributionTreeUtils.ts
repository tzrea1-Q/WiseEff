import type { ParameterModule, ParameterModuleMapping } from "@/domain/parameter-topology/moduleRegistry";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "@/domain/modules/moduleTree";

export const MODULE_KIND_LABEL: Record<ParameterModule["kind"], string> = {
  business: "业务分类",
  "driver-group": "驱动组",
  instance: "器件实例",
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

export function defaultExpandedModuleIds(modules: readonly ParameterModule[]): Set<string> {
  return new Set(
    modules
      .filter((module) => module.kind === "business" || module.kind === "driver-group")
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
};

export const DEFAULT_ATTRIBUTION_FILTERS: AttributionFilters = {
  kinds: ["business", "driver-group", "instance", "unclassified"],
  origins: ["curated", "auto"]
};

/**
 * Keep a module if it matches filters, or if an ancestor/descendant does so the tree
 * stays connected for matching rows.
 */
export function filterModulesForAttribution(
  modules: readonly ParameterModule[],
  filters: AttributionFilters
): ParameterModule[] {
  const kindSet = new Set(filters.kinds);
  const originSet = new Set(filters.origins);
  const byId = new Map(modules.map((module) => [module.id, module]));

  const matches = (module: ParameterModule) =>
    kindSet.has(module.kind) && originSet.has(module.origin);

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
  filters: AttributionFilters
): ModuleTreeNode[] {
  const visible = filterModulesForAttribution(modules, filters);
  return buildModuleTree(toAttributionFlatNodes(visible));
}

export function canRenameModule(module: ParameterModule): boolean {
  return !(module.kind === "unclassified" && module.parentId === null);
}

export function canMoveModule(module: ParameterModule): boolean {
  return module.kind === "business" || module.kind === "driver-group";
}

export function canDeleteModule(module: ParameterModule): boolean {
  if (module.kind === "instance") return false;
  if (module.kind === "unclassified") return false;
  return module.kind === "business" || module.kind === "driver-group";
}

export function canEditImportance(module: ParameterModule): boolean {
  return module.kind === "business";
}

export function deleteActionLabel(module: ParameterModule): string {
  return module.kind === "driver-group" ? "解散驱动组" : "删除模块";
}
