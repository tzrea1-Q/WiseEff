import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import type { DtsWorkbenchTreeNode } from "./buildDtsTopologyTree";

export type BuildModuleTreeInput = {
  rows: DtsParameterWorkbenchRow[];
  /**
   * Admin module registry. When provided, nesting follows `parentId` so the
   * navigator shows business roots → driver groups → instance modules.
   * When omitted, keeps the legacy flat "one root per distinct moduleId" shape.
   */
  modules?: readonly ParameterModule[];
  /** When true, preserve module → device/driver → parameter hierarchy for tech experiments. */
  groupByDevice?: boolean;
};

function deviceKey(row: DtsParameterWorkbenchRow): string {
  const driver = row.driverModule ?? row.compatible ?? "未关联驱动";
  const instance = row.instanceName ?? row.topologyPath ?? "";
  return `${driver}\u0000${instance}`;
}

function deviceLabel(row: DtsParameterWorkbenchRow): string {
  const driver = row.driverModule ?? row.compatible ?? "未关联驱动";
  if (row.instanceName) {
    return row.instanceName === driver ? driver : `${row.instanceName} · ${driver}`;
  }
  return driver;
}

function moduleNodeId(moduleId: string): string {
  return `module:${moduleId}`;
}

function emptyNode(seed: {
  id: string;
  parentId: string | null;
  label: string;
  name: string;
  compatible: string | null;
}): DtsWorkbenchTreeNode {
  return {
    id: seed.id,
    parentId: seed.parentId,
    label: seed.label,
    name: seed.name,
    unitAddress: null,
    compatible: seed.compatible,
    bindingIds: [],
    bindingCount: 0,
    attentionCount: 0,
    children: []
  };
}

function sortModuleNodes(
  nodes: DtsWorkbenchTreeNode[],
  moduleSortOrders: Map<string, number>
): void {
  nodes.sort((left, right) => {
    const leftOrder = moduleSortOrders.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = moduleSortOrders.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label, "zh-Hans-CN");
  });
  for (const node of nodes) {
    sortModuleNodes(node.children, moduleSortOrders);
  }
}

function rollupAncestorCounts(node: DtsWorkbenchTreeNode): void {
  for (const child of node.children) {
    rollupAncestorCounts(child);
  }
  // Leaves that host bindings keep the counts set while attaching rows.
  // Ancestors (and groupByDevice module hosts with empty bindingIds) roll up from children.
  if (node.bindingIds.length === 0 && node.children.length > 0) {
    node.bindingCount = node.children.reduce((sum, child) => sum + child.bindingCount, 0);
    node.attentionCount = node.children.reduce((sum, child) => sum + child.attentionCount, 0);
  }
}

const UNCLASSIFIED_ROOT_LABEL = "未分类";

function isUnclassifiedRoot(node: DtsWorkbenchTreeNode): boolean {
  return node.label === UNCLASSIFIED_ROOT_LABEL;
}

/**
 * Hide a lone business wrapper root (e.g. Power) so its children become navigator roots.
 * Exact「未分类」roots are ignored for the singleton check and kept as peer roots after promote.
 */
function promoteSingletonRoot(roots: DtsWorkbenchTreeNode[]): DtsWorkbenchTreeNode[] {
  const primary = roots.filter((node) => !isUnclassifiedRoot(node));
  const unclassified = roots.filter(isUnclassifiedRoot);
  if (primary.length !== 1) return roots;
  const only = primary[0]!;
  if (only.children.length === 0) return roots;
  for (const child of only.children) {
    child.parentId = null;
  }
  return [...only.children, ...unclassified];
}

/**
 * Groups bindings into a business-first tree.
 * Default: module → parameter bindings (no required driver tier).
 * With `modules`, nest by registry parentId (business → group → instance).
 * Optional groupByDevice restores module → device/driver → parameter under the leaf.
 */
