import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getXiaozePrefillRegistry, resetXiaozePrefillRegistry, useXiaozeFrontendTools } from "./xiaozeFrontendTools";

const registeredTools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: (config: { name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }) => {
    registeredTools[config.name] = config.handler;
  }
}));

describe("useXiaozeFrontendTools", () => {
  beforeEach(() => {
    Object.keys(registeredTools).forEach((key) => delete registeredTools[key]);
    resetXiaozePrefillRegistry();
    vi.restoreAllMocks();
  });

  it("registers navigate and prefill tools without network writes", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const dispatchEvent = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);

    renderHook(() => useXiaozeFrontendTools());

    await registeredTools.navigateTo?.({ path: "/parameters/review" });
    expect(pushState).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));

    await registeredTools.prefillParameterValue?.({ parameterId: "pd1", value: "18A" });
    expect(getXiaozePrefillRegistry()).toEqual({ parameterId: "pd1", value: "18A" });
  });
});
