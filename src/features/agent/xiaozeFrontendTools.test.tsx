import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useXiaozeFrontendTools } from "./xiaozeFrontendTools";

const registeredTools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: (config: { name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }) => {
    registeredTools[config.name] = config.handler;
  }
}));

describe("useXiaozeFrontendTools", () => {
  beforeEach(() => {
    Object.keys(registeredTools).forEach((key) => delete registeredTools[key]);
    vi.restoreAllMocks();
  });

  it("registers only the navigate tool without network writes", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const dispatchEvent = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);

    renderHook(() => useXiaozeFrontendTools());

    await registeredTools.navigateTo?.({ path: "/parameters/review" });
    expect(pushState).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));
  });

  it("no longer registers the consumer-less prefillParameterValue tool", () => {
    renderHook(() => useXiaozeFrontendTools());

    // The registry had no consumer anywhere in the app, so the agent claimed
    // "已预填" while nothing on screen changed. The tool must stay removed.
    expect(registeredTools.prefillParameterValue).toBeUndefined();
    expect(Object.keys(registeredTools)).toEqual(["navigateTo"]);
  });

  it("keeps business navigation in the confirmed target and leaves platform configuration global", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
    renderHook(() => useXiaozeFrontendTools("target-b"));
    await registeredTools.navigateTo?.({ path: "/knowledge?entryId=entry-b&organizationId=untrusted" });
    expect(pushState).toHaveBeenLastCalledWith(null, "", "/knowledge?entryId=entry-b&organizationId=target-b");
    await registeredTools.navigateTo?.({ path: "/settings/llm" });
    expect(pushState).toHaveBeenLastCalledWith(null, "", "/settings/llm");
  });
});
