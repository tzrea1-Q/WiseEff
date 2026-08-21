import type { SpecAttributionModule } from "@/domain/parameter-topology/types";
import type { DtsWorkbenchTreeNode } from "./buildDtsTopologyTree";

export type ParameterSpecModuleTreeItem = {
  id: string;
  attributionModules: readonly SpecAttributionModule[];
};

type MutableTreeNode = DtsWorkbenchTreeNode & {
  children: MutableTreeNode[];
};

const UNCLASSIFIED_MODULE_PATH = ["未归类"] as const;

function normalizedModulePath(module: SpecAttributionModule): string[] {
  const path = (module.path ?? [])
    .map((segment) => segment.trim())
    .filter(Boolean);
  const name = module.name.trim();
  if (path.length === 0) return [name || "未命名模块"];
  if (name && path.at(-1) !== name) path.push(name);
  return path;
}

function moduleNodeId(path: readonly string[]): string {
  return `spec-module:${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function createNode(path: readonly string[], parentId: string | null): MutableTreeNode {
  const label = path.at(-1) ?? "未命名模块";
  return {
    id: moduleNodeId(path),
    parentId,
    label,
    name: label,
    unitAddress: null,
    compatible: null,
    bindingIds: [],
    bindingCount: 0,
    attentionCount: 0,
    children: []
  };
}

function compareModuleNodes(left: MutableTreeNode, right: MutableTreeNode): number {
  if (left.label === UNCLASSIFIED_MODULE_PATH[0]) return 1;
  if (right.label === UNCLASSIFIED_MODULE_PATH[0]) return -1;
  return left.label.localeCompare(right.label, "zh-Hans-CN");
}

function addSpecToPath(
  roots: MutableTreeNode[],
  byId: Map<string, MutableTreeNode>,
  path: readonly string[],
  specId: string
): void {
  let parent: MutableTreeNode | null = null;
  for (let index = 0; index < path.length; index += 1) {
    const currentPath = path.slice(0, index + 1);
    const id = moduleNodeId(currentPath);
    let node = byId.get(id);
    if (!node) {
      node = createNode(currentPath, parent?.id ?? null);
      byId.set(id, node);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    parent = node;
  }
  if (parent && !parent.bindingIds.includes(specId)) parent.bindingIds.push(specId);
}

function finalizeNode(node: MutableTreeNode): Set<string> {
  node.children.sort(compareModuleNodes);
  const specIds = new Set(node.bindingIds);
  for (const child of node.children) {
    for (const specId of finalizeNode(child)) specIds.add(specId);
  }
  node.bindingCount = specIds.size;
  return specIds;
}

/** Build the definition library's observed attribution tree without inventing taxonomy. */
export function buildParameterSpecModuleTree(
  specs: readonly ParameterSpecModuleTreeItem[]
): DtsWorkbenchTreeNode[] {
  const roots: MutableTreeNode[] = [];
  const byId = new Map<string, MutableTreeNode>();

  for (const spec of specs) {
    if (spec.attributionModules.length === 0) {
      addSpecToPath(roots, byId, UNCLASSIFIED_MODULE_PATH, spec.id);
      continue;
    }
    for (const module of spec.attributionModules) {
      addSpecToPath(roots, byId, normalizedModulePath(module), spec.id);
    }
  }

  roots.sort(compareModuleNodes);
  for (const root of roots) finalizeNode(root);
  return roots;
}

function findNode(
  nodes: readonly DtsWorkbenchTreeNode[],
  nodeId: string
): DtsWorkbenchTreeNode | null {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.id === nodeId) return node;
    pending.unshift(...node.children);
  }
  return null;
}

function collectSpecIds(node: DtsWorkbenchTreeNode): Set<string> {
  const specIds = new Set(node.bindingIds);
  for (const child of node.children) {
    for (const specId of collectSpecIds(child)) specIds.add(specId);
  }
  return specIds;
}

export function filterParameterSpecsByModuleNode<T extends ParameterSpecModuleTreeItem>(
  specs: readonly T[],
  tree: readonly DtsWorkbenchTreeNode[],
  selectedNodeId: string | null
): T[] {
  if (!selectedNodeId) return [...specs];
  const node = findNode(tree, selectedNodeId);
  if (!node) return [...specs];
  const selectedSpecIds = collectSpecIds(node);
  return specs.filter((spec) => selectedSpecIds.has(spec.id));
}
