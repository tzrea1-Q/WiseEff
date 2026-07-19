import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
  TopologyView
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

export type DtsWorkbenchTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  name: string;
  unitAddress: string | null;
  compatible: string | null;
  /** Bindings attached directly to this topology node. */
  bindingIds: string[];
  /** Direct bindings plus bindings attached to descendants. */
  bindingCount: number;
  /** Non-valid bindings on this node plus non-valid bindings on descendants. */
  attentionCount: number;
  children: DtsWorkbenchTreeNode[];
};

export type BuildDtsTopologyTreeInput = {
  view: TopologyView;
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  rows: DtsParameterWorkbenchRow[];
};

type NodeSeed = {
  id: string;
  parentId: string | null;
  label: string;
  name: string;
  unitAddress: string | null;
  compatible: string | null;
};

function formatNodeLabel(name: string, unitAddress: string | undefined): string {
  if (name === "/" || !unitAddress || name.endsWith(`@${unitAddress}`)) {
    return name;
  }
  return `${name}@${unitAddress}`;
}

function assertUnique<T>(
  values: T[],
  identity: (value: T) => string,
  identityName: string
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = identity(value);
    if (result.has(id)) {
      throw new Error(`Duplicate ${identityName}: ${id}`);
    }
    result.set(id, value);
  }
  return result;
}

function sourceSeeds(nodes: SourceTopologyNode[]): NodeSeed[] {
  assertUnique(nodes, (node) => node.id, "source occurrence id");
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parentOccurrenceId,
    label: formatNodeLabel(node.name, node.unitAddress),
    name: node.name,
    unitAddress: node.unitAddress ?? null,
    compatible: null
  }));
}

function effectiveSeeds(nodes: EffectiveTopologyNode[]): NodeSeed[] {
  assertUnique(nodes, (node) => node.id, "effective node id");
  const byLogicalId = assertUnique(nodes, (node) => node.logicalNodeId, "effective logical id");
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parentLogicalNodeId
      ? byLogicalId.get(node.parentLogicalNodeId)?.id ?? null
      : null,
    label: formatNodeLabel(node.name, node.unitAddress),
    name: node.name,
    unitAddress: node.unitAddress ?? null,
    compatible: node.compatible ?? null
  }));
}

function assertAcyclic(seeds: NodeSeed[]): void {
  const byId = new Map(seeds.map((seed) => [seed.id, seed]));
  const completed = new Set<string>();

  for (const seed of seeds) {
    if (completed.has(seed.id)) continue;
    const chain: string[] = [];
    const localIndex = new Map<string, number>();
    let currentId: string | null = seed.id;

    while (currentId && byId.has(currentId) && !completed.has(currentId)) {
      const cycleStart = localIndex.get(currentId);
      if (cycleStart !== undefined) {
        const cycle = [...chain.slice(cycleStart), currentId].join(" -> ");
        throw new Error(`DTS topology parent cycle: ${cycle}`);
      }
      localIndex.set(currentId, chain.length);
      chain.push(currentId);
      currentId = byId.get(currentId)?.parentId ?? null;
    }

    for (const id of chain) completed.add(id);
  }
}

export function buildDtsTopologyTree({
  view,
  sourceNodes,
  effectiveNodes,
  rows
}: BuildDtsTopologyTreeInput): DtsWorkbenchTreeNode[] {
  const seeds = view === "source" ? sourceSeeds(sourceNodes) : effectiveSeeds(effectiveNodes);
  assertAcyclic(seeds);

  const nodesById = new Map<string, DtsWorkbenchTreeNode>();
  for (const seed of seeds) {
    nodesById.set(seed.id, {
      ...seed,
      bindingIds: [],
      bindingCount: 0,
      attentionCount: 0,
      children: []
    });
  }

  const roots: DtsWorkbenchTreeNode[] = [];
  for (const seed of seeds) {
    const node = nodesById.get(seed.id)!;
    const parent = seed.parentId ? nodesById.get(seed.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      node.parentId = null;
      roots.push(node);
    }
  }

  const seenBindings = new Set<string>();
  for (const row of rows) {
    if (row.view !== view || !row.topologyNodeId || seenBindings.has(row.bindingId)) continue;
    const directNode = nodesById.get(row.topologyNodeId);
    if (!directNode) continue;
    seenBindings.add(row.bindingId);
    directNode.bindingIds.push(row.bindingId);

    const visited = new Set<string>();
    let current: DtsWorkbenchTreeNode | undefined = directNode;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      current.bindingCount += 1;
      if (row.governanceState !== "valid") current.attentionCount += 1;
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
  }

  return roots;
}
