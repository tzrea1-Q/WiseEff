import type {
  DtsValue,
  EffectiveTopologyEffect,
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode,
  TopologyView
} from "@/domain/parameter-topology/types";
import type {
  DtsWorkbenchGovernanceState,
  DtsWorkbenchRow
} from "@/domain/parameter-topology/workbenchTypes";

export type BuildDtsWorkbenchRowsInput = {
  view: TopologyView;
  bindings: ProjectParameterBinding[];
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  mappingTasks: IdentityMappingTask[];
};

function nodeSegment(node: { name: string; unitAddress?: string }): string {
  return `${node.name}${node.unitAddress ? `@${node.unitAddress}` : ""}`;
}

function buildParentPath<T extends { name: string; unitAddress?: string }>(
  node: T | undefined,
  getParent: (node: T) => T | undefined
): string | null {
  if (!node) return null;

  const segments: string[] = [];
  const visited = new Set<T>();
  let current: T | undefined = node;
  while (current && !visited.has(current)) {
    visited.add(current);
    segments.unshift(nodeSegment(current));
    current = getParent(current);
  }
  return `/${segments.join("/")}`;
}

function summarizeDtsValue(value: DtsValue): string {
  switch (value.kind) {
    case "boolean":
      return "boolean";
    case "empty":
      return "empty";
    case "strings":
      return `${value.values.length === 1 ? "string" : "string-list"} · items=${value.values.length}`;
    case "bytes":
      return `byte-array · length=${value.values.length}`;
    case "mixed":
      return `mixed · segments=${value.segments.length}`;
    case "cells": {
      const kind = value.groups.some((group) => group.some((cell) => cell.kind === "phandle"))
        ? "phandle-list"
        : "cell-array";
      const groupSizes = [...new Set(value.groups.map((group) => group.length))];
      const cellsPerGroup = groupSizes.length === 1 ? String(groupSizes[0]) : groupSizes.join("/");
      return `${kind} · bits=${value.bits} · groups=${value.groups.length} · cellsPerGroup=${cellsPerGroup}`;
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

function propertyEffects(
  binding: ProjectParameterBinding,
  effectiveNode: EffectiveTopologyNode | undefined
): EffectiveTopologyEffect[] {
  return (effectiveNode?.effects ?? [])
    .filter((effect) => effect.propertyName === binding.propertyKey)
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
}

function latestSource(
  binding: ProjectParameterBinding,
  effects: EffectiveTopologyEffect[],
  sourceById: Map<string, SourceTopologyNode>
): { node: SourceTopologyNode | undefined; line: number | null } {
  const effect = effects.reduce<EffectiveTopologyEffect | undefined>(
    (latest, candidate) => (!latest || candidate.sourceOrder > latest.sourceOrder ? candidate : latest),
    undefined
  );
  const node = effect?.nodeOccurrenceId ? sourceById.get(effect.nodeOccurrenceId) : undefined;
  if (!node) return { node: undefined, line: null };

  const property = effect?.propertyOccurrenceId
    ? node.properties.find((candidate) => candidate.id === effect.propertyOccurrenceId)
    : undefined;
  const fallbackProperty = [...node.properties]
    .filter((candidate) => candidate.propertyName === binding.propertyKey)
    .sort((left, right) => right.sourceOrder - left.sourceOrder)[0];
  return { node, line: property?.startLine ?? fallbackProperty?.startLine ?? null };
}

function hasOpenMapping(binding: ProjectParameterBinding, tasks: IdentityMappingTask[]): boolean {
  const logicalNodeId = binding.logicalNodeId;
  if (!logicalNodeId) return false;
  return tasks.some(
    (task) =>
      task.status === "open" &&
      (task.previousLogicalNodeId === logicalNodeId || task.candidateLogicalNodeIds.includes(logicalNodeId))
  );
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
  view,
  bindings,
  sourceNodes,
  effectiveNodes,
  mappingTasks
}: BuildDtsWorkbenchRowsInput): DtsWorkbenchRow[] {
  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const effectiveByLogicalId = new Map(effectiveNodes.map((node) => [node.logicalNodeId, node]));

  return bindings.map((binding) => {
    const effectiveNode = binding.logicalNodeId
      ? effectiveByLogicalId.get(binding.logicalNodeId)
      : undefined;
    const effects = propertyEffects(binding, effectiveNode);
    const source = latestSource(binding, effects, sourceById);
    const sourcePath = buildParentPath(source.node, (node) =>
      node.parentOccurrenceId ? sourceById.get(node.parentOccurrenceId) : undefined
    );
    const effectivePath = buildParentPath(effectiveNode, (node) =>
      node.parentLogicalNodeId ? effectiveByLogicalId.get(node.parentLogicalNodeId) : undefined
    );
    const topologyPath =
      (view === "source" ? sourcePath : effectivePath) ?? effectivePath ?? sourcePath ?? binding.locator ?? "/";
    const topologyNodeId = view === "source" ? source.node?.id ?? null : effectiveNode?.id ?? null;
    const unitAddress =
      (view === "source" ? source.node?.unitAddress : effectiveNode?.unitAddress) ??
      effectiveNode?.unitAddress ??
      source.node?.unitAddress ??
      null;
    const valueShapeSummary = summarizeDtsValue(binding.effectiveValue);
    const mappingOpen = hasOpenMapping(binding, mappingTasks);
    const governanceState = resolveGovernanceState(binding, mappingOpen);

    return {
      bindingId: binding.id,
      parameterSpecId: binding.parameterSpecId,
      parameterSpecVersionId: binding.parameterSpecVersionId,
      logicalNodeId: binding.logicalNodeId,
      propertyKey: binding.propertyKey,
      driverModule: binding.driverModule,
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
