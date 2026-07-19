import type {
  DtsValue,
  EffectiveTopologyEffect,
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyProperty,
  SourceTopologyNode,
  TopologyView
} from "@/domain/parameter-topology/types";
import type {
  DtsWorkbenchGovernanceState,
  DtsParameterWorkbenchRow
} from "@/domain/parameter-topology/workbenchTypes";

export type BuildDtsWorkbenchRowsInput = {
  projectId: string;
  configRevisionId: string;
  view: TopologyView;
  bindings: ProjectParameterBinding[];
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  mappingTasks: IdentityMappingTask[];
};

function nodeSegment(node: { name: string; unitAddress?: string }): string {
  return `${node.name}${node.unitAddress ? `@${node.unitAddress}` : ""}`;
}

function buildParentPath<T extends { id: string; name: string; unitAddress?: string }>(
  node: T | undefined,
  getParentId: (node: T) => string | null,
  nodesById: Map<string, T>
): string | null {
  if (!node) return null;

  const segments: string[] = [];
  const visited = new Set<string>();
  let current: T | undefined = node;
  while (current) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    if (current.name !== "/") segments.unshift(nodeSegment(current));

    const parentId = getParentId(current);
    if (parentId === null) return segments.length > 0 ? `/${segments.join("/")}` : "/";
    current = nodesById.get(parentId);
    if (!current) return null;
  }
  return null;
}

function summarizeDtsValue(value: DtsValue): string {
  switch (value.kind) {
    case "boolean":
      return "boolean";
    case "empty":
      return "empty property";
    case "strings":
      return `${value.values.length === 1 ? "string" : "string-list"} · ${value.values.length} ${
        value.values.length === 1 ? "item" : "items"
      }`;
    case "bytes":
      return `byte-array · ${value.values.length} bytes`;
    case "mixed":
      return `mixed · ${value.segments.length} ${value.segments.length === 1 ? "segment" : "segments"}`;
    case "cells": {
      const kind = value.groups.some((group) => group.some((cell) => cell.kind === "phandle"))
        ? "phandle-list"
        : "cell-array";
      const groupSizes = [...new Set(value.groups.map((group) => group.length))];
      if (value.groups.length === 1) {
        const cellCount = value.groups[0]?.length ?? 0;
        return `${kind} · ${value.bits} bit · ${cellCount} ${cellCount === 1 ? "cell" : "cells"}`;
      }
      const cellsPerGroup = groupSizes.length === 0 ? "0" : groupSizes.join("/");
      return `${kind} · ${value.bits} bit · ${value.groups.length} groups · ${cellsPerGroup} cells per group`;
    }
  }
}

function resolveGovernanceState(
  binding: ProjectParameterBinding,
  mappingOpen: boolean
): DtsWorkbenchGovernanceState {
  if (binding.schemaState === "invalid" || binding.policyState === "fail") return "blocked";
  if (mappingOpen || binding.schemaState === "unreviewed") return "attention";
  return "valid";
}

type SourcePropertyIndex = {
  byId: Map<string, SourceTopologyProperty>;
  latestByName: Map<string, SourceTopologyProperty>;
};

function indexSourceProperties(nodes: SourceTopologyNode[]): Map<string, SourcePropertyIndex> {
  return new Map(
    nodes.map((node) => {
      const byId = new Map<string, SourceTopologyProperty>();
      const latestByName = new Map<string, SourceTopologyProperty>();
      for (const property of node.properties) {
        byId.set(property.id, property);
        const latest = latestByName.get(property.propertyName);
        if (!latest || property.sourceOrder > latest.sourceOrder) {
          latestByName.set(property.propertyName, property);
        }
      }
      return [node.id, { byId, latestByName }];
    })
  );
}

function indexPropertyEffects(
  nodes: EffectiveTopologyNode[]
): Map<string, Map<string, EffectiveTopologyEffect[]>> {
  const result = new Map<string, Map<string, EffectiveTopologyEffect[]>>();
  for (const node of nodes) {
    const byProperty = new Map<string, EffectiveTopologyEffect[]>();
    for (const effect of node.effects) {
      if (!effect.propertyName) continue;
      const propertyEffects = byProperty.get(effect.propertyName) ?? [];
      propertyEffects.push(effect);
      byProperty.set(effect.propertyName, propertyEffects);
    }
    for (const propertyEffects of byProperty.values()) {
      propertyEffects.sort((left, right) => left.sourceOrder - right.sourceOrder);
    }
    result.set(node.logicalNodeId, byProperty);
  }
  return result;
}

