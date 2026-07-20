import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import type { DtsWorkbenchTreeNode } from "./buildDtsTopologyTree";

export type BuildModuleTreeInput = {
  rows: DtsParameterWorkbenchRow[];
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

/**
 * Groups bindings into a business-first tree: module -> device/driver -> parameter bindings.
 * Same-named properties stay distinct because they hang under different device/driver nodes.
 * Reuses the DtsWorkbenchTreeNode shape so the existing navigator can render it unchanged.
 */
export function buildModuleTree({ rows }: BuildModuleTreeInput): DtsWorkbenchTreeNode[] {
  const moduleNodes = new Map<string, DtsWorkbenchTreeNode>();
  const moduleSortOrders = new Map<string, number>();
  const deviceNodes = new Map<string, DtsWorkbenchTreeNode>();
  const moduleOrder: string[] = [];

  const seenBindings = new Set<string>();
  for (const row of rows) {
    if (seenBindings.has(row.bindingId)) continue;
    seenBindings.add(row.bindingId);

    const moduleNodeId = `module:${row.moduleId}`;
    let moduleNode = moduleNodes.get(moduleNodeId);
    if (!moduleNode) {
      moduleNode = emptyNode({
        id: moduleNodeId,
        parentId: null,
        label: row.moduleName,
        name: row.moduleName,
        compatible: null
      });
      moduleNodes.set(moduleNodeId, moduleNode);
      moduleSortOrders.set(moduleNodeId, row.moduleSortOrder);
      moduleOrder.push(moduleNodeId);
    }

    const deviceNodeId = `${moduleNodeId}\u0000device:${deviceKey(row)}`;
    let deviceNode = deviceNodes.get(deviceNodeId);
    if (!deviceNode) {
      deviceNode = emptyNode({
        id: deviceNodeId,
        parentId: moduleNodeId,
        label: deviceLabel(row),
        name: row.instanceName ?? row.driverModule ?? row.compatible ?? "未关联驱动",
        compatible: row.compatible
      });
      deviceNodes.set(deviceNodeId, deviceNode);
      moduleNode.children.push(deviceNode);
    }

    deviceNode.bindingIds.push(row.bindingId);
    deviceNode.bindingCount += 1;
    moduleNode.bindingCount += 1;
    if (row.governanceState !== "valid") {
      deviceNode.attentionCount += 1;
      moduleNode.attentionCount += 1;
    }
  }

  const roots = moduleOrder.map((id) => moduleNodes.get(id)!);
  roots.sort((left, right) => {
    const leftOrder = moduleSortOrders.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = moduleSortOrders.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label, "zh-Hans-CN");
  });
  for (const moduleNode of roots) {
    moduleNode.children.sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
  }
  return roots;
}
