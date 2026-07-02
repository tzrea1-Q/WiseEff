import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import { createEmptyParameterModule, type PowerManagementParameterModule } from "@/powerManagementConfig";

export function countDebugNodesByModule(nodes: readonly DebugNodeRegistryEntry[], moduleName: string) {
  return nodes.filter((node) => node.module === moduleName).length;
}

export function debugNodesInModule(nodes: readonly DebugNodeRegistryEntry[], moduleName: string) {
  return nodes.filter((node) => node.module === moduleName).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function buildDebugModulesFromNodes(
  nodes: readonly DebugNodeRegistryEntry[],
  existingModules: readonly PowerManagementParameterModule[] = []
): PowerManagementParameterModule[] {
  const byName = new Map<string, PowerManagementParameterModule>();
  existingModules.forEach((module) => {
    if (module.name.trim()) {
      byName.set(module.name, { ...module });
    }
  });

  nodes.forEach((node) => {
    const trimmed = node.module.trim();
    if (trimmed && !byName.has(trimmed)) {
      byName.set(trimmed, createEmptyParameterModule(trimmed));
    }
  });

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function buildModuleSelectOptions(modules: readonly string[], currentModule = "") {
  const moduleSet = new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean));
  if (currentModule.trim()) {
    moduleSet.add(currentModule.trim());
  }
  return Array.from(moduleSet).sort((left, right) => left.localeCompare(right, "zh-CN"));
}
