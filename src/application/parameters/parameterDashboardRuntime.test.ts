import { describe, expect, it, vi } from "vitest";
import { createParameterDashboardRuntime } from "./parameterDashboardRuntime";

describe("parameterDashboardRuntime", () => {
  it("dispatches loading then ready for summary", async () => {
    const dispatch = vi.fn();
    const repository = {
      listDashboardSummary: vi.fn(async () => ({ window: "30d" }) as any),
      listDashboardHotspots: vi.fn()
    } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    await runtime.loadSummary({ window: "30d" });
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "DASHBOARD_SUMMARY_LOADING" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "DASHBOARD_SUMMARY_READY", data: { window: "30d" } });
  });

  it("dispatches error on failure", async () => {
    const dispatch = vi.fn();
    const repository = {
      listDashboardSummary: vi.fn(async () => {
        throw new Error("x");
      }),
      listDashboardHotspots: vi.fn()
    } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    await runtime.loadSummary({ window: "30d" });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "DASHBOARD_SUMMARY_ERROR", error: expect.any(String) });
  });

  it("ignores a stale summary response after the project scope changes", async () => {
    const dispatch = vi.fn();
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const repository = {
      listDashboardSummary: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; })),
      listDashboardHotspots: vi.fn()
    } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    const first = runtime.loadSummary({ projectId: "project-a", window: "30d" });
    const second = runtime.loadSummary({ projectId: "project-b", window: "30d" });
    resolveFirst({ projectId: "project-a" });
    await first;
    expect(dispatch).not.toHaveBeenCalledWith({ type: "DASHBOARD_SUMMARY_READY", data: { projectId: "project-a" } });
    resolveSecond({ projectId: "project-b" });
    await second;
    expect(dispatch).toHaveBeenLastCalledWith({ type: "DASHBOARD_SUMMARY_READY", data: { projectId: "project-b" } });
  });

  it("ignores a stale hotspot error after the dimension changes", async () => {
    const dispatch = vi.fn();
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const repository = {
      listDashboardSummary: vi.fn(),
      listDashboardHotspots: vi
        .fn()
        .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
    } as any;
    const runtime = createParameterDashboardRuntime({ repository, dispatch });
    const first = runtime.loadHotspots({ dimension: "project", window: "30d" });
    const second = runtime.loadHotspots({ dimension: "parameter", window: "30d" });
    rejectFirst(new Error("stale database error"));
    await first;
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "DASHBOARD_HOTSPOTS_ERROR" }));
    resolveSecond([]);
    await second;
    expect(dispatch).toHaveBeenLastCalledWith({ type: "DASHBOARD_HOTSPOTS_READY", data: [] });
  });
});
