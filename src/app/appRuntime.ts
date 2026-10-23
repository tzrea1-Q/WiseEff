import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import {
  createApiCatalogPorts,
  createMockCatalogPorts
} from "@/application/parameter-catalog";
import { catalogActorForRole } from "@/application/parameter-catalog/authority";
import { CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { resolveDebuggingGateway } from "@/application/debugging/debuggingGatewayRuntime";
import { resolveDtsReloadRepository } from "@/application/dts-reload/dtsReloadRuntime";
import { resolveParameterInitializationRepository } from "@/application/parameters/parameterInitializationRuntime";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import type { PrototypeState } from "@/domain/prototype/types";
import {
  createAuthClient,
  readLocalAuthToken,
  type AuthContextDto,
  type AuthSessionDto,
  type ChangeCurrentUserPasswordInput,
  type LocalAuthPublicConfigDto,
  type LoginLocalAccountInput,
  type RegisterLocalAccountInput,
  type RegisterLocalAccountResponseDto,
  type UpdateCurrentUserProfileInput
} from "@/infrastructure/http/authClient";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import { createHttpKnowledgeRepository } from "@/infrastructure/http/knowledgeClient";
import { createHttpLogAnalysisRepository } from "@/infrastructure/http/logClient";
import { createHttpParameterRepository } from "@/infrastructure/http/parameterClient";
import { createHttpParameterDashboardRepository } from "@/infrastructure/http/parameterDashboardClient";
import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";
import { createHttpProductFeedbackRepository } from "@/infrastructure/http/productFeedbackClient";
import { createOrganizationWorkspaceClient, createUserGovernanceClient, type OrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { createWorkflowPublicationClient, type WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import { createPlatformOrganizationsClient, type PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";
import { createMockWorkflowPublicationClient } from "@/infrastructure/mock/mockWorkflowPublicationClient";
import { createMockOrganizationActions } from "@/infrastructure/mock/mockOrganizationActions";
import type { OrganizationActions } from "@/OrganizationPage";
import { resolveWiseEffApiBaseUrl, wiseEffApiAuthorization, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { createMockParameterDashboardRepository } from "@/infrastructure/mock/mockParameterDashboardRepository";
import { createMockParameterRepository } from "@/infrastructure/mock/mockParameterRepository";
import { createMockProductFeedbackRepository } from "@/infrastructure/mock/mockProductFeedbackRepository";
import type { MockRuntimeState } from "@/infrastructure/mock/mockState";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { createDefaultApiClient } from "@/infrastructure/http/defaultApiClient";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import { createParameterFileClient } from "@/infrastructure/http/parameterFileClient";
import { createHttpParameterTopologyRepository } from "@/infrastructure/http/parameterTopologyClient";
import { createHttpParameterInitializationRepository } from "@/infrastructure/http/parameterInitializationClient";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { createDtsStructuredClient } from "@/infrastructure/http/dtsStructuredClient";

export type WiseEffAuthClient = {
  getCurrentAuthContext(): Promise<AuthContextDto>;
  getLocalAuthConfig?(): Promise<LocalAuthPublicConfigDto>;
  register?(input: RegisterLocalAccountInput): Promise<RegisterLocalAccountResponseDto>;
  login?(input: LoginLocalAccountInput): Promise<AuthSessionDto>;
  logout?(): Promise<void>;
  updateCurrentUserProfile?(input: UpdateCurrentUserProfileInput): Promise<AuthContextDto>;
  changePassword?(input: ChangeCurrentUserPasswordInput): Promise<{ ok: true }>;
};

/**
 * Every adapter the app shell wires at startup, selected once per runtime
 * mode. Pages receive this record through PageProps.runtime instead of one
 * prop per port (ADR-0023 companion seam; plan 2026-08-12-app-shell-decomposition Wave 3).
 */
export type AppRuntime = {
  parameterApiClient?: ApiClient;
  parameterAdminClient?: ReturnType<typeof createParameterAdminClient>;
  parameterFileRepository?: ParameterFileRepository;
  operatingOrganizationId?: string;
  authClient: WiseEffAuthClient;
  workflowPublicationClient?: WorkflowPublicationClient;
  platformOrganizationsClient?: PlatformOrganizationsClient;
  parameterRepository: ParameterRepository;
  parameterTopologyRepository: ParameterTopologyRepository;
  parameterCatalogRepository: ParameterCatalogRepository;
  parameterCatalogGovernanceRepository: ParameterCatalogGovernanceRepository;
  parameterDashboardRepository: ParameterDashboardRepository;
  logAnalysisRepository?: LogAnalysisRepository;
  productFeedbackRepository: ProductFeedbackRepository;
  knowledgeRepository: KnowledgeRepository;
  dtsReloadRepository: DtsReloadRepository;
  parameterInitializationRepository: ParameterInitializationRepository;
  debuggingGateway: DebuggingGateway;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  userGovernanceActions?: UserGovernanceActions;
  organizationWorkspaceClient?: OrganizationWorkspaceClient;
  organizationActions?: OrganizationActions;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
};

export type AppRuntimeDeps = {
  organizationId?: string;
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
  const parameterApiClient = api ? createDefaultApiClient({ organizationId: deps.organizationId }) : undefined;
  // Resolved before the knowledge repository: mock distillation reads reload
  // runs from THIS instance so both ports describe the same device story.
  const dtsReloadRepository = overrides.dtsReloadRepository ?? resolveDtsReloadRepository(mode);
  const catalogPorts =
    overrides.parameterCatalogRepository && overrides.parameterCatalogGovernanceRepository
      ? {
          catalog: overrides.parameterCatalogRepository,
          governance: overrides.parameterCatalogGovernanceRepository
        }
      : api
        ? createApiCatalogPorts(
            createParameterCatalogClient({
              baseUrl: resolveWiseEffApiBaseUrl(),
              organizationId: deps.organizationId,
              getAuthorization: async () => {
                const localToken = readLocalAuthToken();
                return localToken ? `Bearer ${localToken}` : wiseEffApiAuthorization;
              }
            })
          )
        : createMockCatalogPorts({ getSession: () => {
            const state = deps.getState();
            const user = state.users.find((candidate) => candidate.id === state.currentUserId);
            return { personId: user?.id ?? "", organizationId: CATALOG_ORGANIZATION_ID, actorKind: catalogActorForRole(user?.roleId ?? ""), isActive: user?.isActive ?? false };
          } });
  return {
    parameterApiClient: overrides.parameterApiClient ?? parameterApiClient,
    parameterAdminClient: overrides.parameterAdminClient ?? (api ? createParameterAdminClient(parameterApiClient) : undefined),
    parameterFileRepository: overrides.parameterFileRepository ?? (api ? createParameterFileClient(parameterApiClient) : undefined),
    operatingOrganizationId: deps.organizationId,
    authClient: overrides.authClient ?? createAuthClient(),
    workflowPublicationClient: overrides.workflowPublicationClient ?? (api ? createWorkflowPublicationClient() : createMockWorkflowPublicationClient()),
    platformOrganizationsClient: overrides.platformOrganizationsClient ?? (api ? createPlatformOrganizationsClient() : undefined),
    parameterRepository:
      overrides.parameterRepository ??
      (api ? createHttpParameterRepository(parameterApiClient) : createMockParameterRepository(deps.mockParameterRuntime)),
    parameterTopologyRepository: overrides.parameterTopologyRepository ?? (api ? createHttpParameterTopologyRepository(parameterApiClient) : resolveParameterTopologyRepository(mode)),
    parameterCatalogRepository: overrides.parameterCatalogRepository ?? catalogPorts.catalog,
    parameterCatalogGovernanceRepository:
      overrides.parameterCatalogGovernanceRepository ?? catalogPorts.governance,
    parameterDashboardRepository:
      overrides.parameterDashboardRepository ??
      (api ? createHttpParameterDashboardRepository(parameterApiClient) : createMockParameterDashboardRepository(deps.getState)),
    logAnalysisRepository: overrides.logAnalysisRepository ?? (api ? createHttpLogAnalysisRepository({ organizationId: deps.organizationId }) : undefined),
    productFeedbackRepository:
      overrides.productFeedbackRepository ??
      (api ? createHttpProductFeedbackRepository() : createMockProductFeedbackRepository()),
    knowledgeRepository:
      overrides.knowledgeRepository ??
      (api
        ? createHttpKnowledgeRepository({ organizationId: deps.organizationId })
        : createMockKnowledgeRepository({
            // Mock distillation reads the prototype log records (same port shape as API mode).
            getLogRecord: (logId) => deps.getState().logs.find((log) => log.id === logId),
            // Reload-run distillation reads the runtime's mock reload repository.
            getReloadRun: (runId) => dtsReloadRepository.getRun(runId).catch(() => undefined)
          })),
    dtsReloadRepository,
    parameterInitializationRepository:
      overrides.parameterInitializationRepository ?? (api ? createHttpParameterInitializationRepository(parameterApiClient) : resolveParameterInitializationRepository(mode)),
    debuggingGateway:
      overrides.debuggingGateway ??
      resolveDebuggingGateway({ mode, getDebugParameters: () => deps.getState().debugParameters }),
    debuggingAdminClient: overrides.debuggingAdminClient ?? (api ? createDebuggingAdminClient() : undefined),
    userGovernanceActions: overrides.userGovernanceActions ?? (api ? createUserGovernanceClient() : undefined),
    organizationWorkspaceClient: overrides.organizationWorkspaceClient ?? (api && !overrides.userGovernanceActions ? createOrganizationWorkspaceClient() : undefined),
    organizationActions:
      overrides.organizationActions ??
      (overrides.userGovernanceActions?.getOrganization && overrides.userGovernanceActions.updateOrganization
        ? {
            getOrganization: overrides.userGovernanceActions.getOrganization,
            updateOrganization: overrides.userGovernanceActions.updateOrganization
          }
        : api
          ? createUserGovernanceClient()
          : createMockOrganizationActions()),
    listParameterConfigSets: overrides.listParameterConfigSets ?? (api ? createDtsStructuredClient(parameterApiClient).listConfigSets : undefined)
  };
}
