import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reducer } from "./App";
import { createPrototypeState } from "./mockData";

describe("CONNECT_DEVICE（改写）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T20:30:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("首次连接写入 debuggingSessionStartedAt 与 connect 事件", () => {
    const state = createPrototypeState();
    const deviceId = state.devices[0].id;
    const next = reducer(state, { type: "CONNECT_DEVICE", deviceId });

    expect(next.debuggingSessionStartedAt).toBe("2026-05-10T20:30:00.000Z");
    expect(next.debugEvents).toHaveLength(1);
    expect(next.debugEvents[0]).toMatchObject({
      kind: "connect",
      deviceId,
      at: "2026-05-10T20:30:00.000Z"
    });
    expect(next.devices.find((device) => device.id === deviceId)?.status).toBe("已连接");
  });

  it("已连接过的会话再次 connect 不覆盖 startedAt", () => {
    const base = createPrototypeState();
    const first = reducer(base, { type: "CONNECT_DEVICE", deviceId: base.devices[0].id });
    vi.setSystemTime(new Date("2026-05-10T20:45:00.000Z"));
    const second = reducer(first, { type: "CONNECT_DEVICE", deviceId: base.devices[0].id });

    expect(second.debuggingSessionStartedAt).toBe(first.debuggingSessionStartedAt);
    expect(second.debugEvents).toHaveLength(2);
  });
});

describe("PUSH_DEBUG_VALUES（改写）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T20:35:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("生成快照、记录事件、填充 pushedDebugIds、更新 currentValue", () => {
    const base = createPrototypeState();
    const target = base.debugParameters[0];
    const stateWithDraft = {
      ...base,
      debugParameters: base.debugParameters.map((parameter) =>
        parameter.id === target.id ? { ...parameter, targetValue: "9.9" } : parameter
      )
    };
    const next = reducer(stateWithDraft, {
      type: "PUSH_DEBUG_VALUES",
      parameterIds: [target.id]
    });

    expect(next.lastDebugSnapshot).not.toBeNull();
    expect(next.lastDebugSnapshot?.entries).toHaveLength(1);
    expect(next.lastDebugSnapshot?.entries[0]).toMatchObject({
      parameterId: target.id,
      previousValue: target.currentValue,
      nextValue: "9.9"
    });
    expect(next.lastDebugSnapshot?.risk).toBe(target.risk);
    expect(next.pushedDebugIds).toEqual([target.id]);
    expect(next.debugEvents).toHaveLength(1);
    expect(next.debugEvents[0]).toMatchObject({
      kind: "push",
      snapshotId: next.lastDebugSnapshot?.id,
      parameterIds: [target.id]
    });
    const updated = next.debugParameters.find((parameter) => parameter.id === target.id);
    expect(updated?.currentValue).toBe("9.9");
  });

  it("批次中最高风险是 High 时快照 risk = High", () => {
    const base = createPrototypeState();
    const lowRisk = base.debugParameters.find((parameter) => parameter.risk === "Low");
    const highRisk = base.debugParameters.find((parameter) => parameter.risk === "High");
    if (!lowRisk || !highRisk) {
      throw new Error("测试数据需要同时含 High / Low 两档");
    }
    const stateWithDraft = {
      ...base,
      debugParameters: base.debugParameters.map((parameter) =>
        parameter.id === lowRisk.id || parameter.id === highRisk.id
          ? { ...parameter, targetValue: "1" }
          : parameter
      )
    };
    const next = reducer(stateWithDraft, {
      type: "PUSH_DEBUG_VALUES",
      parameterIds: [lowRisk.id, highRisk.id]
    });

    expect(next.lastDebugSnapshot?.risk).toBe("High");
  });
});

