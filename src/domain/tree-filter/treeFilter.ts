export type TreeFilterNode = {
  id: string;
  label: string;
  parentId: string | null;
  /** A searchable/displayable path. It may be a preformatted string or path segments. */
  path?: string | readonly string[];
  sortOrder?: number;
  count?: number;
  disabled?: boolean;
};

export type TreeFilterTreeNode = TreeFilterNode & {
  children: TreeFilterTreeNode[];
};

export type TreeFilterSelectionState = "checked" | "mixed" | "unchecked";

function pathLabel(path: TreeFilterNode["path"]): string {
  return typeof path === "string" ? path : path ? [...path].join(" / ") : "";
}

function compareNodes(left: TreeFilterTreeNode, right: TreeFilterTreeNode): number {
  const order = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  return order !== 0 ? order : left.label.localeCompare(right.label, "zh-Hans-CN");
}

function hasParentCycle(node: TreeFilterNode, byId: ReadonlyMap<string, TreeFilterNode>): boolean {
  const visited = new Set<string>();
  let current: TreeFilterNode | undefined = node;
  while (current?.parentId) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = byId.get(current.parentId);
    if (!current) return false;
  }
  return false;
}

/** Build a deterministic tree while promoting orphaned/cyclic nodes to roots. */
export function buildTreeFilterTree(nodes: readonly TreeFilterNode[]): TreeFilterTreeNode[] {
  const byId = new Map<string, TreeFilterNode>();
  for (const node of nodes) {
    const id = node.id.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, { ...node, id, parentId: node.parentId?.trim() || null });
  }

  const treeById = new Map<string, TreeFilterTreeNode>();
  for (const node of byId.values()) {
    treeById.set(node.id, { ...node, children: [] });
  }

  const roots: TreeFilterTreeNode[] = [];
  for (const node of treeById.values()) {
    const parentId = node.parentId;
    const parent = parentId ? treeById.get(parentId) : undefined;
    if (!parent || parentId === node.id || hasParentCycle(node, byId)) {
      node.parentId = null;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  const sortTree = (items: TreeFilterTreeNode[]) => {
    items.sort(compareNodes);
    items.forEach((item) => sortTree(item.children));
  };
  sortTree(roots);
  return roots;
}

export function flattenTreeFilterTree(tree: readonly TreeFilterTreeNode[]): TreeFilterTreeNode[] {
  const result: TreeFilterTreeNode[] = [];
  const visit = (items: readonly TreeFilterTreeNode[]) => {
    for (const item of items) {
      result.push(item);
      visit(item.children);
    }
  };
  visit(tree);
  return result;
}

export function treeFilterNodePath(node: TreeFilterNode): string {
  return pathLabel(node.path) || node.label;
}

export function filterTreeFilterTree(
  tree: readonly TreeFilterTreeNode[],
  query: string
): TreeFilterTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return tree.map((node) => ({ ...node, children: [...node.children] }));

  const visit = (node: TreeFilterTreeNode): TreeFilterTreeNode | null => {
    const children = node.children.map(visit).filter((item): item is TreeFilterTreeNode => item !== null);
    const matches = `${node.label} ${treeFilterNodePath(node)}`.toLocaleLowerCase().includes(normalized);
    return matches || children.length > 0 ? { ...node, children } : null;
  };

  return tree.map(visit).filter((node): node is TreeFilterTreeNode => node !== null);
}

export function collectTreeFilterExpandedIds(
  tree: readonly TreeFilterTreeNode[],
  maxDepth = 1
): Set<string> {
  const result = new Set<string>();
  const visit = (items: readonly TreeFilterTreeNode[], depth: number) => {
    for (const item of items) {
      if (item.children.length > 0 && depth <= maxDepth) result.add(item.id);
      visit(item.children, depth + 1);
    }
  };
  visit(tree, 0);
  return result;
}

export function collectTreeFilterExpandedIdsForSearch(
  tree: readonly TreeFilterTreeNode[]
): Set<string> {
  const result = new Set<string>();
  const visit = (items: readonly TreeFilterTreeNode[]) => {
    for (const item of items) {
      if (item.children.length > 0) result.add(item.id);
      visit(item.children);
    }
  };
  visit(tree);
  return result;
}

export function collectTreeFilterAncestors(
  nodes: readonly TreeFilterNode[],
  id: string
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors = new Set<string>();
  let current = byId.get(id);
  const guard = new Set<string>();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    ancestors.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return ancestors;
}

