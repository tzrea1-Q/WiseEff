import {
  buildTreeFilterTree,
  flattenTreeFilterTree,
  type TreeFilterNode
} from "@/domain/tree-filter/treeFilter";

export type ParameterModuleFilterRegistryNode = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder?: number;
};

export type ParameterModuleFilterRow = {
  moduleId: string;
  moduleName: string;
  modulePath?: readonly string[];
};

export type PathModuleFilterRow = {
  moduleName: string;
  modulePath?: readonly string[];
};

type ModuleFilterNodeInfo = {
  moduleId: string;
  moduleName: string;
  modulePath?: readonly string[];
};

function normalizedId(id: string): string {
  return id.trim();
}

/**
 * Build the option scope for a module column filter.
 *
 * Only modules represented by the current result scope are emitted, while
 * registry ancestors are retained to preserve the real hierarchy. Counts are
 * occurrences in the current scope, not registry-wide totals.
 */
export function buildParameterModuleFilterNodes(
  rows: readonly ParameterModuleFilterRow[],
  modules: readonly ParameterModuleFilterRegistryNode[] = []
): TreeFilterNode[] {
  const registryById = new Map(modules.map((module) => [module.id, module]));
  const rowInfoById = new Map<string, ModuleFilterNodeInfo>();
  const idsInScope = new Set<string>();

  for (const row of rows) {
    const id = normalizedId(row.moduleId);
    if (!id) continue;
    idsInScope.add(id);
    if (!rowInfoById.has(id)) {
      rowInfoById.set(id, {
        moduleId: id,
        moduleName: row.moduleName.trim() || "未分类",
        modulePath: row.modulePath
      });
    }
  }

  const optionIds = new Set(idsInScope);
  for (const id of idsInScope) {
    const visited = new Set<string>();
    let current = registryById.get(id);
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = registryById.get(current.parentId);
      if (!parent) break;
      optionIds.add(parent.id);
      current = parent;
    }
  }

  const pathFor = (id: string): string[] => {
    const segments: string[] = [];
    const visited = new Set<string>();
    let current = registryById.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      segments.unshift(current.name);
      current = current.parentId ? registryById.get(current.parentId) : undefined;
    }
    const fallback = rowInfoById.get(id);
    return segments.length > 0 ? segments : fallback?.modulePath ? [...fallback.modulePath] : [fallback?.moduleName ?? id];
  };

  const rawNodes = Array.from(optionIds).map<TreeFilterNode>((id) => {
    const registryModule = registryById.get(id);
    const fallback = rowInfoById.get(id);
    const path = pathFor(id);
    return {
      id,
      label: registryModule?.name ?? fallback?.moduleName ?? id,
      parentId:
        registryModule?.parentId && optionIds.has(registryModule.parentId)
          ? registryModule.parentId
          : null,
      path,
      sortOrder: registryModule?.sortOrder ?? Number.MAX_SAFE_INTEGER
    };
  });

  const rawById = new Map(rawNodes.map((node) => [node.id, node]));
  const isInSubtree = (candidateId: string, ancestorId: string): boolean => {
    let current = rawById.get(candidateId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === ancestorId) return true;
      visited.add(current.id);
      current = current.parentId ? rawById.get(current.parentId) : undefined;
    }
    return false;
  };

  const tree = buildTreeFilterTree(
    rawNodes.map((node) => ({
      ...node,
      count: rows.filter((row) => isInSubtree(normalizedId(row.moduleId), node.id)).length
    }))
  );
  return flattenTreeFilterTree(tree).map(({ children: _children, ...node }) => node);
}

function pathNodeId(path: readonly string[]): string {
  return `path:${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** Build a tree when the caller has root-to-leaf paths but no separate registry. */
export function buildPathModuleFilterNodes(rows: readonly PathModuleFilterRow[]): TreeFilterNode[] {
  const registry: ParameterModuleFilterRegistryNode[] = [];
  const seenRegistryIds = new Set<string>();
  const normalizedRows: ParameterModuleFilterRow[] = [];

  for (const row of rows) {
    const path = (row.modulePath ?? [])
      .map((segment) => segment.trim())
      .filter(Boolean);
    const normalizedPath = path.length > 0 ? path : [row.moduleName.trim() || "未归类"];

    normalizedPath.forEach((segment, index) => {
      const currentPath = normalizedPath.slice(0, index + 1);
      const id = pathNodeId(currentPath);
      if (seenRegistryIds.has(id)) return;
      seenRegistryIds.add(id);
      registry.push({
        id,
        name: segment,
        parentId: index > 0 ? pathNodeId(currentPath.slice(0, -1)) : null,
        sortOrder: registry.length
      });
    });

    normalizedRows.push({
      moduleId: pathNodeId(normalizedPath),
      moduleName: normalizedPath.at(-1) ?? "未归类",
      modulePath: normalizedPath
    });
  }

  return buildParameterModuleFilterNodes(normalizedRows, registry);
}