describe("ROLLBACK_LAST_SNAPSHOT（新增）", () => {
  it("将快照里的 previousValue 写回 currentValue，清空快照与 pushedDebugIds，产出 rollback 事件", () => {
    const base = createPrototypeState();
    const target = base.debugParameters[0];
    const pushed = reducer(
      {
        ...base,
        debugParameters: base.debugParameters.map((parameter) =>
          parameter.id === target.id ? { ...parameter, targetValue: "42" } : parameter
        )
      },
      { type: "PUSH_DEBUG_VALUES", parameterIds: [target.id] }
    );

    const rolledBack = reducer(pushed, { type: "ROLLBACK_LAST_SNAPSHOT" });

    expect(rolledBack.lastDebugSnapshot).toBeNull();
    expect(rolledBack.pushedDebugIds).toEqual([]);
    const restored = rolledBack.debugParameters.find((parameter) => parameter.id === target.id);
    expect(restored?.currentValue).toBe(target.currentValue);
    expect(restored?.targetValue).toBe("42");
    const lastEvent = rolledBack.debugEvents.at(-1);
    expect(lastEvent?.kind).toBe("rollback");
  });

  it("没有快照时是 no-op（不抛异常、状态不变）", () => {
    const base = createPrototypeState();
    const next = reducer(base, { type: "ROLLBACK_LAST_SNAPSHOT" });
    expect(next).toBe(base);
  });
});

describe("ROLLBACK_UNDO_PUSH（新增）", () => {
  it("行为等价 ROLLBACK_LAST_SNAPSHOT，但事件类型为 rollback-undo", () => {
    const base = createPrototypeState();
    const target = base.debugParameters[0];
    const pushed = reducer(
      {
        ...base,
        debugParameters: base.debugParameters.map((parameter) =>
          parameter.id === target.id ? { ...parameter, targetValue: "42" } : parameter
        )
      },
      { type: "PUSH_DEBUG_VALUES", parameterIds: [target.id] }
    );

    const undone = reducer(pushed, { type: "ROLLBACK_UNDO_PUSH" });

    expect(undone.lastDebugSnapshot).toBeNull();
    const lastEvent = undone.debugEvents.at(-1);
    expect(lastEvent?.kind).toBe("rollback-undo");
  });
});

describe("CLEAR_PUSHED_DEBUG_IDS（新增）", () => {
  it("从 pushedDebugIds 中移除指定 id", () => {
    const base = createPrototypeState();
    const state = {
      ...base,
      pushedDebugIds: ["a", "b", "c"]
    };
    const next = reducer(state, { type: "CLEAR_PUSHED_DEBUG_IDS", parameterIds: ["b"] });
    expect(next.pushedDebugIds).toEqual(["a", "c"]);
  });
});

describe("MARK_CONFIG_PERSISTED", () => {
  it("把 persistedConfigSnapshot 更新为当前 configDraft 的深拷贝", () => {
    const base = createPrototypeState();
    const modified = {
      ...base,
      configDraft: {
        ...base.configDraft,
        debugParameters: base.configDraft.debugParameters.map((parameter, index) =>
          index === 0 ? { ...parameter, currentValue: "8888" } : parameter
        )
      }
    };

    expect(modified.persistedConfigSnapshot.debugParameters[0].currentValue)
      .not.toBe("8888");

    const next = reducer(modified, { type: "MARK_CONFIG_PERSISTED" });

    expect(next.persistedConfigSnapshot.debugParameters[0].currentValue).toBe("8888");
    expect(next.persistedConfigSnapshot).not.toBe(next.configDraft);
    expect(next.persistedConfigSnapshot.debugParameters)
      .not.toBe(next.configDraft.debugParameters);
  });

  it("追加一条通知", () => {
    const base = createPrototypeState();
    const next = reducer(base, { type: "MARK_CONFIG_PERSISTED" });

    expect(next.notifications[0]).toMatch(/持久化|已写入|已保存/);
  });
});

