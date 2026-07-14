import type { FlatModuleNode, ModuleTreeNode } from "@/domain/modules/moduleTree";

export function moduleMatchesQuery(node: FlatModuleNode, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [node.name, node.description ?? "", node.scope ?? ""].join(" ").toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function siblingNames(moduleNodes: readonly FlatModuleNode[], parentId: string | null, excludeId?: string) {
  return moduleNodes
    .filter((node) => (node.parentId ?? null) === parentId && node.id !== excludeId)
    .map((node) => node.name);
}

export function filterTreeNodes(tree: readonly ModuleTreeNode[], query: string): ModuleTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...tree];
  }

  const walk = (node: ModuleTreeNode): ModuleTreeNode | null => {
    const children = node.children.map(walk).filter((item): item is ModuleTreeNode => item !== null);
    if (moduleMatchesQuery(node, normalized) || children.length > 0) {
      return { ...node, children };
    }
    return null;
  };

  return tree.map(walk).filter((item): item is ModuleTreeNode => item !== null);
}

/** Expand roots and one level of children by default; deeper branches start collapsed. */
export function buildDefaultExpandedTreeIds(tree: readonly ModuleTreeNode[], maxExpandDepth = 1): Set<string> {
  const ids = new Set<string>();

  const walk = (nodes: readonly ModuleTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.children.length > 0 && depth <= maxExpandDepth) {
        ids.add(node.id);
      }
      walk(node.children, depth + 1);
    }
  };

  walk(tree, 0);
  return ids;
}

/** When filtering, keep ancestor branches open so matches stay visible. */
export function collectExpandedIdsForFilteredTree(tree: readonly ModuleTreeNode[]): Set<string> {
  const ids = new Set<string>();

  const walk = (nodes: readonly ModuleTreeNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        ids.add(node.id);
        walk(node.children);
      }
    }
  };

  walk(tree);
  return ids;
}

export function modulePathSegments(node: Pick<FlatModuleNode, "id" | "name" | "parentId">, moduleNodes: readonly FlatModuleNode[]): string[] {
  const byId = new Map(moduleNodes.map((item) => [item.id, item]));
  const segments: string[] = [];
  let current: Pick<FlatModuleNode, "id" | "name" | "parentId"> | undefined = node;

  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return segments;
}

export function modulePathLabel(node: ModuleTreeNode, moduleNodes: readonly FlatModuleNode[], depth: number) {
  if (depth === 0) {
    return null;
  }
  const segments = modulePathSegments(node, moduleNodes);
  return segments.length > 1 ? segments.join(" / ") : null;
}

export function buildExpandedTreeIdsForDropdown(
  tree: readonly ModuleTreeNode[],
  nodes: readonly FlatModuleNode[],
  selectedId?: string
): Set<string> {
  const expanded = buildDefaultExpandedTreeIds(tree);
  if (!selectedId) {
    return expanded;
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(selectedId);
  while (current?.parentId) {
    expanded.add(current.parentId);
    current = byId.get(current.parentId);
  }

  return expanded;
}