function latestSource(
  binding: ProjectParameterBinding,
  effects: EffectiveTopologyEffect[],
  sourceById: Map<string, SourceTopologyNode>,
  sourcePropertiesByNodeId: Map<string, SourcePropertyIndex>
): { node: SourceTopologyNode | undefined; line: number | null } {
  const effect = effects.at(-1);
  const node = effect?.nodeOccurrenceId ? sourceById.get(effect.nodeOccurrenceId) : undefined;
  if (!node) return { node: undefined, line: null };

  const propertyIndex = sourcePropertiesByNodeId.get(node.id);
  const property = effect?.propertyOccurrenceId ? propertyIndex?.byId.get(effect.propertyOccurrenceId) : undefined;
  const fallbackProperty = propertyIndex?.latestByName.get(binding.propertyKey);
  return { node, line: property?.startLine ?? fallbackProperty?.startLine ?? null };
}

function indexOpenMappingLogicalIds(
  projectId: string,
  configRevisionId: string,
  tasks: IdentityMappingTask[]
): Set<string> {
  const result = new Set<string>();
  for (const task of tasks) {
    if (
      task.status !== "open" ||
      task.projectId !== projectId ||
      task.configRevisionId !== configRevisionId
    ) {
      continue;
    }
    if (task.previousLogicalNodeId) result.add(task.previousLogicalNodeId);
    for (const candidateLogicalNodeId of task.candidateLogicalNodeIds) {
      result.add(candidateLogicalNodeId);
    }
  }
  return result;
}

function buildSearchText(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined && part !== "")
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Converts authoritative semantic bindings into display rows without deriving identity from paths.
 */
export function buildDtsWorkbenchRows({
  projectId,
  configRevisionId,
  view,
  bindings,
  sourceNodes,
  effectiveNodes,
  mappingTasks
}: BuildDtsWorkbenchRowsInput): DtsParameterWorkbenchRow[] {
  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const effectiveByLogicalId = new Map(effectiveNodes.map((node) => [node.logicalNodeId, node]));
  const sourcePropertiesByNodeId = indexSourceProperties(sourceNodes);
  const propertyEffectsByLogicalId = indexPropertyEffects(effectiveNodes);
  const openMappingLogicalIds = indexOpenMappingLogicalIds(projectId, configRevisionId, mappingTasks);

  return bindings.map((binding) => {
    const effectiveNode = binding.logicalNodeId
      ? effectiveByLogicalId.get(binding.logicalNodeId)
      : undefined;
    const effects = binding.logicalNodeId
      ? propertyEffectsByLogicalId.get(binding.logicalNodeId)?.get(binding.propertyKey) ?? []
      : [];
    const source = latestSource(binding, effects, sourceById, sourcePropertiesByNodeId);
    const sourcePath = buildParentPath(source.node, (node) => node.parentOccurrenceId, sourceById);
    const effectivePath = buildParentPath(
      effectiveNode,
      (node) => node.parentLogicalNodeId,
      effectiveByLogicalId
    );
    const topologyPath = view === "source" ? sourcePath : effectivePath;
    const topologyNodeId = view === "source" ? source.node?.id ?? null : effectiveNode?.id ?? null;
    const unitAddress =
      (view === "source" ? source.node?.unitAddress : effectiveNode?.unitAddress) ??
      effectiveNode?.unitAddress ??
      source.node?.unitAddress ??
      null;
    const valueShapeSummary = summarizeDtsValue(binding.effectiveValue);
    const mappingOpen = binding.logicalNodeId ? openMappingLogicalIds.has(binding.logicalNodeId) : false;
    const governanceState = resolveGovernanceState(binding, mappingOpen);

    return {
      bindingId: binding.id,
      parameterSpecId: binding.parameterSpecId,
      parameterSpecVersionId: binding.parameterSpecVersionId,
      logicalNodeId: binding.logicalNodeId,
      propertyKey: binding.propertyKey,
      driverModule: binding.driverModule,
      compatible: effectiveNode?.compatible ?? null,
      instanceName: binding.instanceName,
      unitAddress,
      topologyPath,
      topologyNodeId,
      sourceOccurrenceId: source.node?.id ?? null,
      sourceFileName: source.node?.fileName ?? null,
      sourceNodePath: sourcePath,
      sourceLine: source.line,
      rawValue: binding.rawValue,
      effectiveValue: binding.effectiveValue,
      valueShapeSummary,
      schemaState: binding.schemaState,
      policyState: binding.policyState,
      mappingOpen,
      governanceState,
      effects,
      searchText: buildSearchText([
        binding.propertyKey,
        binding.driverModule,
        effectiveNode?.compatible,
        binding.instanceName,
        unitAddress,
        topologyPath,
        sourcePath,
        source.node?.fileName,
        source.line,
        binding.rawValue,
        valueShapeSummary,
        binding.schemaState,
        binding.policyState,
        governanceState
      ]),
      view
    };
  });
}
