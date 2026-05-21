import powerManagementConfigJson from "./config/power-management.json";

export type PowerManagementRisk = "High" | "Medium" | "Low";

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
  values: Partial<Record<PowerManagementProjectId, PowerManagementParameterValue>>;
};

export type ProjectParameterRecord = Omit<PowerManagementParameterTemplate, "values"> &
  PowerManagementParameterValue & {
    id: string;
    projectId: PowerManagementProjectId;
    values: PowerManagementParameterTemplate["values"];
  };

export type PowerManagementDebugParameter = {
  id: string;
  name: string;
  key: string;
  description: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: PowerManagementRisk;
  status: "已同步" | "待下发" | "下发成功";
  nodePath: string;
  accessMode: NodeAccessMode;
};

export type PowerManagementProject = {
  id: PowerManagementProjectId;
  name: string;
  code: string;
};

export type PowerManagementConfig = {
  projects: PowerManagementProject[];
  parameterLibrary: PowerManagementParameterTemplate[];
  debugParameters: PowerManagementDebugParameter[];
};

export const bundledPowerManagementConfig: PowerManagementConfig = powerManagementConfigJson as PowerManagementConfig;

export function clonePowerManagementConfig(config: PowerManagementConfig): PowerManagementConfig {
  return JSON.parse(JSON.stringify(config)) as PowerManagementConfig;
}

export function flattenProjectParameters(config: PowerManagementConfig): ProjectParameterRecord[] {
  return config.projects.flatMap((project) =>
    config.parameterLibrary.flatMap((parameter) => {
      const value = parameter.values[project.id];
      if (!value) {
        return [];
      }

      return [{
        ...parameter,
        id: `${project.id}-${parameter.id}`,
        projectId: project.id,
        currentValue: value.currentValue,
        recommendedValue: value.recommendedValue,
        updatedAt: value.updatedAt
      }];
    })
  );
}

export function flattenDebugParameters(config: PowerManagementConfig) {
  return config.debugParameters.map((parameter) => ({ ...parameter }));
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
    values
  };

  return {
    ...config,
    parameterLibrary: [...config.parameterLibrary, parameter]
  };
}

export function addProjectParameterFromDraft(
  config: PowerManagementConfig,
  draft: { name: string; module: string; unit: string; risk: PowerManagementRisk; description: string }
) {
  const nextIndex = config.parameterLibrary.length + 1;
  const values = config.projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
    acc[project.id] = { currentValue: "0", recommendedValue: "0", updatedAt: "刚刚" };
    return acc;
  }, {} as PowerManagementParameterTemplate["values"]);

  return {
    ...config,
    parameterLibrary: [...config.parameterLibrary, {
      id: `new-power-parameter-${nextIndex}`,
      name: draft.name,
      description: draft.description,
      explanation: "",
      configFormat: "",
      module: draft.module,
      range: "",
      unit: draft.unit,
      risk: draft.risk,
      values
    }]
  };
}

export function deleteProjectParameter(config: PowerManagementConfig, parameterId: string) {
  return {
    ...config,
    parameterLibrary: config.parameterLibrary.filter((parameter) => parameter.id !== parameterId)
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
  patch: Partial<Pick<PowerManagementDebugParameter, "currentValue" | "targetValue" | "name" | "key" | "description" | "module" | "unit" | "range" | "risk" | "status" | "nodePath" | "accessMode">>
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

function getLibraryParameterId(projectId: PowerManagementProjectId, parameterId: string) {
  const projectPrefix = `${projectId}-`;
  return parameterId.startsWith(projectPrefix) ? parameterId.slice(projectPrefix.length) : parameterId;
}
