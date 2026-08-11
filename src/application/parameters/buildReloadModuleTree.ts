import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import type { DtsWorkbenchTreeNode } from "./buildDtsTopologyTree";
import { buildModuleTree } from "./buildModuleTree";

const UNCLASSIFIED_MODULE_LABEL = "未分类";

function candidateModuleLabel(candidate: Pick<DtsReloadCandidate, "module">): string {
  return candidate.module.trim() || UNCLASSIFIED_MODULE_LABEL;
}

function instanceLabelFromNodePath(nodePath: string | null): string | null {
  if (!nodePath?.trim()) return null;
  const segments = nodePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

/**
 * Map reload candidates onto the workbench row fields that `buildModuleTree` reads,
 * so `/dts-reload` can share the same navigator hierarchy as `/parameters`.
 */
export function candidateToModuleTreeRow(
  candidate: DtsReloadCandidate,
  modulesById?: Map<string, ParameterModule>
): DtsParameterWorkbenchRow {
  const moduleName = candidateModuleLabel(candidate);
  const moduleId = candidate.moduleId?.trim() || `name:${moduleName}`;
  const registryModule = modulesById?.get(moduleId);
  const instanceName = instanceLabelFromNodePath(candidate.nodePath);
  const compatible = candidate.compatible ?? null;

  return {
    bindingId: candidate.bindingId,
    parameterSpecId: "",
    parameterSpecVersionId: "",
    logicalNodeId: null,
    propertyKey: candidate.propertyKey,
    driverModule: compatible ?? instanceName,
    compatible,
    instanceName,
    moduleId,
    moduleName: registryModule?.name ?? moduleName,
    modulePath: [registryModule?.name ?? moduleName],
    importance: registryModule?.importance ?? "medium",
    moduleSortOrder: registryModule?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    moduleMapped: Boolean(registryModule),
    unitAddress: null,
    topologyPath: candidate.nodePath,
    topologyNodeId: null,
    sourceOccurrenceId: null,
    sourceFileName: null,
    sourceNodePath: null,
    sourceLine: null,
    rawValue: candidate.baselineValue ?? "",
    effectiveValue: { kind: "strings", values: [] },
    valueShapeSummary: "",
    schemaState: "valid",
    policyState: "pass",
    mappingOpen: false,
    governanceState: "valid",
    effects: [],
    searchText: "",
    view: "effective",
    nodeEnablement: null,
    nodeEnablementNotice: null
  };
}

export type BuildReloadModuleTreeInput = {
  candidates: readonly DtsReloadCandidate[];
  modules?: readonly ParameterModule[];
};

/**
 * Build the left-pane module navigator for DTS reload using the same
 * `buildModuleTree` + `groupByDevice` path as the parameter workbench.
 */
export function buildReloadModuleTree({
  candidates,
  modules
}: BuildReloadModuleTreeInput): DtsWorkbenchTreeNode[] {
  const modulesById = modules ? new Map(modules.map((module) => [module.id, module])) : undefined;
  return buildModuleTree({
    rows: candidates.map((candidate) => candidateToModuleTreeRow(candidate, modulesById)),
    modules,
    groupByDevice: true
  });
}

/** Collect binding ids under a navigator node (self + descendants). */
export function collectSubtreeBindingIds(node: DtsWorkbenchTreeNode): Set<string> {
  const bindingIds = new Set<string>();
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const bindingId of current.bindingIds) bindingIds.add(bindingId);
    pending.push(...current.children);
  }
  return bindingIds;
}
