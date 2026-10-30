import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useXiaozeFrontendTools } from "./xiaozeFrontendTools";

const registeredTools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
const toolOptions: Record<string, { followUp?: boolean; deps?: unknown[] }> = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: (config: { name: string; handler: (args: Record<string, unknown>) => Promise<unknown>; followUp?: boolean }, deps?: unknown[]) => {
    registeredTools[config.name] = config.handler;
    toolOptions[config.name] = { followUp: config.followUp, deps };
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
    expect(Object.keys(registeredTools)).toEqual(["navigateTo", "openDefinitionImport"]);
  });

  it("hands a prepared document to the catalog without previewing it, and refuses without author permission", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(window, "fetch");
    const notify = vi.fn();
    const { rerender } = renderHook(({ permissions }) => useXiaozeFrontendTools({ organizationId: "target-b", permissions, userId: "user-b", notify }),
      { initialProps: { permissions: [] as string[] } });
    expect(await registeredTools.openDefinitionImport({ document: "# Driver `acme,x`" })).toEqual(
      expect.objectContaining({ message: expect.stringContaining("catalog:author") }));
    expect(pushState).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("catalog:author"));
    rerender({ permissions: ["catalog:author"] });
    await registeredTools.openDefinitionImport({ document: "# Driver `acme,x`" });
    expect(toolOptions.openDefinitionImport).toEqual({ followUp: false, deps: ["target-b", "user-b", ["catalog:author"], undefined] });
    expect(pushState).toHaveBeenCalledWith(null, "", "/parameter-admin/specs?organizationId=target-b");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the home organization without adding a scope query", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    renderHook(() => useXiaozeFrontendTools({ permissions: ["catalog:author"], userId: "user-home", homeOrganizationId: "org-home" }));
    await registeredTools.openDefinitionImport({ document: "文档" });
    expect(pushState).toHaveBeenCalledWith(null, "", "/parameter-admin/specs");
  });

  it("keeps business navigation in the confirmed target and leaves platform configuration global", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
    renderHook(() => useXiaozeFrontendTools({ organizationId: "target-b" }));
    await registeredTools.navigateTo?.({ path: "/knowledge?entryId=entry-b&organizationId=untrusted" });
    expect(pushState).toHaveBeenLastCalledWith(null, "", "/knowledge?entryId=entry-b&organizationId=target-b");
    await registeredTools.navigateTo?.({ path: "/settings/llm" });
    expect(pushState).toHaveBeenLastCalledWith(null, "", "/settings/llm");
  });
});
