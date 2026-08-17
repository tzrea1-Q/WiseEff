import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/XiaozeProvider", () => ({
  XiaozeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  XiaozeProactiveInsights: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn()
}));

import { createMockParameterRepository } from "@/infrastructure/mock/mockParameterRepository";
import { createMockRuntimeState } from "@/infrastructure/mock/mockState";
import { createPrototypeState } from "@/infrastructure/mock/prototypeState";

import {
  createTestAppPorts,
  createTestAuthClient,
  createTestParameterRepository,
  renderApp,
  withPortSpies
} from "./index";

describe("createTestAppPorts", () => {
  it("assembles App ports from mock adapters", async () => {
    const ports = createTestAppPorts();
    const projects = await ports.parameterRepository.listProjects();
    const specs = await ports.parameterTopologyRepository.listSpecs({});

    expect(projects.length).toBeGreaterThan(0);
    expect(specs.some((spec) => spec.propertyKey === "gpio_int")).toBe(true);
    expect(ports.debuggingGateway.detectTargets).toEqual(expect.any(Function));
    expect(ports.logAnalysisRepository).toBeDefined();
  });

  it("lets a per-port override replace the mock adapter", async () => {
    const listProjects = vi.fn().mockResolvedValue([{ id: "override-project", name: "Override", code: "OVR" }]);
    const ports = createTestAppPorts({
      overrides: {
        parameterRepository: withPortSpies(createMockParameterRepository(createMockRuntimeState()), {
          listProjects
        })
      }
    });

    await expect(ports.parameterRepository.listProjects()).resolves.toEqual([
      { id: "override-project", name: "Override", code: "OVR" }
    ]);
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("records traffic on spy-wrapped default ports", async () => {
    const ports = createTestAppPorts();
    await ports.parameterRepository.listParameters();
    expect(ports.parameterRepository.listParameters).toHaveBeenCalled();
  });
});

describe("createTestAuthClient", () => {
  it("resolves the admin fixture", async () => {
    const client = createTestAuthClient("admin");
    await expect(client.getCurrentAuthContext()).resolves.toMatchObject({
      user: { name: "API Admin" },
      roles: [{ roleId: "admin" }]
    });
  });
});

describe("createTestParameterRepository", () => {
  it("serves prototype parameters and accepts method overrides", async () => {
    const repository = createTestParameterRepository({
      listProjects: vi.fn().mockResolvedValue([])
    });

    await expect(repository.listProjects()).resolves.toEqual([]);
    const parameters = await repository.listParameters();
    expect(parameters.length).toBeGreaterThan(0);
  });
});

describe("renderApp", () => {
  it("is the shared App render entry for mock mode", () => {
    const userState = { ...createPrototypeState(), activeRoleId: "user" as const };
    renderApp({ path: "/parameter-home", initialAppState: userState });

    expect(window.location.pathname).toBe("/parameter-home");
    expect(document.querySelector(".app-shell, .topbar, main")).not.toBeNull();
  });

  it("assembles mock adapters in API mode so unspecified ports are not HTTP clients", async () => {
    const { ports } = renderApp({
      path: "/parameter-home",
      runtimeMode: "api",
      ports: { authClient: createTestAuthClient("admin") }
    });

    expect(ports).toBeDefined();
    await expect(ports!.parameterRepository.listProjects()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })])
    );
  });
});
