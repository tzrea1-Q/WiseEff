import type { ParameterRecord } from "@/domain/parameters/types";
import {
  createEmptyParameterModule,
  resolveLibraryParameterId,
  type PowerManagementParameterModule,
  type PowerManagementParameterTemplate,
  type PowerManagementProject
} from "./powerManagementConfig";

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

export function buildParameterModulesFromRecords(
  parameters: readonly ParameterRecord[],
  existingModules: readonly PowerManagementParameterModule[] = []
): PowerManagementParameterModule[] {
  const byName = new Map<string, PowerManagementParameterModule>();
  existingModules.forEach((module) => {
    if (module.name.trim()) {
      byName.set(module.name, { ...module });
    }
  });

  parameters.forEach((parameter) => {
    const trimmed = parameter.module.trim();
    if (trimmed && !byName.has(trimmed)) {
      byName.set(trimmed, createEmptyParameterModule(trimmed));
    }
  });

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}
