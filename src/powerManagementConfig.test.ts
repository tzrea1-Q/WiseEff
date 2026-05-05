import { describe, expect, it } from "vitest";
import {
  bundledPowerManagementConfig,
  clonePowerManagementConfig,
  flattenDebugParameters,
  flattenProjectParameters,
  serializePowerManagementConfig,
  updateDebugParameter,
  addDebugParameter,
  addProjectParameter,
  deleteDebugParameter,
  deleteProjectParameter,
  updateProjectParameter,
  updateProjectParameterMetadata
} from "./powerManagementConfig";

describe("powerManagementConfig", () => {
  it("ships one shared project parameter library used by all projects", () => {
    expect(bundledPowerManagementConfig.projects).toHaveLength(3);
    expect(bundledPowerManagementConfig.parameterLibrary).toHaveLength(10);
    expect(bundledPowerManagementConfig.projects.some((project) => "parameters" in project)).toBe(false);
    expect(bundledPowerManagementConfig.debugParameters.length).toBeGreaterThanOrEqual(8);
  });

  it("round-trips config edits through helper functions", () => {
    const draft = clonePowerManagementConfig(bundledPowerManagementConfig);
    const editedProjectMetadata = updateProjectParameterMetadata(draft, "aurora", "aurora-fast-charge-current", {
      description: "快充阶段输入电流限制"
    });
    const editedProject = updateProjectParameter(editedProjectMetadata, "aurora", "aurora-fast-charge-current", {
      currentValue: "3600",
      recommendedValue: "3300"
    });
    const editedDebug = updateDebugParameter(editedProject, "dbg-charge-input-current", {
      targetValue: "3600",
      status: "下发成功"
    });

    expect(
      editedDebug.parameterLibrary.find((parameter) => parameter.id === "fast-charge-current")?.description
    ).toBe("快充阶段输入电流限制");
    expect(
      editedDebug.parameterLibrary.find((parameter) => parameter.id === "fast-charge-current")?.values.aurora
    ).toMatchObject({
      currentValue: "3600",
      recommendedValue: "3300"
    });
    expect(editedDebug.debugParameters.find((parameter) => parameter.id === "dbg-charge-input-current")).toMatchObject({
      targetValue: "3600",
      status: "下发成功"
    });

    const serialized = serializePowerManagementConfig(editedDebug);
    expect(serialized).toContain('"currentValue": "3600"');
    expect(serialized).toContain('"targetValue": "3600"');
  });

  it("flattens project and debug catalogs for runtime state", () => {
    expect(flattenProjectParameters(bundledPowerManagementConfig)).toHaveLength(30);
    expect(flattenDebugParameters(bundledPowerManagementConfig)).toHaveLength(8);
  });

  it("adds and deletes project and debug parameters", () => {
    const draft = clonePowerManagementConfig(bundledPowerManagementConfig);
    const withProjectParameter = addProjectParameter(draft);
    const addedProjectParameter = withProjectParameter.parameterLibrary.at(-1);

    expect(addedProjectParameter?.name).toBe("new_power_parameter_11");
    expect(addedProjectParameter?.values.aurora.currentValue).toBe("0");
    expect(deleteProjectParameter(withProjectParameter, addedProjectParameter?.id ?? "").parameterLibrary).toHaveLength(10);

    const withDebugParameter = addDebugParameter(draft);
    const addedDebugParameter = withDebugParameter.debugParameters.at(-1);

    expect(addedDebugParameter?.name).toBe("new_debug_parameter_9");
    expect(addedDebugParameter?.key).toBe("debug.new_parameter_9");
    expect(deleteDebugParameter(withDebugParameter, addedDebugParameter?.id ?? "").debugParameters).toHaveLength(8);
  });
});