describe("COMMIT_DEBUG_PARAMETER_DRAFT", () => {
  it("把 draft 写入 configDraft，并同步更新 debugParameters", () => {
    const base = createPrototypeState();
    const target = base.debugParameters[0];
    const draft = {
      name: "修改后的名称",
      key: target.key,
      currentValue: "1234",
      targetValue: "5678",
      unit: target.unit,
      range: target.range,
      risk: "High" as const,
      status: target.status
    };

    const next = reducer(base, {
      type: "COMMIT_DEBUG_PARAMETER_DRAFT",
      parameterId: target.id,
      draft
    });

    const configParam = next.configDraft.debugParameters.find(
      (parameter) => parameter.id === target.id
    );
    expect(configParam?.name).toBe("修改后的名称");
    expect(configParam?.currentValue).toBe("1234");
    expect(configParam?.targetValue).toBe("5678");
    expect(configParam?.risk).toBe("High");

    const runtimeParam = next.debugParameters.find(
      (parameter) => parameter.id === target.id
    );
    expect(runtimeParam?.name).toBe("修改后的名称");
    expect(runtimeParam?.currentValue).toBe("1234");
  });

  it("无视 draft 中的 status 字段，保持 configDraft 里原有的 status", () => {
    const base = createPrototypeState();
    const target = base.debugParameters[0];
    const originalStatus = target.status;

    const draft = {
      name: target.name,
      key: target.key,
      currentValue: target.currentValue,
      targetValue: target.targetValue,
      unit: target.unit,
      range: target.range,
      risk: target.risk,
      status: originalStatus === "待下发" ? "下发成功" : "待下发"
    } as const;

    const next = reducer(base, {
      type: "COMMIT_DEBUG_PARAMETER_DRAFT",
      parameterId: target.id,
      draft
    });

    const configParam = next.configDraft.debugParameters.find(
      (parameter) => parameter.id === target.id
    );
    expect(configParam?.status).toBe(originalStatus);
  });

  it("不存在的 parameterId 保持 state 不变", () => {
    const base = createPrototypeState();
    const draft = {
      name: "x",
      key: "x",
      currentValue: "0",
      targetValue: "0",
      unit: "v",
      range: "0 - 1",
      risk: "Low" as const,
      status: "待下发" as const
    };

    const next = reducer(base, {
      type: "COMMIT_DEBUG_PARAMETER_DRAFT",
      parameterId: "dbg-does-not-exist",
      draft
    });

    expect(next.configDraft).toEqual(base.configDraft);
    expect(next.debugParameters).toEqual(base.debugParameters);
  });
});

describe("DISCARD_ALL_DEBUG_DIRTY", () => {
  it("把 configDraft.debugParameters 恢复到 persistedConfigSnapshot.debugParameters", () => {
    const base = createPrototypeState();
    const modified = {
      ...base,
      configDraft: {
        ...base.configDraft,
        debugParameters: base.configDraft.debugParameters.map((parameter, index) =>
          index === 0 ? { ...parameter, currentValue: "9999", name: "被改动" } : parameter
        )
      }
    };

    const next = reducer(modified, { type: "DISCARD_ALL_DEBUG_DIRTY" });

    expect(next.configDraft.debugParameters).toEqual(base.persistedConfigSnapshot.debugParameters);
  });

  it("不改动 parameterLibrary 和 projects", () => {
    const base = createPrototypeState();
    const modified = {
      ...base,
      configDraft: {
        ...base.configDraft,
        debugParameters: [...base.configDraft.debugParameters].reverse()
      }
    };

    const next = reducer(modified, { type: "DISCARD_ALL_DEBUG_DIRTY" });

    expect(next.configDraft.parameterLibrary).toBe(modified.configDraft.parameterLibrary);
    expect(next.configDraft.projects).toBe(modified.configDraft.projects);
  });

  it("同步更新 derived debugParameters 运行时字段", () => {
    const base = createPrototypeState();
    const modified = {
      ...base,
      configDraft: {
        ...base.configDraft,
        debugParameters: base.configDraft.debugParameters.map((parameter) => ({
          ...parameter,
          currentValue: "0"
        }))
      }
    };

    const next = reducer(modified, { type: "DISCARD_ALL_DEBUG_DIRTY" });

    expect(next.debugParameters).toEqual(
      base.persistedConfigSnapshot.debugParameters.map((parameter) => ({ ...parameter }))
    );
  });
});
