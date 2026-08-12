import { describe, expect, it } from "vitest";

import { createAppRuntime, type AppRuntimeDeps } from "@/app/appRuntime";
import { initialState } from "@/mockData";
import { createMockRuntimeState } from "@/infrastructure/mock/mockState";

function deps(): AppRuntimeDeps {
  const mockParameterRuntime = createMockRuntimeState(initialState);
  return { getState: () => mockParameterRuntime.current, mockParameterRuntime };
}

describe("createAppRuntime", () => {
  it("selects api adapters in api mode", () => {
    const runtime = createAppRuntime("api", deps());

    expect(runtime.logAnalysisRepository).toBeDefined();
    expect(runtime.dtsReloadRepository).toBeDefined();
    expect(runtime.debuggingGateway).toBeDefined();
    expect(runtime.debuggingAdminClient).toBeDefined();
    expect(runtime.userGovernanceActions).toBeDefined();
  });

  it("keeps api-only adapters absent in mock mode", () => {
    const runtime = createAppRuntime("mock", deps());

    expect(runtime.logAnalysisRepository).toBeUndefined();
    expect(runtime.debuggingGateway).toBeUndefined();
    expect(runtime.debuggingAdminClient).toBeUndefined();
    expect(runtime.userGovernanceActions).toBeUndefined();
    expect(runtime.parameterRepository).toBeDefined();
    expect(runtime.productFeedbackRepository).toBeDefined();
    expect(runtime.knowledgeRepository).toBeDefined();
    expect(runtime.parameterDashboardRepository).toBeDefined();
    // ADR-0002: mock mode substitutes the data source, so DTS reload stays available.
    expect(runtime.dtsReloadRepository).toBeDefined();
  });

  it("prefers overrides over mode selection", () => {
    const parameterRepository = { marker: "override" } as never;
    const dtsReloadRepository = { marker: "reload-override" } as never;
    const runtime = createAppRuntime("api", deps(), {
      parameterRepository,
      dtsReloadRepository,
      listParameterConfigSets: async () => []
    });

    expect(runtime.parameterRepository).toBe(parameterRepository);
    expect(runtime.dtsReloadRepository).toBe(dtsReloadRepository);
    expect(runtime.listParameterConfigSets).toBeDefined();
  });

  it("mock parameter repository reads through the injected mock runtime state", async () => {
    const d = deps();
    const runtime = createAppRuntime("mock", d);

    const projects = await runtime.parameterRepository.listProjects();
    expect(projects.length).toBeGreaterThan(0);
  });
});
