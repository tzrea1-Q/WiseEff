export type FlatModuleNode = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder?: number;
  description?: string;
  scope?: string;
};

export type ModuleTreeNode = FlatModuleNode & {
  children: ModuleTreeNode[];
};

export function buildModuleTree(flat: readonly FlatModuleNode[]): ModuleTreeNode[] {
  const byId = new Map<string, ModuleTreeNode>();
  for (const node of flat) {
    byId.set(node.id, { ...node, children: [] });
  }

  const roots: ModuleTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: ModuleTreeNode[]) => {
    nodes.sort((left, right) => {
      const order = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      return order !== 0 ? order : left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

export function flattenModuleTree(tree: readonly ModuleTreeNode[]): ModuleTreeNode[] {
  const items: ModuleTreeNode[] = [];
  const walk = (nodes: readonly ModuleTreeNode[]) => {
    for (const node of nodes) {
      items.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return items;
}

export function collectSubtreeModuleIds(flat: readonly FlatModuleNode[], selectedIds: readonly string[]): Set<string> {
  const byId = new Map(flat.map((node) => [node.id, node]));
  const selected = new Set<string>();

  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) {
      selected.add(id);
      continue;
    }
    const prefix = `${node.path}/`;
    for (const candidate of flat) {
      if (candidate.id === node.id || candidate.path.startsWith(prefix)) {
        selected.add(candidate.id);
      }
    }
  }

  return selected;
}

export function formatModulePathLabel(modulePath?: readonly string[], module?: string) {
  if (modulePath && modulePath.length > 0) {
    return modulePath.join(" / ");
  }
  return module ?? "";
}

export function legacyModuleIdFromName(name: string) {
  return `legacy:${name.trim()}`;
}

export function parameterModuleId(parameter: { moduleId?: string; module: string }) {
  return parameter.moduleId ?? legacyModuleIdFromName(parameter.module);
}
