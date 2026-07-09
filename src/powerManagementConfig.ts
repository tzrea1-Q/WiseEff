import powerManagementConfigJson from "./config/power-management.json";
import {
  legacyModuleIdFromName,
  type FlatModuleNode
} from "@/domain/modules/moduleTree";

export type PowerManagementRisk = "High" | "Medium" | "Low";

export type ParameterValueKind = "scalar" | "complex";

export type NodeAccessMode = "RO" | "WO" | "RW";

export type SeedPowerManagementProjectId = "aurora" | "nebula" | "atlas";
export type PowerManagementProjectId = SeedPowerManagementProjectId | (string & {});

export type PowerManagementParameterValue = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

export type PowerManagementParameterTemplate = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: PowerManagementRisk;
  valueKind: ParameterValueKind;
  values: Partial<Record<PowerManagementProjectId, PowerManagementParameterValue>>;
};

export type ProjectParameterRecord = Omit<PowerManagementParameterTemplate, "values"> &
  PowerManagementParameterValue & {
    id: string;
    projectId: PowerManagementProjectId;
    values: PowerManagementParameterTemplate["values"];
    moduleId?: string;
    modulePath?: string[];
  };

export type PowerManagementDebugParameter = {
  id: string;
  name: string;
  key: string;
  description: string;
  detailedDescription?: string;
  module: string;
  moduleId?: string;
  modulePath?: string[];
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: PowerManagementRisk;
  status: "已同步" | "待下发" | "下发成功";
  nodePath: string;
  accessMode: NodeAccessMode;
  valueKind?: "scalar" | "complex";
  valueFormat?: "raw" | "json" | "dts" | "line-list" | "kv-list";
  normalizationMode?: "exact" | "trim" | "line-ending-normalized" | "json-canonical";
  maxValueBytes?: number | null;
  parameterDefinitionId?: string;
  reloadManaged?: boolean;
  writeFormatExample?: string;
  writeFormatHint?: string;
};

export type PowerManagementProject = {
  id: PowerManagementProjectId;
  name: string;
  code: string;
};

export type PowerManagementParameterModule = {
  name: string;
  description: string;
  scope: string;
  /** Parent module name; omitted or empty means root-level (back-compat). */
  parent?: string;
  /** Optional explicit breadcrumb path in seed JSON (informational; tree uses `parent`). */
  path?: string[];
};

export type ParameterModuleDraft = PowerManagementParameterModule;

export type ParameterModulePatch = Partial<Omit<PowerManagementParameterModule, "name">> & {
  name?: string;
};

export type PowerManagementConfig = {
  projects: PowerManagementProject[];
  parameterModules: PowerManagementParameterModule[];
  parameterLibrary: PowerManagementParameterTemplate[];
  debugParameters: PowerManagementDebugParameter[];
};

type RawPowerManagementConfig = Omit<PowerManagementConfig, "parameterModules"> & {
  parameterModules?: unknown;
};

export const bundledPowerManagementConfig: PowerManagementConfig = normalizePowerManagementConfig(
  powerManagementConfigJson as RawPowerManagementConfig
);

export function createEmptyParameterModule(name: string): PowerManagementParameterModule {
  return {
    name,
    description: "",
    scope: ""
  };
}

function normalizeParameterModuleRecord(
  record: Partial<PowerManagementParameterModule> & { name: string }
): PowerManagementParameterModule {
  const normalized: PowerManagementParameterModule = {
    name: record.name.trim(),
    description: record.description?.trim() ?? "",
    scope: record.scope?.trim() ?? ""
  };
  const parent = record.parent?.trim();
  if (parent) {
    normalized.parent = parent;
  }
  if (record.path && record.path.length > 0) {
    normalized.path = record.path.map((segment) => segment.trim()).filter(Boolean);
  }
  return normalized;
}

