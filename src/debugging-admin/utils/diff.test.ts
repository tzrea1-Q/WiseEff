import { describe, expect, it } from "vitest";
import type { PowerManagementConfig, PowerManagementDebugParameter } from "../../powerManagementConfig";
import { computeDirtyDiff } from "./diff";

function makeParam(overrides: Partial<PowerManagementDebugParameter> = {}): PowerManagementDebugParameter {
  return {
    id: "p1",
    name: "fast_charge_current",
    key: "debug.fast_charge_current",
    description: "",
    module: "",
    currentValue: "3800",
    targetValue: "3200",
    unit: "mA",
    range: "1500 - 4500",
    risk: "High",
    status: "待下发",
    ...overrides
  };
}

function makeConfig(debugParameters: PowerManagementDebugParameter[]): PowerManagementConfig {
  return {
    projects: [],
    parameterLibrary: [],
    debugParameters
  };
}

describe("computeDirtyDiff", () => {
  it("两侧完全一致时返回空数组", () => {
    const config = makeConfig([makeParam()]);
    const snapshot = makeConfig([makeParam()]);

    expect(computeDirtyDiff(config, snapshot)).toEqual([]);
  });

  it("识别 added：仅在 configDraft 中出现的参数", () => {
    const snapshot = makeConfig([]);
    const config = makeConfig([makeParam({ id: "p1", name: "new_param" })]);

    const diff = computeDirtyDiff(config, snapshot);

    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("added");
    expect(diff[0].id).toBe("p1");
    expect(diff[0].displayName).toBe("new_param");
    expect(diff[0].changedFields.length).toBeGreaterThan(0);
    expect(diff[0].changedFields.every((field) => field.before === undefined)).toBe(true);
  });

  it("识别 deleted：仅在 persistedSnapshot 中出现的参数", () => {
    const snapshot = makeConfig([makeParam({ id: "p1", name: "removed" })]);
    const config = makeConfig([]);

    const diff = computeDirtyDiff(config, snapshot);

    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("deleted");
    expect(diff[0].id).toBe("p1");
    expect(diff[0].displayName).toBe("removed");
    expect(diff[0].changedFields).toEqual([]);
  });

  it("识别 modified：仅列出真正变化的字段", () => {
    const snapshot = makeConfig([makeParam({ id: "p1", currentValue: "3800", risk: "High" })]);
    const config = makeConfig([makeParam({ id: "p1", currentValue: "3200", risk: "High" })]);

    const diff = computeDirtyDiff(config, snapshot);

    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe("modified");
    expect(diff[0].changedFields).toHaveLength(1);
    expect(diff[0].changedFields[0].name).toBe("currentValue");
    expect(diff[0].changedFields[0].before).toBe("3800");
    expect(diff[0].changedFields[0].after).toBe("3200");
  });

  it("status 字段的差异不计入 dirty", () => {
    const snapshot = makeConfig([makeParam({ id: "p1", status: "待下发" })]);
    const config = makeConfig([makeParam({ id: "p1", status: "下发成功" })]);

    expect(computeDirtyDiff(config, snapshot)).toEqual([]);
  });

  it("每个 changedField 包含中文 label", () => {
    const snapshot = makeConfig([makeParam({ id: "p1", currentValue: "100", targetValue: "200", risk: "Low" })]);
    const config = makeConfig([makeParam({ id: "p1", currentValue: "150", targetValue: "250", risk: "High" })]);

    const diff = computeDirtyDiff(config, snapshot);

    const labels = diff[0].changedFields.map((field) => field.label);
    expect(labels).toContain("默认值");
    expect(labels).toContain("推荐值");
    expect(labels).toContain("风险等级");
  });

  it("added 参数的 changedFields 包含所有非 status 字段", () => {
    const snapshot = makeConfig([]);
    const config = makeConfig([makeParam({ id: "p1" })]);

    const diff = computeDirtyDiff(config, snapshot);

    const names = diff[0].changedFields.map((field) => field.name);
    expect(names).toContain("name");
    expect(names).toContain("key");
    expect(names).toContain("currentValue");
    expect(names).toContain("targetValue");
    expect(names).toContain("unit");
    expect(names).toContain("range");
    expect(names).toContain("risk");
    expect(names).not.toContain("status");
  });

  it("保持输入顺序：按 configDraft 中参数的顺序返回 diff", () => {
    const snapshot = makeConfig([
      makeParam({ id: "p1" }),
      makeParam({ id: "p2" }),
      makeParam({ id: "p3" })
    ]);
    const config = makeConfig([
      makeParam({ id: "p1", currentValue: "111" }),
      makeParam({ id: "p2", currentValue: "222" }),
      makeParam({ id: "p3", currentValue: "333" })
    ]);

    const diff = computeDirtyDiff(config, snapshot);

    expect(diff.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("deleted 参数放在数组末尾（以避免影响 added/modified 的 list 顺序）", () => {
    const snapshot = makeConfig([
      makeParam({ id: "p1" }),
      makeParam({ id: "p-removed" }),
      makeParam({ id: "p2" })
    ]);
    const config = makeConfig([
      makeParam({ id: "p1", currentValue: "111" }),
      makeParam({ id: "p2", currentValue: "222" })
    ]);

    const diff = computeDirtyDiff(config, snapshot);

    expect(diff.map((item) => item.id)).toEqual(["p1", "p2", "p-removed"]);
    expect(diff[2].kind).toBe("deleted");
  });
});
