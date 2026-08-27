import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import { collectSubtreeModuleIds, legacyModuleIdFromName, type FlatModuleNode } from "@/domain/modules/moduleTree";
import { buildPowerManagementModuleTree, type PowerManagementParameterModule } from "@/powerManagementConfig";

type DebugModuleSource = {
  module: string;
  moduleId?: string;
  modulePath?: readonly string[];
};

/** Resolve the module id used for tree filters from a debug node row. */
export function debugNodeModuleId(entry: DebugModuleSource, moduleNodes: readonly FlatModuleNode[] = []) {
  const explicitId = entry.moduleId?.trim();
  if (explicitId) {
    return explicitId;
  }
  const moduleName = entry.module.trim();
  const matchingModules = moduleNodes.filter((module) => module.name.trim() === moduleName);
  return matchingModules.length === 1 ? matchingModules[0]!.id : legacyModuleIdFromName(entry.module);
}

export function modulePathLabelForDebugNode(
  node: { module: string; modulePath?: readonly string[] },
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

/** Build a runtime module tree from the API's explicit module ids and paths. */
export function buildRuntimeDebugModuleTree(nodes: readonly DebugModuleSource[]): FlatModuleNode[] {
  const moduleNodes = new Map<string, FlatModuleNode>();
  const normalizedNodes = nodes.flatMap((node) => {
    const leafName = node.module.trim();
    if (!leafName) {
      return [];
    }

    const pathSegments = (node.modulePath ?? []).map((segment) => segment.trim()).filter(Boolean);
    if (pathSegments.length === 0) {
      pathSegments.push(leafName);
    } else if (pathSegments[pathSegments.length - 1] !== leafName) {
      pathSegments.push(leafName);
    }

    return [{ leafName, pathSegments, leafId: debugNodeModuleId({ module: leafName, moduleId: node.moduleId }) }];
  });
  const explicitIdsByPath = new Map<string, string>();

  // A parent can be both a real module row and an ancestor synthesized from a
  // child row. Resolve all explicit ids first so both rows share one tree node.
  normalizedNodes.forEach(({ pathSegments, leafId }) => {
    explicitIdsByPath.set(JSON.stringify(pathSegments), leafId);
  });
  let sortOrder = 0;

  for (const { pathSegments, leafId } of normalizedNodes) {
    let parentId: string | null = null;
    const pathIds: string[] = [];
    pathSegments.forEach((name, index) => {
      const isLeaf = index === pathSegments.length - 1;
      const pathKey = JSON.stringify(pathSegments.slice(0, index + 1));
      const id = explicitIdsByPath.get(pathKey) ??
        (isLeaf ? leafId : `runtime:${pathSegments.slice(0, index + 1).join("/")}`);
      pathIds.push(id);

      if (!moduleNodes.has(id)) {
        moduleNodes.set(id, {
          id,
          name,
          parentId,
          path: pathIds.join("/"),
          depth: index + 1,
          sortOrder: sortOrder++
        });
      }
      parentId = id;
    });
  }

  return Array.from(moduleNodes.values());
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

function debugNodeMatchesModuleId(
  node: DebugModuleSource,
  moduleId: string,
  moduleNodes: readonly FlatModuleNode[]
) {
  const explicitId = node.moduleId?.trim();
  if (explicitId) {
    return explicitId === moduleId;
  }
  const target = moduleNodes.find((module) => module.id === moduleId);
  return target ? node.module.trim() === target.name.trim() : debugNodeModuleId(node) === moduleId;
}

export function countDebugNodesByModuleId(
  nodes: readonly DebugNodeRegistryEntry[],
  moduleId: string,
  moduleNodes: readonly FlatModuleNode[] = []
) {
  return nodes.filter((node) => debugNodeMatchesModuleId(node, moduleId, moduleNodes)).length;
}

export function debugNodesInModuleId(
  nodes: readonly DebugNodeRegistryEntry[],
  moduleId: string,
  moduleNodes: readonly FlatModuleNode[] = []
) {
  return nodes
    .filter((node) => debugNodeMatchesModuleId(node, moduleId, moduleNodes))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function filterDebugNodesByModuleTree<T extends DebugModuleSource>(
  nodes: readonly T[],
  moduleNodes: readonly FlatModuleNode[],
  selectedModuleIds: readonly string[]
): T[] {
  if (selectedModuleIds.length === 0) {
    return [...nodes];
  }
  const allowed = collectSubtreeModuleIds(moduleNodes, selectedModuleIds);
  return nodes.filter((node) => Array.from(allowed).some((moduleId) => debugNodeMatchesModuleId(node, moduleId, moduleNodes)));
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