function normalizeParameterModulesInput(raw: unknown): PowerManagementParameterModule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const modules: PowerManagementParameterModule[] = [];
  raw.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) {
        modules.push(createEmptyParameterModule(name));
      }
      return;
    }
    if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
      const normalized = normalizeParameterModuleRecord(item as PowerManagementParameterModule);
      if (normalized.name) {
        modules.push(normalized);
      }
    }
  });
  return modules;
}

function normalizePowerManagementConfig(config: RawPowerManagementConfig): PowerManagementConfig {
  const parameterLibrary = config.parameterLibrary.map((parameter) => ({
    ...parameter,
    valueKind: parameter.valueKind ?? "scalar"
  }));
  const parameterModules = collectParameterModules({
    ...config,
    parameterLibrary,
    parameterModules: normalizeParameterModulesInput(config.parameterModules)
  });

  return {
    ...config,
    parameterLibrary,
    parameterModules
  };
}

function collectParameterModules(config: PowerManagementConfig): PowerManagementParameterModule[] {
  const byName = new Map<string, PowerManagementParameterModule>();
  config.parameterModules.forEach((module) => {
    if (module.name.trim()) {
      byName.set(module.name, { ...module });
    }
  });
  config.parameterLibrary.forEach((parameter) => {
    const trimmed = parameter.module.trim();
    if (trimmed && !byName.has(trimmed)) {
      byName.set(trimmed, createEmptyParameterModule(trimmed));
    }
  });
  config.debugParameters.forEach((parameter) => {
    const trimmed = parameter.module.trim();
    if (trimmed && !byName.has(trimmed)) {
      byName.set(trimmed, createEmptyParameterModule(trimmed));
    }
  });
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/** Build hierarchical flat module nodes from config modules plus derived leaf names. */
export function buildPowerManagementModuleTree(
  modules: readonly PowerManagementParameterModule[],
  extraModuleNames: readonly string[] = []
): FlatModuleNode[] {
  const byName = new Map<string, PowerManagementParameterModule>();
  modules.forEach((module) => {
    if (module.name.trim()) {
      byName.set(module.name, { ...module });
    }
  });
  extraModuleNames.forEach((moduleName) => {
    const trimmed = moduleName.trim();
    if (trimmed && !byName.has(trimmed)) {
      byName.set(trimmed, createEmptyParameterModule(trimmed));
    }
  });

  const records = Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
  const idForName = (name: string) => legacyModuleIdFromName(name);

  const nodes: FlatModuleNode[] = records.map((record, index) => {
    const id = idForName(record.name);
    const parentName = record.parent?.trim();
    const parentId = parentName && byName.has(parentName) ? idForName(parentName) : null;
    return {
      id,
      name: record.name,
      parentId,
      path: id,
      depth: 1,
      sortOrder: index,
      description: record.description,
      scope: record.scope
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));

  const computePath = (node: FlatModuleNode, visiting = new Set<string>()): string => {
    if (visiting.has(node.id)) {
      return node.id;
    }
    if (!node.parentId) {
      return node.id;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      return node.id;
    }
    visiting.add(node.id);
    return `${computePath(parent, visiting)}/${node.id}`;
  };

  const computeDepth = (node: FlatModuleNode, visiting = new Set<string>()): number => {
    if (visiting.has(node.id)) {
      return 1;
    }
    if (!node.parentId) {
      return 1;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      return 1;
    }
    visiting.add(node.id);
    return computeDepth(parent, visiting) + 1;
  };

  return nodes.map((node) => ({
    ...node,
    path: computePath(node),
    depth: computeDepth(node)
  }));
}

export function modulePathLabelsForModuleName(moduleName: string, moduleNodes: readonly FlatModuleNode[]) {
  const byName = new Map(moduleNodes.map((node) => [node.name, node]));
  const byId = new Map(moduleNodes.map((node) => [node.id, node]));
  const node = byName.get(moduleName.trim());
  if (!node) {
    return [moduleName.trim()].filter(Boolean);
  }
  const segments: string[] = [];
  let current: FlatModuleNode | undefined = node;
  const visiting = new Set<string>();
  while (current) {
    if (visiting.has(current.id)) {
      break;
    }
    visiting.add(current.id);
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments;
}

function enrichWithModuleMetadata<T extends { module: string }>(record: T, moduleNodes: readonly FlatModuleNode[]) {
  const byName = new Map(moduleNodes.map((node) => [node.name, node]));
  const trimmed = record.module.trim();
  const node = byName.get(trimmed);
  return {
    ...record,
    moduleId: node?.id ?? legacyModuleIdFromName(trimmed),
    modulePath: modulePathLabelsForModuleName(trimmed, moduleNodes)
  };
}

export function countChildParameterModules(config: PowerManagementConfig, moduleName: string) {
  return config.parameterModules.filter((module) => module.parent?.trim() === moduleName).length;
}

export function listParameterModuleNames(modules: readonly PowerManagementParameterModule[]) {
  return modules.map((module) => module.name);
}

export function clonePowerManagementConfig(config: PowerManagementConfig): PowerManagementConfig {
  return JSON.parse(JSON.stringify(config)) as PowerManagementConfig;
}

export function flattenProjectParameters(config: PowerManagementConfig): ProjectParameterRecord[] {
  const moduleNodes = buildPowerManagementModuleTree(
    config.parameterModules,
    config.parameterLibrary.map((parameter) => parameter.module)
  );

  return config.projects.flatMap((project) =>
    config.parameterLibrary.flatMap((parameter) => {
      const value = parameter.values[project.id];
      if (!value) {
        return [];
      }

      return [
        enrichWithModuleMetadata(
          {
            ...parameter,
            id: `${project.id}-${parameter.id}`,
            projectId: project.id,
            currentValue: value.currentValue,
            recommendedValue: value.recommendedValue,
            updatedAt: value.updatedAt
          },
          moduleNodes
        )
      ];
    })
  );
}

export function flattenDebugParameters(config: PowerManagementConfig) {
  const moduleNodes = buildPowerManagementModuleTree(
    config.parameterModules,
    config.debugParameters.map((parameter) => parameter.module)
  );

  return config.debugParameters.map((parameter) => enrichWithModuleMetadata({ ...parameter }, moduleNodes));
}

/** Keep configDraft.debugParameters aligned with flattenDebugParameters module metadata for snapshots. */
export function syncConfigDraftDebugParameterModuleMetadata(config: PowerManagementConfig): PowerManagementConfig {
  const enrichedById = new Map(flattenDebugParameters(config).map((parameter) => [parameter.id, parameter]));

  return {
    ...config,
    debugParameters: config.debugParameters.map((parameter) => {
      const enriched = enrichedById.get(parameter.id);
      if (!enriched) {
        return parameter;
      }

      return {
        ...parameter,
        moduleId: enriched.moduleId,
        modulePath: enriched.modulePath
      };
    })
  };
}

export function updateProjectParameter(
  config: PowerManagementConfig,
  projectId: PowerManagementProjectId,
  parameterId: string,
  patch: Partial<PowerManagementParameterValue>
) {
  const libraryParameterId = getLibraryParameterId(projectId, parameterId);

  return {
    ...config,
    parameterLibrary: config.parameterLibrary.map((parameter) => {
      if (parameter.id !== libraryParameterId) {
        return parameter;
      }

      const existingValue = parameter.values[projectId] ?? {
        currentValue: "待项目确认",
        recommendedValue: "",
        updatedAt: "just now"
      };

      return {
        ...parameter,
        values: {
          ...parameter.values,
          [projectId]: {
            ...existingValue,
            ...patch
          }
        }
      };
    })
  };
}

export function updateProjectParameterMetadata(
  config: PowerManagementConfig,
  projectId: PowerManagementProjectId,
  parameterId: string,
  patch: Partial<
    Omit<
      PowerManagementParameterTemplate,
      "id" | "values"
    >
  >
) {
  const libraryParameterId = getLibraryParameterId(projectId, parameterId);

  return {
    ...config,
    parameterLibrary: config.parameterLibrary.map((parameter) =>
      parameter.id === libraryParameterId ? { ...parameter, ...patch } : parameter
    )
  };
}

export function addProjectParameter(config: PowerManagementConfig) {
  const nextIndex = config.parameterLibrary.length + 1;
  const values = config.projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
    acc[project.id] = {
      currentValue: "0",
      recommendedValue: "0",
      updatedAt: "刚刚"
    };
    return acc;
  }, {} as PowerManagementParameterTemplate["values"]);

  const parameter: PowerManagementParameterTemplate = {
    id: `new-power-parameter-${nextIndex}`,
    name: `new_power_parameter_${nextIndex}`,
    description: "新增电源管理参数说明。",
    explanation: "用于演示新增共享参数后，各项目只维护自己的参数值。",
    configFormat: `JSON: { "power.new.parameter${nextIndex}": number }`,
    module: "Custom Power",
    range: "0 - 100",
    unit: "value",
    risk: "Medium",
    valueKind: "scalar",
    values
  };

  return addParameterModule({
    ...config,
    parameterLibrary: [...config.parameterLibrary, parameter]
  }, parameter.module);
}

export function addProjectParameterFromDraft(
  config: PowerManagementConfig,
  draft: {
    name: string;
    module: string;
    unit: string;
    risk: PowerManagementRisk;
    description: string;
    explanation: string;
    configFormat: string;
    range: string;
    recommendedValue: string;
    valueKind: ParameterValueKind;
  }
) {
  const nextIndex = config.parameterLibrary.length + 1;
  const initialValue = draft.recommendedValue.trim() || "0";
  const values = config.projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
    acc[project.id] = { currentValue: initialValue, recommendedValue: initialValue, updatedAt: "刚刚" };
    return acc;
  }, {} as PowerManagementParameterTemplate["values"]);

  return addParameterModule({
    ...config,
    parameterLibrary: [...config.parameterLibrary, {
      id: `new-power-parameter-${nextIndex}`,
      name: draft.name,
      description: draft.description,
      explanation: draft.explanation,
      configFormat: draft.configFormat,
      module: draft.module,
      range: draft.range,
      unit: draft.unit,
      risk: draft.risk,
      valueKind: draft.valueKind,
      values
    }]
  }, draft.module);
}