export function buildModuleTree({
  rows,
  modules,
  groupByDevice = false
}: BuildModuleTreeInput): DtsWorkbenchTreeNode[] {
  const registryById = new Map((modules ?? []).map((module) => [module.id, module]));
  const nestByRegistry = registryById.size > 0;

  const moduleNodes = new Map<string, DtsWorkbenchTreeNode>();
  const moduleSortOrders = new Map<string, number>();
  const deviceNodes = new Map<string, DtsWorkbenchTreeNode>();
  const leafModuleOrder: string[] = [];

  const ensureModuleNode = (input: {
    moduleId: string;
    moduleName: string;
    sortOrder: number;
    parentModuleId: string | null;
  }): DtsWorkbenchTreeNode => {
    const id = moduleNodeId(input.moduleId);
    let node = moduleNodes.get(id);
    if (node) return node;
    const parentTreeId =
      nestByRegistry && input.parentModuleId ? moduleNodeId(input.parentModuleId) : null;
    node = emptyNode({
      id,
      parentId: parentTreeId,
      label: input.moduleName,
      name: input.moduleName,
      compatible: null
    });
    moduleNodes.set(id, node);
    moduleSortOrders.set(id, input.sortOrder);
    return node;
  };

  const ensureAncestors = (leafModuleId: string, leafName: string, leafSortOrder: number) => {
    if (!nestByRegistry) {
      ensureModuleNode({
        moduleId: leafModuleId,
        moduleName: leafName,
        sortOrder: leafSortOrder,
        parentModuleId: null
      });
      return;
    }

    const chain: ParameterModule[] = [];
    const seen = new Set<string>();
    let current: ParameterModule | undefined = registryById.get(leafModuleId);
    if (!current) {
      ensureModuleNode({
        moduleId: leafModuleId,
        moduleName: leafName,
        sortOrder: leafSortOrder,
        parentModuleId: null
      });
      return;
    }
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      current = current.parentId ? registryById.get(current.parentId) : undefined;
    }
    chain.reverse();
    for (const module of chain) {
      ensureModuleNode({
        moduleId: module.id,
        moduleName: module.name,
        sortOrder: module.sortOrder,
        parentModuleId: module.parentId
      });
    }
  };

  const seenBindings = new Set<string>();
  for (const row of rows) {
    if (seenBindings.has(row.bindingId)) continue;
    seenBindings.add(row.bindingId);

    ensureAncestors(row.moduleId, row.moduleName, row.moduleSortOrder);
    const leafId = moduleNodeId(row.moduleId);
    const moduleNode = moduleNodes.get(leafId)!;
    if (!leafModuleOrder.includes(leafId)) leafModuleOrder.push(leafId);

    const bindingHost = groupByDevice
      ? (() => {
          const deviceNodeId = `${leafId}\u0000device:${deviceKey(row)}`;
          let deviceNode = deviceNodes.get(deviceNodeId);
          if (!deviceNode) {
            deviceNode = emptyNode({
              id: deviceNodeId,
              parentId: leafId,
              label: deviceLabel(row),
              name: row.instanceName ?? row.driverModule ?? row.compatible ?? "未关联驱动",
              compatible: row.compatible
            });
            deviceNodes.set(deviceNodeId, deviceNode);
            moduleNode.children.push(deviceNode);
          }
          return deviceNode;
        })()
      : moduleNode;

    bindingHost.bindingIds.push(row.bindingId);
    bindingHost.bindingCount += 1;
    if (groupByDevice) {
      moduleNode.bindingCount += 1;
    }
    if (row.governanceState !== "valid") {
      bindingHost.attentionCount += 1;
      if (groupByDevice) {
        moduleNode.attentionCount += 1;
      }
    }
  }

  if (!nestByRegistry) {
    const roots = leafModuleOrder.map((id) => moduleNodes.get(id)!);
    sortModuleNodes(roots, moduleSortOrders);
    return roots;
  }

  // Link children under parents (skip if already attached via groupByDevice devices).
  for (const node of moduleNodes.values()) {
    if (!node.parentId) continue;
    const parent = moduleNodes.get(node.parentId);
    if (!parent) {
      node.parentId = null;
      continue;
    }
    if (!parent.children.includes(node)) {
      parent.children.push(node);
    }
  }

  const roots = [...moduleNodes.values()].filter((node) => node.parentId === null);
  for (const root of roots) rollupAncestorCounts(root);
  const visibleRoots = promoteSingletonRoot(roots);
  sortModuleNodes(visibleRoots, moduleSortOrders);
  return visibleRoots;
}
