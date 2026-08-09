import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";

export type WorkbenchStructureTreeNode = {
  id: string;
  label: string;
  node: DtsStructuralNode;
  parentId: string | null;
  children: WorkbenchStructureTreeNode[];
};

function leafLabel(nodePath: string): string {
  if (!nodePath) return "/";
  const slash = nodePath.lastIndexOf("/");
  return slash >= 0 ? nodePath.slice(slash + 1) : nodePath;
}

function parentPathOf(nodePath: string): string | null {
  const slash = nodePath.lastIndexOf("/");
  if (slash <= 0) return null;
  return nodePath.slice(0, slash);
}

/** Build a true parent/child tree from flat DTS structure nodes keyed by nodePath. */
export function buildWorkbenchStructureTree(nodes: DtsStructuralNode[]): WorkbenchStructureTreeNode[] {
  const sorted = [...nodes].sort((left, right) => left.nodePath.localeCompare(right.nodePath));
  const byPath = new Map<string, WorkbenchStructureTreeNode>();

  for (const node of sorted) {
    byPath.set(node.nodePath, {
      id: node.nodePath,
      label: leafLabel(node.nodePath),
      node,
      parentId: parentPathOf(node.nodePath),
      children: []
    });
  }

  const roots: WorkbenchStructureTreeNode[] = [];
  for (const treeNode of byPath.values()) {
    let parentId = treeNode.parentId;
    while (parentId && !byPath.has(parentId)) {
      parentId = parentPathOf(parentId);
    }
    if (parentId && byPath.has(parentId)) {
      treeNode.parentId = parentId;
      byPath.get(parentId)!.children.push(treeNode);
      continue;
    }
    treeNode.parentId = null;
    roots.push(treeNode);
  }

  // Promote children of an empty/"/" synthetic root so the navigator starts at real nodes.
  const synthetic = byPath.get("") ?? byPath.get("/");
  if (synthetic) {
    for (const root of roots) {
      if (root.id === synthetic.id) continue;
      if (synthetic.children.includes(root)) continue;
      root.parentId = synthetic.id;
      synthetic.children.push(root);
    }
    for (const child of synthetic.children) child.parentId = null;
    return synthetic.children;
  }

  return roots;
}

export function workbenchStructureTreeIndex(roots: WorkbenchStructureTreeNode[]) {
  const byId = new Map<string, WorkbenchStructureTreeNode>();
  const walk = (branch: WorkbenchStructureTreeNode[]) => {
    for (const node of branch) {
      byId.set(node.id, node);
      walk(node.children);
    }
  };
  walk(roots);
  return { byId };
}

/** Expand ancestors so levels `1..maxVisibleDepth` are visible (root aria-level is 1). */
export function workbenchIdsToExpandUpToDepth(
  roots: WorkbenchStructureTreeNode[],
  maxVisibleDepth: number
): Set<string> {
  const expanded = new Set<string>();
  if (maxVisibleDepth <= 1) return expanded;
  const walk = (branch: WorkbenchStructureTreeNode[], level: number) => {
    for (const node of branch) {
      if (node.children.length === 0) continue;
      if (level < maxVisibleDepth) {
        expanded.add(node.id);
        walk(node.children, level + 1);
      }
    }
  };
  walk(roots, 1);
  return expanded;
}

export function workbenchExpansionPath(
  byId: Map<string, WorkbenchStructureTreeNode>,
  selectedNodePath: string | null
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  let current = selectedNodePath ? byId.get(selectedNodePath) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.children.length > 0) expanded.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return expanded;
}
