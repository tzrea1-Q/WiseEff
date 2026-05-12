import { describe, expect, it } from "vitest";
import {
  computeDeviation,
  deriveDebugParameterStatus,
  deriveSessionMetrics,
  parseRange
} from "./debuggingAnalytics";
import { createPrototypeState, type DebugParameter } from "./mockData";

describe("parseRange", () => {
  it("解析 '2500 - 4500' 形状", () => {
    expect(parseRange("2500 - 4500")).toEqual([2500, 4500]);
  });

  it("解析 '0 - 100' 形状", () => {
    expect(parseRange("0 - 100")).toEqual([0, 100]);
  });

  it("无法解析时返回 null", () => {
    expect(parseRange("不规则")).toBeNull();
    expect(parseRange("")).toBeNull();
  });
});

describe("computeDeviation", () => {
  it("返回相对 current 的带符号百分比（两位小数）", () => {
    expect(computeDeviation("3800", "3200")).toBeCloseTo(-15.79, 2);
    expect(computeDeviation("100", "110")).toBeCloseTo(10, 2);
  });

  it("current 为 0 时返回 null（避免除零）", () => {
    expect(computeDeviation("0", "10")).toBeNull();
  });

  it("无法解析时返回 null", () => {
    expect(computeDeviation("abc", "10")).toBeNull();
  });
});

describe("deriveDebugParameterStatus", () => {
  const parameter: DebugParameter = {
    id: "dbg-x",
    name: "x",
    key: "charger.x",
    description: "",
    module: "",
    currentValue: "10",
    targetValue: "10",
    unit: "A",
    range: "0 - 100",
    risk: "Medium",
    status: "已同步"
  };

  it("当前值等于目标值 → 已同步", () => {
    expect(deriveDebugParameterStatus(parameter, new Set())).toBe("已同步");
  });

  it("当前值不等于目标值 → 待下发", () => {
    const p = { ...parameter, targetValue: "12" };
    expect(deriveDebugParameterStatus(p, new Set())).toBe("待下发");
  });

  it("处于 pushedIds 集合 → 下发成功（优先级最高）", () => {
    const p = { ...parameter, targetValue: "12" };
    expect(deriveDebugParameterStatus(p, new Set(["dbg-x"]))).toBe("下发成功");
  });
});

describe("deriveSessionMetrics", () => {
  it("未开始会话时所有指标为 0 / null", () => {
    const state = createPrototypeState();
    const metrics = deriveSessionMetrics(state, new Date("2026-05-10T20:30:00.000Z"));
    expect(metrics.sessionDurationMinutes).toBeNull();
    expect(metrics.pushedCount).toBe(0);
    expect(metrics.pendingCount).toBeGreaterThanOrEqual(0);
    expect(metrics.failedCount).toBe(0);
  });

  it("会话已开始时，按 now - startedAt 计算分钟数（向下取整）", () => {
    const state = {
      ...createPrototypeState(),
      debuggingSessionStartedAt: "2026-05-10T20:00:00.000Z"
    };
    const metrics = deriveSessionMetrics(state, new Date("2026-05-10T20:12:45.000Z"));
    expect(metrics.sessionDurationMinutes).toBe(12);
  });

  it("pushedCount = 至少一项在 pushedDebugIds 集合中的参数数", () => {
    const base = createPrototypeState();
    const pushedId = base.debugParameters[0].id;
    const state = {
      ...base,
      pushedDebugIds: [pushedId]
    };
    const metrics = deriveSessionMetrics(state, new Date());
    expect(metrics.pushedCount).toBe(1);
  });
});