export function deleteProjectParameter(config: PowerManagementConfig, parameterId: string) {
  return {
    ...config,
    parameterLibrary: config.parameterLibrary.filter((parameter) => parameter.id !== parameterId)
  };
}

export function deleteAdminProject(config: PowerManagementConfig, projectId: string): PowerManagementConfig {
  return {
    ...config,
    projects: config.projects.filter((project) => project.id !== projectId),
    parameterLibrary: config.parameterLibrary.map((parameter) => ({
      ...parameter,
      values: Object.fromEntries(Object.entries(parameter.values).filter(([valueProjectId]) => valueProjectId !== projectId))
    }))
  };
}

export function countParametersByModule(config: PowerManagementConfig, moduleName: string) {
  return config.parameterLibrary.filter((parameter) => parameter.module === moduleName).length;
}

export function addParameterModule(config: PowerManagementConfig, moduleInput: string | ParameterModuleDraft) {
  const draft =
    typeof moduleInput === "string"
      ? createEmptyParameterModule(moduleInput.trim())
      : normalizeParameterModuleRecord(moduleInput);
  if (!draft.name) {
    return config;
  }
  if (config.parameterModules.some((module) => module.name === draft.name)) {
    return config;
  }

  return {
    ...config,
    parameterModules: [...config.parameterModules, draft].sort((left, right) => left.name.localeCompare(right.name))
  };
}

