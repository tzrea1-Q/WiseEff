import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import { collectSubtreeModuleIds, legacyModuleIdFromName, type FlatModuleNode } from "@/domain/modules/moduleTree";
import { buildPowerManagementModuleTree, type PowerManagementParameterModule } from "@/powerManagementConfig";

/** Resolve the module id used for tree filters from a debug node row. */
export function debugNodeModuleId(entry: { module: string; moduleId?: string }) {
  return entry.moduleId ?? legacyModuleIdFromName(entry.module);
}

export function modulePathLabelForDebugNode(
  node: { module: string; modulePath?: string[] },
  moduleNodes: readonly FlatModuleNode[]
) {
  if (node.modulePath && node.modulePath.length > 0) {
    return node.modulePath.join(" / ");
  }
  const treeNode = moduleNodes.find((item) => item.name === node.module);
  if (!treeNode || !treeNode.parentId) {
    return node.module;
  }
  const byId = new Map(moduleNodes.map((item) => [item.id, item]));
  const segments: string[] = [];
  let current: FlatModuleNode | undefined = treeNode;
  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments.join(" / ");
}

export function buildDebugModuleTree(
  nodes: readonly DebugNodeRegistryEntry[],
  existingModules: readonly PowerManagementParameterModule[] = []
): FlatModuleNode[] {
  return buildPowerManagementModuleTree(
    existingModules,
    nodes.map((node) => node.module)
  );
}

export function countDebugNodesByModuleId(nodes: readonly DebugNodeRegistryEntry[], moduleId: string) {
  return nodes.filter((node) => debugNodeModuleId(node) === moduleId).length;
}

export function debugNodesInModuleId(nodes: readonly DebugNodeRegistryEntry[], moduleId: string) {
  return nodes
    .filter((node) => debugNodeModuleId(node) === moduleId)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function filterDebugNodesByModuleTree(
  nodes: readonly DebugNodeRegistryEntry[],
  moduleNodes: readonly FlatModuleNode[],
  selectedModuleIds: readonly string[]
) {
  if (selectedModuleIds.length === 0) {
    return nodes;
  }
  const allowed = collectSubtreeModuleIds(moduleNodes, selectedModuleIds);
  return nodes.filter((node) => allowed.has(debugNodeModuleId(node)));
}

/** @deprecated Use countDebugNodesByModuleId. */
export function countDebugNodesByModule(nodes: readonly DebugNodeRegistryEntry[], moduleName: string) {
  return nodes.filter((node) => node.module === moduleName).length;
}

/** @deprecated Use debugNodesInModuleId. */
export function debugNodesInModule(nodes: readonly DebugNodeRegistryEntry[], moduleName: string) {
  return nodes
    .filter((node) => node.module === moduleName)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

/** @deprecated Use buildDebugModuleTree for hierarchical module metadata. */
export function buildDebugModulesFromNodes(
  nodes: readonly DebugNodeRegistryEntry[],
  existingModules: readonly PowerManagementParameterModule[] = []
): PowerManagementParameterModule[] {
  return buildDebugModuleTree(nodes, existingModules).map((node) => ({
    name: node.name,
    description: node.description ?? "",
    scope: node.scope ?? ""
  }));
}

export function buildModuleSelectOptions(modules: readonly string[], currentModule = "") {
  const moduleSet = new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean));
  if (currentModule.trim()) {
    moduleSet.add(currentModule.trim());
  }
  return Array.from(moduleSet).sort((left, right) => left.localeCompare(right, "zh-CN"));
}
