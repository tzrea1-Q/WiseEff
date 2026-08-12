import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import { resolveParameterInitializationRepository } from "@/application/parameters/parameterInitializationRuntime";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import type { PrototypeState } from "@/domain/prototype/types";
import {
  createAuthClient,
  type AuthContextDto,
  type AuthSessionDto,
  type LoginLocalAccountInput,
  type RegisterLocalAccountInput,
  type RegisterLocalAccountResponseDto,
  type UpdateCurrentUserProfileInput
} from "@/infrastructure/http/authClient";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import { createHttpDebuggingGateway } from "@/infrastructure/http/debuggingClient";
import { createHttpDtsReloadRepository } from "@/infrastructure/http/dtsReloadClient";
import { createHttpKnowledgeRepository } from "@/infrastructure/http/knowledgeClient";
import { createHttpLogAnalysisRepository } from "@/infrastructure/http/logClient";
import { createHttpParameterRepository } from "@/infrastructure/http/parameterClient";
import { createHttpParameterDashboardRepository } from "@/infrastructure/http/parameterDashboardClient";
import { createHttpProductFeedbackRepository } from "@/infrastructure/http/productFeedbackClient";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { createMockParameterDashboardRepository } from "@/infrastructure/mock/mockParameterDashboardRepository";
import { createMockParameterRepository } from "@/infrastructure/mock/mockParameterRepository";
import { createMockProductFeedbackRepository } from "@/infrastructure/mock/mockProductFeedbackRepository";
import type { MockRuntimeState } from "@/infrastructure/mock/mockState";
import type { UserGovernanceActions } from "@/UserPermissionsPage";

export type WiseEffAuthClient = {
  getCurrentAuthContext(): Promise<AuthContextDto>;
  register?(input: RegisterLocalAccountInput): Promise<RegisterLocalAccountResponseDto>;
  login?(input: LoginLocalAccountInput): Promise<AuthSessionDto>;
  logout?(): Promise<void>;
  updateCurrentUserProfile?(input: UpdateCurrentUserProfileInput): Promise<AuthContextDto>;
};

/**
 * Every adapter the app shell wires at startup, selected once per runtime
 * mode. Pages receive this record through PageProps.runtime instead of one
 * prop per port (ADR-0023 companion seam; plan 2026-08-12-app-shell-decomposition Wave 3).
 */
export type AppRuntime = {
  authClient: WiseEffAuthClient;
  parameterRepository: ParameterRepository;
  parameterTopologyRepository: ParameterTopologyRepository;
  parameterDashboardRepository: ParameterDashboardRepository;
  logAnalysisRepository?: LogAnalysisRepository;
  productFeedbackRepository: ProductFeedbackRepository;
  knowledgeRepository: KnowledgeRepository;
  dtsReloadRepository: DtsReloadRepository | null;
  parameterInitializationRepository: ParameterInitializationRepository;
  debuggingGateway?: DebuggingGateway;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  userGovernanceActions?: UserGovernanceActions;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
};

export type AppRuntimeDeps = {
  /** Live prototype-state accessor for mock adapters that read app state. */
  getState: () => PrototypeState;
  /** Mutable state handle the mock parameter repository writes through. */
  mockParameterRuntime: MockRuntimeState;
};

export function createAppRuntime(
  mode: WiseEffRuntimeMode,
  deps: AppRuntimeDeps,
  overrides: Partial<AppRuntime> = {}
): AppRuntime {
  const api = mode === "api";
  return {
    authClient: overrides.authClient ?? createAuthClient(),
    parameterRepository:
      overrides.parameterRepository ??
      (api ? createHttpParameterRepository() : createMockParameterRepository(deps.mockParameterRuntime)),
    parameterTopologyRepository: overrides.parameterTopologyRepository ?? resolveParameterTopologyRepository(mode),
    parameterDashboardRepository:
      overrides.parameterDashboardRepository ??
      (api ? createHttpParameterDashboardRepository() : createMockParameterDashboardRepository(deps.getState)),
    logAnalysisRepository: overrides.logAnalysisRepository ?? (api ? createHttpLogAnalysisRepository() : undefined),
    productFeedbackRepository:
      overrides.productFeedbackRepository ??
      (api ? createHttpProductFeedbackRepository() : createMockProductFeedbackRepository()),
    knowledgeRepository:
      overrides.knowledgeRepository ?? (api ? createHttpKnowledgeRepository() : createMockKnowledgeRepository()),
    dtsReloadRepository:
      overrides.dtsReloadRepository !== undefined
        ? overrides.dtsReloadRepository
        : api
          ? createHttpDtsReloadRepository()
          : null,
    parameterInitializationRepository:
      overrides.parameterInitializationRepository ?? resolveParameterInitializationRepository(mode),
    debuggingGateway: overrides.debuggingGateway ?? (api ? createHttpDebuggingGateway() : undefined),
    debuggingAdminClient: overrides.debuggingAdminClient ?? (api ? createDebuggingAdminClient() : undefined),
    userGovernanceActions: overrides.userGovernanceActions ?? (api ? createUserGovernanceClient() : undefined),
    listParameterConfigSets: overrides.listParameterConfigSets
  };
}
