import { vi } from "vitest";

import { createAppRuntime, type AppRuntime } from "@/app/appRuntime";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { PrototypeState } from "@/domain/prototype/types";
import { createMockDebuggingGateway } from "@/infrastructure/mock/mockDebuggingGateway";
import { createMockParameterModuleRegistryRepository } from "@/infrastructure/mock/mockParameterModuleRegistryRepository";
import { createMockParameterRepository } from "@/infrastructure/mock/mockParameterRepository";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import { createMockRuntimeState } from "@/infrastructure/mock/mockState";
import { createPrototypeState } from "@/infrastructure/mock/prototypeState";
import type { UserGovernanceActions } from "@/UserPermissionsPage";

import { createTestAuthClient } from "./createTestAuthClient";
import { createTestLogAnalysisRepository } from "./createTestLogAnalysisRepository";
import { withPortSpies } from "./withPortSpies";

export type CreateTestAppPortsOptions = {
  initialState?: PrototypeState;
  /** Replace individual App ports after the mock-adapter assembly. */
  overrides?: Partial<AppRuntime>;
};

export type TestAppPorts = AppRuntime;

function pickPort<K extends keyof AppRuntime>(
  assembled: AppRuntime,
  overrides: Partial<AppRuntime>,
  key: K
): AppRuntime[K] {
  if (Object.prototype.hasOwnProperty.call(overrides, key) && overrides[key] !== undefined) {
    return overrides[key] as AppRuntime[K];
  }
  const value = assembled[key];
  if (value && typeof value === "object" && typeof value !== "function") {
    return withPortSpies(value) as AppRuntime[K];
  }
  return value;
}

/**
 * Assemble App ports from ADR-0002 mock adapters, with per-port overrides.
 *
 * Always uses in-memory adapters (never HTTP) so page tests can inject a
 * subset of ports without the rest of the shell probing the network.
 * `runtimeMode` on `renderApp` / `<App>` still controls auth boot and
 * hydration UI independently of these data sources.
 */
export function createTestAppPorts(options: CreateTestAppPortsOptions = {}): TestAppPorts {
  const initialState = options.initialState ?? createPrototypeState();
  const overrides = options.overrides ?? {};
  const mockParameterRuntime = createMockRuntimeState(initialState);
  const getState = () => mockParameterRuntime.current;

  const assembled = createAppRuntime(
    "mock",
    { getState, mockParameterRuntime },
    {
      authClient: createTestAuthClient("user"),
      logAnalysisRepository: createTestLogAnalysisRepository([]),
      listParameterConfigSets: createTestConfigSetList(),
      ...overrides
    }
  );

  return {
    authClient: pickPort(assembled, overrides, "authClient"),
    parameterRepository: pickPort(assembled, overrides, "parameterRepository"),
    parameterTopologyRepository: pickPort(assembled, overrides, "parameterTopologyRepository"),
    parameterDashboardRepository: pickPort(assembled, overrides, "parameterDashboardRepository"),
    logAnalysisRepository: pickPort(assembled, overrides, "logAnalysisRepository"),
    productFeedbackRepository: pickPort(assembled, overrides, "productFeedbackRepository"),
    knowledgeRepository: pickPort(assembled, overrides, "knowledgeRepository"),
    dtsReloadRepository: pickPort(assembled, overrides, "dtsReloadRepository"),
    parameterInitializationRepository: pickPort(assembled, overrides, "parameterInitializationRepository"),
    debuggingGateway: pickPort(assembled, overrides, "debuggingGateway"),
    debuggingAdminClient: pickPort(assembled, overrides, "debuggingAdminClient"),
    userGovernanceActions: pickPort(assembled, overrides, "userGovernanceActions"),
    organizationActions: pickPort(assembled, overrides, "organizationActions"),
    listParameterConfigSets: pickPort(assembled, overrides, "listParameterConfigSets")
  };
}

export function createTestConfigSetList() {
  return vi.fn().mockResolvedValue([{ id: "config-set-teaching", name: "default" }]);
}

export function createTestParameterRepository(
  overrides: Partial<ParameterRepository> = {},
  initialState: PrototypeState = createPrototypeState()
): ParameterRepository {
  return withPortSpies(createMockParameterRepository(createMockRuntimeState(initialState)), overrides);
}

export function createTestParameterTopologyRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return withPortSpies(createMockParameterTopologyRepository(), overrides);
}

export function createTestModuleRegistryRepository(
  overrides: Partial<ParameterModuleRegistryRepository> = {}
): ParameterModuleRegistryRepository {
  return withPortSpies(createMockParameterModuleRegistryRepository(), overrides);
}

export function createTestDebuggingGateway(
  overrides: Partial<DebuggingGateway> = {}
): DebuggingGateway {
  return withPortSpies(createMockDebuggingGateway(), overrides);
}

export function createTestUserGovernanceActions(
  overrides: Partial<UserGovernanceActions> = {},
  users: PrototypeState["users"] = createPrototypeState().users
): UserGovernanceActions {
  return {
    listUsers: vi.fn().mockResolvedValue(users),
    createUser: vi.fn().mockResolvedValue(undefined),
    assignUserRole: vi.fn().mockResolvedValue(undefined),
    setUserActive: vi.fn().mockResolvedValue(undefined),
    resetUserPassword: vi.fn().mockResolvedValue(undefined),
    getOrganization: vi.fn().mockResolvedValue({
      id: "org-chargelab",
      name: "ChargeLab",
      createdAt: "2026-01-15T00:00:00.000Z"
    }),
    updateOrganization: vi.fn().mockImplementation(async (input: { name: string }) => ({
      id: "org-chargelab",
      name: input.name,
      createdAt: "2026-01-15T00:00:00.000Z"
    })),
    ...overrides
  };
}
