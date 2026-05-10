import { describe, expect, it } from "vitest";
import { initialState } from "./mockData";

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
