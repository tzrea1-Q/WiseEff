export type ModulePathNode = {
  id: string;
  path: string;
};

export function buildPath(parentPath: string | null | undefined, id: string): string {
  if (!parentPath) {
    return id;
  }
  return `${parentPath}/${id}`;
}

export function depthOf(path: string): number {
  return path.split("/").length;
}

export function isDescendant(candidatePath: string, ancestorPath: string): boolean {
  if (candidatePath === ancestorPath) {
    return false;
  }
  return candidatePath.startsWith(`${ancestorPath}/`);
}

export function subtreePrefix(path: string): { exactPath: string; descendantPrefix: string } {
  return {
    exactPath: path,
    descendantPrefix: `${path}/`
  };
}

export function assertNoCycle(
  nodeId: string,
  targetParentId: string | null,
  byId: Map<string, ModulePathNode>
): void {
  if (!targetParentId) {
    return;
  }
  if (targetParentId === nodeId) {
    throw new Error("Cannot move module: cycle detected (target is self)");
  }
  const node = byId.get(nodeId);
  const targetParent = byId.get(targetParentId);
  if (!node || !targetParent) {
    return;
  }
  if (isDescendant(targetParent.path, node.path)) {
    throw new Error("Cannot move module: cycle detected (target is a descendant)");
  }
}
