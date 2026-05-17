import { describe, expect, it } from "vitest";
import { createPrototypeState } from "@/mockData";
import { createMockRuntimeState, readMockState, writeMockState } from "./mockState";

describe("mock runtime state", () => {
  it("wraps prototype state behind a mutable adapter", () => {
    const initial = createPrototypeState();
    const runtime = createMockRuntimeState(initial);

    expect(readMockState(runtime)).toBe(initial);

    const next = { ...initial, activeProjectId: "nebula" };
    expect(writeMockState(runtime, next)).toBe(next);
    expect(readMockState(runtime).activeProjectId).toBe("nebula");
  });
});
