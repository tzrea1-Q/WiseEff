import { describe, expect, it } from "vitest";
import { reducer } from "./App";
import { initialState } from "./mockData";

describe("reducer · SIMULATE_LOG_UPLOAD", () => {
  it("supported=true 时新增 Processing 状态 log", () => {
    const next = reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "new.log", supported: true });

    expect(next.logs.length).toBe(initialState.logs.length + 1);
    expect(next.logs[0].status).toBe("Processing");
    expect(next.logs[0].fileName).toBe("new.log");
    expect(next.logs[0].stage).toBe("parse");
  });

  it("supported=false 时新增 Failed 状态 log 且带 failureReason", () => {
    const next = reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "x.bin", supported: false });

    expect(next.logs[0].status).toBe("Failed");
    expect(next.logs[0].failureReason).toMatch(/不支持/);
  });
});
