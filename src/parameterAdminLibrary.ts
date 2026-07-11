import type { ParameterRecord } from "@/domain/parameters/types";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "@/domain/modules/moduleTree";
import {
  buildPowerManagementModuleTree,
  resolveLibraryParameterId,
  type PowerManagementParameterModule,
  type PowerManagementParameterTemplate,
  type PowerManagementProject
} from "./powerManagementConfig";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";

export function buildParameterLibraryFromRecords(
  parameters: readonly ParameterRecord[],
  _projects: readonly Pick<PowerManagementProject, "id">[] = []
): PowerManagementParameterTemplate[] {
  const byLibraryId = new Map<string, PowerManagementParameterTemplate>();

  for (const record of parameters) {
    const libraryId = resolveLibraryParameterId(record.projectId, record.id);
    const projectValue = {
      currentValue: record.currentValue,
      recommendedValue: record.recommendedValue,
      updatedAt: record.updatedAt
    };
    const existing = byLibraryId.get(libraryId);

    if (existing) {
      existing.values[record.projectId] = projectValue;
      continue;
    }

    byLibraryId.set(libraryId, {
      id: libraryId,
      name: record.name,
      description: record.description,
      explanation: record.explanation,
      configFormat: record.configFormat,
      module: record.module,
      moduleId: record.moduleId,
      modulePath: record.modulePath,
      range: record.range,
      unit: record.unit,
      risk: record.risk,
      valueKind: record.valueKind,
      values: {
        [record.projectId]: projectValue
      }
    });
  }

  return Array.from(byLibraryId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/** Resolve the module id used for tree filters from a library template row. */
export function templateModuleId(
  template: { module: string; moduleId?: string },
  moduleNodes?: readonly FlatModuleNode[]
) {
  if (template.moduleId) {
    return template.moduleId;
  }

  const trimmed = template.module.trim();
  if (moduleNodes) {
    const match = moduleNodes.find((node) => node.name === trimmed);
    if (match) {
      return match.id;
    }
  }

  return legacyModuleIdFromName(trimmed);
}

export function modulePathLabelForTemplate(template: { module: string; modulePath?: string[] }, moduleNodes: readonly FlatModuleNode[]) {
  if (template.modulePath && template.modulePath.length > 0) {
    return template.modulePath.join(" / ");
  }
  const node = moduleNodes.find((item) => item.name === template.module);
  if (!node || !node.parentId) {
    return template.module;
  }
  const byId = new Map(moduleNodes.map((item) => [item.id, item]));
  const segments: string[] = [];
  let current: FlatModuleNode | undefined = node;
  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments.join(" / ");
}

export function groupParametersByModuleTree(
  parameters: readonly PowerManagementParameterTemplate[],
  moduleNodes: readonly FlatModuleNode[]
): Array<{ node: ModuleTreeNode; parameters: PowerManagementParameterTemplate[] }> {
  const tree = buildModuleTree(moduleNodes);
  const groups: Array<{ node: ModuleTreeNode; parameters: PowerManagementParameterTemplate[] }> = [];

  const walk = (nodes: readonly ModuleTreeNode[]) => {
    for (const node of nodes) {
      const items = parameters.filter((parameter) => templateModuleId(parameter, moduleNodes) === node.id);
      if (items.length > 0 || node.children.length > 0) {
        groups.push({ node, parameters: items });
      }
      walk(node.children);
    }
  };

  walk(tree);
  return groups;
}

export function buildParameterModuleTree(
  parameters: readonly ParameterRecord[],
  existingModules: readonly PowerManagementParameterModule[] = []
): FlatModuleNode[] {
  return buildPowerManagementModuleTree(
    existingModules,
    parameters.map((parameter) => parameter.module)
  );
}

/** @deprecated Use buildParameterModuleTree for hierarchical module metadata. */
export function buildParameterModulesFromRecords(
  parameters: readonly ParameterRecord[],
  existingModules: readonly PowerManagementParameterModule[] = []
): PowerManagementParameterModule[] {
  return buildParameterModuleTree(parameters, existingModules).map((node) => ({
    name: node.name,
    description: node.description ?? "",
    scope: node.scope ?? ""
  }));
}