export function updateParameterModule(config: PowerManagementConfig, moduleName: string, patch: ParameterModulePatch) {
  const existing = config.parameterModules.find((module) => module.name === moduleName);
  if (!existing) {
    return config;
  }

  const nextName = patch.name?.trim() || existing.name;
  if (!nextName) {
    return config;
  }
  if (nextName !== moduleName && config.parameterModules.some((module) => module.name === nextName)) {
    return config;
  }

  const nextModule: PowerManagementParameterModule = {
    name: nextName,
    description: patch.description ?? existing.description,
    scope: patch.scope ?? existing.scope,
    ...(existing.parent ? { parent: existing.parent } : {})
  };

  const parameterModules = config.parameterModules
    .map((module) => {
      if (module.name === moduleName) {
        return nextModule;
      }
      if (nextName !== moduleName && module.parent === moduleName) {
        return { ...module, parent: nextName };
      }
      return module;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  if (nextName === moduleName) {
    return {
      ...config,
      parameterModules
    };
  }

  return {
    ...config,
    parameterModules,
    parameterLibrary: config.parameterLibrary.map((parameter) =>
      parameter.module === moduleName ? { ...parameter, module: nextName } : parameter
    ),
    debugParameters: config.debugParameters.map((parameter) =>
      parameter.module === moduleName ? { ...parameter, module: nextName } : parameter
    )
  };
}

export function renameParameterModule(config: PowerManagementConfig, fromModule: string, toModule: string) {
  return updateParameterModule(config, fromModule, { name: toModule });
}

export function deleteParameterModule(config: PowerManagementConfig, moduleName: string) {
  if (countParametersByModule(config, moduleName) > 0) {
    return config;
  }
  if (countChildParameterModules(config, moduleName) > 0) {
    return config;
  }

  return {
    ...config,
    parameterModules: config.parameterModules.filter((module) => module.name !== moduleName)
  };
}

export function addDebugParameter(config: PowerManagementConfig) {
  const nextIndex = config.debugParameters.length + 1;
  const parameter: PowerManagementDebugParameter = {
    id: `dbg-new-parameter-${nextIndex}`,
    name: `new_debug_parameter_${nextIndex}`,
    key: `debug.new_parameter_${nextIndex}`,
    description: "",
    module: "Charging Policy",
    currentValue: "0",
    targetValue: "0",
    unit: "value",
    range: "0 - 100",
    risk: "Medium",
    status: "待下发",
    nodePath: `/data/local/tmp/wiseeff/debug/new_parameter_${nextIndex}`,
    accessMode: "RW"
  };

  return {
    ...config,
    debugParameters: [...config.debugParameters, parameter]
  };
}

export function addDebugParameterFromDraft(
  config: PowerManagementConfig,
  draft: Omit<PowerManagementDebugParameter, "id">,
  now: Date = new Date()
) {
  const parameter: PowerManagementDebugParameter = {
    id: `dbg-custom-${now.getTime()}`,
    ...draft
  };

  return {
    ...config,
    debugParameters: [...config.debugParameters, parameter]
  };
}

export function deleteDebugParameter(config: PowerManagementConfig, parameterId: string) {
  return {
    ...config,
    debugParameters: config.debugParameters.filter((parameter) => parameter.id !== parameterId)
  };
}

export function updateDebugParameter(
  config: PowerManagementConfig,
  parameterId: string,
  patch: Partial<Pick<PowerManagementDebugParameter, "currentValue" | "targetValue" | "name" | "key" | "description" | "detailedDescription" | "module" | "unit" | "range" | "risk" | "status" | "nodePath" | "accessMode">>
) {
  return {
    ...config,
    debugParameters: config.debugParameters.map((parameter) =>
      parameter.id === parameterId ? { ...parameter, ...patch } : parameter
    )
  };
}

export function serializePowerManagementConfig(config: PowerManagementConfig) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function resolveLibraryParameterId(projectId: PowerManagementProjectId, parameterId: string) {
  const projectPrefix = `${projectId}-`;
  return parameterId.startsWith(projectPrefix) ? parameterId.slice(projectPrefix.length) : parameterId;
}

function getLibraryParameterId(projectId: PowerManagementProjectId, parameterId: string) {
  return resolveLibraryParameterId(projectId, parameterId);
}
