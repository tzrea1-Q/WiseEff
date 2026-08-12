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
    expect(runtime.dtsReloadRepository).not.toBeNull();
    expect(runtime.debuggingGateway).toBeDefined();
    expect(runtime.debuggingAdminClient).toBeDefined();
    expect(runtime.userGovernanceActions).toBeDefined();
  });

  it("keeps api-only adapters absent in mock mode", () => {
    const runtime = createAppRuntime("mock", deps());

    expect(runtime.logAnalysisRepository).toBeUndefined();
    expect(runtime.dtsReloadRepository).toBeNull();
    expect(runtime.debuggingGateway).toBeUndefined();
    expect(runtime.debuggingAdminClient).toBeUndefined();
    expect(runtime.userGovernanceActions).toBeUndefined();
    expect(runtime.parameterRepository).toBeDefined();
    expect(runtime.productFeedbackRepository).toBeDefined();
    expect(runtime.knowledgeRepository).toBeDefined();
    expect(runtime.parameterDashboardRepository).toBeDefined();
  });

  it("prefers overrides over mode selection, including null dtsReloadRepository", () => {
    const parameterRepository = { marker: "override" } as never;
    const runtime = createAppRuntime("api", deps(), {
      parameterRepository,
      dtsReloadRepository: null,
      listParameterConfigSets: async () => []
    });

    expect(runtime.parameterRepository).toBe(parameterRepository);
    expect(runtime.dtsReloadRepository).toBeNull();
    expect(runtime.listParameterConfigSets).toBeDefined();
  });

  it("mock parameter repository reads through the injected mock runtime state", async () => {
    const d = deps();
    const runtime = createAppRuntime("mock", d);

    const projects = await runtime.parameterRepository.listProjects();
    expect(projects.length).toBeGreaterThan(0);
  });
});