function isDescendantOf(
  nodesById: ReadonlyMap<string, TreeFilterNode>,
  candidateId: string,
  ancestorId: string
): boolean {
  let current = nodesById.get(candidateId);
  const guard = new Set<string>();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = nodesById.get(current.parentId);
  }
  return false;
}

function isCoveredBy(
  nodesById: ReadonlyMap<string, TreeFilterNode>,
  id: string,
  selectedRoots: ReadonlySet<string>
): boolean {
  if (selectedRoots.has(id)) return true;
  for (const rootId of selectedRoots) {
    if (isDescendantOf(nodesById, id, rootId)) return true;
  }
  return false;
}

/** Remove redundant descendants so the controlled value stays a set of logical roots. */
export function canonicalizeTreeFilterSelection(
  nodes: readonly TreeFilterNode[],
  selectedIds: readonly string[]
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  for (const id of selectedIds) {
    if (!id || result.includes(id)) continue;
    if (!byId.has(id)) {
      result.push(id);
      continue;
    }
    if (result.some((rootId) => rootId !== id && isDescendantOf(byId, id, rootId))) continue;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const rootId = result[index];
      if (rootId && isDescendantOf(byId, rootId, id)) result.splice(index, 1);
    }
    result.push(id);
  }
  return result;
}

function subtreeNodes(
  nodes: readonly TreeFilterNode[],
  id: string
): TreeFilterNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => node.id === id || isDescendantOf(byId, node.id, id));
}

/** Toggle a node and return canonical logical roots using OR/subtree semantics. */
export function toggleTreeFilterSelection(
  nodes: readonly TreeFilterNode[],
  selectedIds: readonly string[],
  id: string,
  selectableIds?: ReadonlySet<string>
): string[] {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node || node.disabled || (selectableIds && !selectableIds.has(id))) {
    return canonicalizeTreeFilterSelection(nodes, selectedIds);
  }

  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const current = canonicalizeTreeFilterSelection(nodes, selectedIds);
  const currentSet = new Set(current);

  if (currentSet.has(id)) {
    return current.filter((rootId) => rootId !== id);
  }

  const coveringRoots = current.filter((rootId) => isDescendantOf(byId, id, rootId));
  if (coveringRoots.length > 0) {
    // A checked child under a selected parent is an exclusion gesture. Expand the
    // covering branch into its selectable siblings so the result remains positive
    // root selections without introducing a second "excluded ids" state.
    const next = current.filter((rootId) => !coveringRoots.includes(rootId));
    for (const rootId of coveringRoots) {
      for (const candidate of subtreeNodes(nodes, rootId)) {
        if (
          candidate.id === rootId ||
          candidate.id === id ||
          isDescendantOf(byId, candidate.id, id)
        ) continue;
        if (!candidate.disabled && (!selectableIds || selectableIds.has(candidate.id))) {
          next.push(candidate.id);
        }
      }
    }
    return canonicalizeTreeFilterSelection(nodes, next);
  }

  const next = current.filter((rootId) => !isDescendantOf(byId, rootId, id));
  next.push(id);
  return canonicalizeTreeFilterSelection(nodes, next);
}

export function getTreeFilterSelectionState(
  nodes: readonly TreeFilterNode[],
  node: TreeFilterTreeNode,
  selectedIds: readonly string[],
  selectableIds?: ReadonlySet<string>
): TreeFilterSelectionState {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const selectedRoots = new Set(selectedIds);
  const candidates = subtreeNodes(nodes, node.id).filter(
    (candidate) => !candidate.disabled && (!selectableIds || selectableIds.has(candidate.id))
  );
  if (candidates.length === 0) return "unchecked";
  const selectedCount = candidates.filter((candidate) => isCoveredBy(byId, candidate.id, selectedRoots)).length;
  if (selectedCount === 0) return "unchecked";
  if (selectedCount === candidates.length) return "checked";
  return "mixed";
}

export function collectTreeFilterSelectedDescendantIds(
  nodes: readonly TreeFilterNode[],
  selectedIds: readonly string[]
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedRoots = new Set(canonicalizeTreeFilterSelection(nodes, selectedIds));
  return new Set(nodes.filter((node) => isCoveredBy(byId, node.id, selectedRoots)).map((node) => node.id));
}
