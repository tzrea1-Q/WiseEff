import { describe, expect, it } from "vitest";
import { createPrototypeState, initialState } from "./mockData";
import {
  bundledPowerManagementConfig,
  clonePowerManagementConfig,
  syncConfigDraftDebugParameterModuleMetadata
} from "./powerManagementConfig";

describe("调试会话状态字段", () => {
  it("initialState 上存在四个新增字段且初始值正确", () => {
    expect(initialState.lastDebugSnapshot).toBeNull();
    expect(initialState.debugEvents).toEqual([]);
    expect(initialState.pushedDebugIds).toEqual([]);
    expect(initialState.debuggingSessionStartedAt).toBeNull();
  });

  it("新增字段类型允许承载快照结构（运行时写入不报错）", () => {
    const snapshot = {
      id: "snap-0001",
      createdAt: "2026-05-10T20:00:00.000Z",
      entries: [
        { parameterId: "dbg-pid-p", previousValue: "1.2", nextValue: "1.5" }
      ],
      risk: "High" as const
    };
    const nextState = { ...initialState, lastDebugSnapshot: snapshot };
    expect(nextState.lastDebugSnapshot?.entries[0].parameterId).toBe("dbg-pid-p");
  });
});

describe("debugging-admin 基础设施", () => {
  it("initialState 带有 persistedConfigSnapshot，初始值等于 bundledPowerManagementConfig", () => {
    expect(initialState.persistedConfigSnapshot).toBeDefined();
    expect(initialState.persistedConfigSnapshot).toEqual(
      syncConfigDraftDebugParameterModuleMetadata(bundledPowerManagementConfig)
    );
  });

  it("persistedConfigSnapshot 是深拷贝，修改它不影响 bundledPowerManagementConfig", () => {
    const snapshot = initialState.persistedConfigSnapshot;
    const bundled = bundledPowerManagementConfig;

    expect(snapshot).not.toBe(bundled);
    expect(snapshot.debugParameters).not.toBe(bundled.debugParameters);
  });

  it("createPrototypeState 接受自定义 configDraft 时，persistedConfigSnapshot 同步为该 draft 的深拷贝", () => {
    const customConfig = clonePowerManagementConfig(bundledPowerManagementConfig);
    customConfig.debugParameters[0].currentValue = "999";
    const state = createPrototypeState(customConfig);

    expect(state.persistedConfigSnapshot.debugParameters[0].currentValue).toBe("999");
    expect(state.persistedConfigSnapshot).not.toBe(customConfig);
    expect(state.persistedConfigSnapshot.debugParameters[0].moduleId).toBeDefined();
  });
});
