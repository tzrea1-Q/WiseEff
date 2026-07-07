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
});
