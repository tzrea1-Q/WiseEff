import { describe, expect, it } from "vitest";
import {
  bundledPowerManagementConfig,
  clonePowerManagementConfig,
  flattenDebugParameters,
  flattenProjectParameters,
  serializePowerManagementConfig,
  updateDebugParameter,
  addDebugParameter,
  addDebugParameterFromDraft,
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

  it("supports runtime-created project ids in parameter values", () => {
    const config = {
      ...bundledPowerManagementConfig,
      projects: [...bundledPowerManagementConfig.projects, { id: "zephyr", name: "Zephyr", code: "ZEP" }],
      parameterLibrary: bundledPowerManagementConfig.parameterLibrary.map((parameter, index) =>
        index === 0
          ? {
              ...parameter,
              values: {
                ...parameter.values,
                zephyr: {
                  currentValue: "待项目确认",
                  recommendedValue: "35",
                  updatedAt: "just now"
                }
              }
            }
          : parameter
      )
    };

    const flattened = flattenProjectParameters(config);

    expect(flattened.some((parameter) => parameter.projectId === "zephyr")).toBe(true);
    expect(flattened.filter((parameter) => parameter.projectId === "zephyr")).toHaveLength(1);
  });

  it("creates a complete value when updating a missing runtime project parameter value", () => {
    const firstParameter = bundledPowerManagementConfig.parameterLibrary[0];
    const config = {
      ...bundledPowerManagementConfig,
      projects: [...bundledPowerManagementConfig.projects, { id: "zephyr", name: "Zephyr", code: "ZEP" }]
    };

    const next = updateProjectParameter(config, "zephyr", `zephyr-${firstParameter.id}`, {
      recommendedValue: "42"
    });

    expect(next.parameterLibrary[0].values.zephyr).toEqual({
      currentValue: "待项目确认",
      recommendedValue: "42",
      updatedAt: "just now"
    });
  });

  it("ships node metadata for every debug parameter", () => {
    expect(bundledPowerManagementConfig.debugParameters.length).toBeGreaterThan(0);
    for (const parameter of bundledPowerManagementConfig.debugParameters) {
      expect(parameter.nodePath).toMatch(/^\//);
      expect(["RO", "WO", "RW"]).toContain(parameter.accessMode);
    }
  });

  it("round-trips node metadata through debug helpers", () => {
    const draft = clonePowerManagementConfig(bundledPowerManagementConfig);
    const edited = updateDebugParameter(draft, "dbg-charge-input-current", {
      nodePath: "/sys/class/power_supply/battery/input_current_limit",
      accessMode: "RW"
    });

    expect(edited.debugParameters.find((parameter) => parameter.id === "dbg-charge-input-current")).toMatchObject({
      nodePath: "/sys/class/power_supply/battery/input_current_limit",
      accessMode: "RW"
    });
    expect(serializePowerManagementConfig(edited)).toContain('"accessMode": "RW"');
  });

  it("adds and deletes project and debug parameters", () => {
    const draft = clonePowerManagementConfig(bundledPowerManagementConfig);
    const withProjectParameter = addProjectParameter(draft);
    const addedProjectParameter = withProjectParameter.parameterLibrary.at(-1);

    expect(addedProjectParameter?.name).toBe("new_power_parameter_11");
    expect(addedProjectParameter?.values.aurora?.currentValue).toBe("0");
    expect(deleteProjectParameter(withProjectParameter, addedProjectParameter?.id ?? "").parameterLibrary).toHaveLength(10);

    const withDebugParameter = addDebugParameter(draft);
    const addedDebugParameter = withDebugParameter.debugParameters.at(-1);

    expect(addedDebugParameter?.name).toBe("new_debug_parameter_9");
    expect(addedDebugParameter?.key).toBe("debug.new_parameter_9");
    expect(deleteDebugParameter(withDebugParameter, addedDebugParameter?.id ?? "").debugParameters).toHaveLength(8);
  });
});

describe("addDebugParameterFromDraft", () => {
  it("把 draft 加到 debugParameters 列表末尾，使用 timestamp id", () => {
    const base = clonePowerManagementConfig(bundledPowerManagementConfig);
    const draft = {
      name: "pid_kp_coefficient",
      key: "debug.pid.kp",
      description: "",
      module: "",
      currentValue: "0.8",
      targetValue: "1.0",
      unit: "",
      range: "0.1 - 2.0",
      risk: "Medium" as const,
      status: "待下发" as const,
      nodePath: "/sys/devices/platform/wiseeff/test",
      accessMode: "RW" as const
    };
    const fixedNow = new Date("2026-05-10T23:45:00.000Z");

    const next = addDebugParameterFromDraft(base, draft, fixedNow);

    expect(next.debugParameters).toHaveLength(base.debugParameters.length + 1);
    const added = next.debugParameters[next.debugParameters.length - 1];
    expect(added.id).toBe(`dbg-custom-${fixedNow.getTime()}`);
    expect(added.name).toBe("pid_kp_coefficient");
    expect(added.key).toBe("debug.pid.kp");
    expect(added.currentValue).toBe("0.8");
    expect(added.targetValue).toBe("1.0");
    expect(added.risk).toBe("Medium");
  });

  it("不改动 base config 对象（返回新对象）", () => {
    const base = clonePowerManagementConfig(bundledPowerManagementConfig);
    const originalLength = base.debugParameters.length;
    const draft = {
      name: "test",
      key: "test.key",
      description: "",
      module: "",
      currentValue: "0",
      targetValue: "0",
      unit: "",
      range: "",
      risk: "Low" as const,
      status: "待下发" as const,
      nodePath: "/sys/devices/platform/wiseeff/test",
      accessMode: "RW" as const
    };

    const next = addDebugParameterFromDraft(base, draft, new Date("2026-05-10T00:00:00.000Z"));

    expect(base.debugParameters).toHaveLength(originalLength);
    expect(next).not.toBe(base);
    expect(next.debugParameters).not.toBe(base.debugParameters);
  });

  it("保留 draft 的 status 字段", () => {
    const base = clonePowerManagementConfig(bundledPowerManagementConfig);
    const draft = {
      name: "status_test",
      key: "status.test",
      description: "",
      module: "",
      currentValue: "1",
      targetValue: "1",
      unit: "",
      range: "",
      risk: "Low" as const,
      status: "已同步" as const,
      nodePath: "/sys/devices/platform/wiseeff/test",
      accessMode: "RW" as const
    };

    const next = addDebugParameterFromDraft(base, draft, new Date("2026-05-10T00:00:00.000Z"));

    expect(next.debugParameters.at(-1)?.status).toBe("已同步");
  });
});
