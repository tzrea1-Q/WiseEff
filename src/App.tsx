import {
  AlertTriangle,
  ChevronDown,
  FileText,
  LoaderCircle,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound
} from "lucide-react";
import { AppShellConnectionError } from "@/components/common/AppShellConnectionError";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { AppShellSkeleton } from "@/components/common/AppShellSkeleton";
import { AppFooter } from "@/components/common/AppFooter";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { TopBarNotifications } from "./components/notifications/TopBarNotifications";
import { createStateBackedNotificationsClient } from "@/infrastructure/mock/mockNotificationsGateway";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { WiseEffIcon } from "./components/WiseEffIcon";
import { ProjectParameterInitializationWizard } from "./ProjectParameterInitializationWizard";
import { PageRouter, type PageProps } from "@/app/routes";
import { DebuggingAdminPage } from "@/DebuggingAdminPage";
import {
  createDebuggingRuntimeActions,
  type DebuggingRuntimeActions
} from "@/application/debugging/debuggingRuntime";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import {
  createLogRuntimeActions,
  type LogRuntimeActions
} from "@/application/logs/logRuntime";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import {
  createParameterRuntimeActions,
  type ParameterRuntimeActions
} from "@/application/parameters/parameterRuntime";
import {
  dashboardReducer,
  initialDashboardState
} from "@/application/parameters/dashboardState";
import { createParameterDashboardRuntime } from "@/application/parameters/parameterDashboardRuntime";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import {
  toLegacyInitializationDraft,
  toLegacyInitializationReview
} from "@/application/parameters/initializationUiMappers";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import { canAccessPage, canPerform, getRequiredRoleLabel } from "@/app/permissions";
import type {
  ProjectInitializationStatus,
  ProjectParameterInitializationDraft
} from "@/domain/parameters/types";
import {
  migrateLegacyRoleId,
  pickPrimaryPlatformRoleId,
  platformRoles,
  type PlatformRoleId
} from "@/domain/users/types";
import { XiaozePageContext, XiaozePageContextRegistrar } from "@/features/agent/useXiaozePageContext";
import { XiaozeProvider, XiaozeProactiveInsights } from "@/features/agent/XiaozeProvider";
import { OrganizationBusinessWorkspace } from "@/features/organization/OrganizationBusinessWorkspace";
import { InvitationAcceptancePage } from "@/features/organization/InvitationAcceptancePage";
import { isOrganizationBusinessPath, withBusinessOrganizationScope } from "@/infrastructure/http/organizationScope";
import { supportsXiaozeProactiveInsights } from "@/features/agent/xiaozeProactiveInsights";
import { FeedbackDialog } from "@/features/product-feedback/FeedbackDialog";
import { xiaozeProactiveEnabled } from "@/infrastructure/http/runtimeMode";
import { getPageByPath, getXiaozeContextSummary, navigationItems, pageUsesProjectScope, PageConfig, utilityItems } from "./appConfig";
import { isDiscoveryGroupVisible, workflowForGroup, WORKFLOW_IDS, type WorkflowId } from "@/domain/workflowDiscovery";
import { useWorkflowPublication } from "@/application/workflow-publication/useWorkflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import { INITIAL_MOCK_WORKFLOW_PUBLICATION } from "@/infrastructure/mock/mockWorkflowPublicationClient";
import { createApiInitialState } from "@/application/state/apiInitialState";
import { reducer, type AppAction, type ApiRuntimeDataDomain } from "@/application/state/appState";
import { createAppRuntime, type AppRuntime, type WiseEffAuthClient } from "@/app/appRuntime";
import { createAuthClient } from "@/infrastructure/http/authClient";
import { CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { appFooterConfig } from "@/config/appFooterConfig";
import { isProjectConfigurationWorkbenchPath } from "@/application/project-configuration/workbenchPath";

function isStaticDownloadPath(pathname: string) {
  return pathname.startsWith("/downloads/");
}
import { TopBarActionsContext, SkipLink, MAIN_CONTENT_ID } from "./components/layout";
import { readInitialNodeDebuggingProtocol } from "./NodeDebuggingPage";
import { initialState, mockDataFingerprint } from "@/infrastructure/mock/prototypeState";
import {
  type PrototypeState,
  type User
} from "@/domain/prototype/types";
import { Button } from "@/components/ui/button";
import { Popover } from "radix-ui";
import { SelectControl } from "@/components/common/SelectControl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clearLocalAuthToken,
  type AuthContextDto,
  type AuthSessionDto,
  type ChangeCurrentUserPasswordInput,
  type LocalAuthPublicConfigDto,
  type PendingRegistrationDto,
  type RegisterLocalAccountResponseDto,
  type UpdateCurrentUserProfileInput
} from "@/infrastructure/http/authClient";
import { clearSessionDraftsForLogout } from "@/application/project-configuration/sessionDraftStorage";
import { AppToastLayer } from "@/components/common/AppToastLayer";
import { unsavedParameterWorkCount } from "@/application/parameters/unsavedParameterWork";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockRuntimeState, type MockRuntimeState } from "@/infrastructure/mock/mockState";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { presentError } from "@/infrastructure/http/presentError";
import { wiseEffRuntimeMode, xiaozeInspectorEnabled, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { UserGovernanceActions } from "@/UserPermissionsPage";

/**
 * `unreachable` means the `/api/v1/me` probe failed before an auth rejection
 * (service down / offline / restart): the session may still be valid, so the
 * shell shows a retry state instead of dropping the user to the login form
 * (FA-21).
 */
type ApiAuthStatus = "checking" | "authenticated" | "unauthenticated" | "unreachable";

function isPendingRegistrationResponse(response: RegisterLocalAccountResponseDto): response is PendingRegistrationDto {
  return "status" in response && response.status === "pending_approval";
}

function authProbeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // Expected "not signed in yet" probe outcomes stay silent; anything else
  // (network failure, server error) surfaces as product copy on the login form.
  if (["Authorization bearer token is required.", "Session is not active.", "User is not authenticated.", ""].includes(message)) {
    return "";
  }
  return presentError(error, "无法验证登录状态，请稍后重试。");
}

/**
 * Only an explicit backend rejection (401/403 -> UNAUTHENTICATED/FORBIDDEN)
 * should end the local session. Network failures, timeouts, and 5xx responses
 * mean the backend is unreachable, so the token must survive the outage.
 */
function isAuthRejectionError(error: unknown) {
  return error instanceof WiseEffApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN");
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "wiseeff.sidebar.collapsed";
const selfRegistrationRoleIds = new Set<PlatformRoleId>([
  "guest",
  "hardware-user",
  "software-user",
  "hardware-committer",
  "software-committer"
]);

function readSidebarCollapsedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsedPreference(isCollapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
  } catch {
    // Keep the toggle usable when storage is unavailable.
  }
}

function userAccountIdentifier(user: User) {
  return user.username ?? user.email ?? "No account identifier";
}

type AppProps = {
  authClient?: WiseEffAuthClient;
  workflowPublicationClient?: WorkflowPublicationClient;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  debuggingGateway?: DebuggingGateway;
  initialAppState?: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  parameterRepository?: ParameterRepository;
  parameterTopologyRepository?: ParameterTopologyRepository;
  parameterCatalogRepository?: AppRuntime["parameterCatalogRepository"];
  parameterCatalogGovernanceRepository?: AppRuntime["parameterCatalogGovernanceRepository"];
  parameterInitializationRepository?: ParameterInitializationRepository;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  productFeedbackRepository?: ProductFeedbackRepository;
  knowledgeRepository?: KnowledgeRepository;
  dtsReloadRepository?: DtsReloadRepository;
  runtimeMode?: WiseEffRuntimeMode;
  userGovernanceActions?: UserGovernanceActions;
};

function App({
  authClient,
  workflowPublicationClient,
  debuggingAdminClient,
  debuggingGateway,
  initialAppState,
  logAnalysisRepository,
  listParameterConfigSets,
  parameterRepository,
  parameterTopologyRepository,
  parameterCatalogRepository,
  parameterCatalogGovernanceRepository,
  parameterInitializationRepository,
  productFeedbackRepository,
  knowledgeRepository,
  dtsReloadRepository,
  runtimeMode = wiseEffRuntimeMode,
  userGovernanceActions
}: AppProps = {}) {
  // API mode boots from empty business slices (no demo data flash); mock mode
  // keeps the full prototype state for demos and component tests.
  const [resolvedInitialAppState] = useState(
    () => initialAppState ?? (runtimeMode === "api" ? createApiInitialState() : initialState)
  );
  return (
    <TooltipProvider delayDuration={0}>
      <ToastProvider>
        {runtimeMode === "api" && window.location.pathname === "/invite" ? <InvitationAcceptancePage /> : <AppShell
          authClient={authClient}
          workflowPublicationClient={workflowPublicationClient}
          debuggingAdminClient={debuggingAdminClient}
          debuggingGateway={debuggingGateway}
          initialAppState={resolvedInitialAppState}
          key={mockDataFingerprint}
          logAnalysisRepository={logAnalysisRepository}
          listParameterConfigSets={listParameterConfigSets}
          parameterRepository={parameterRepository}
          parameterTopologyRepository={parameterTopologyRepository}
          parameterCatalogRepository={parameterCatalogRepository}
          parameterCatalogGovernanceRepository={parameterCatalogGovernanceRepository}
          parameterInitializationRepository={parameterInitializationRepository}
          productFeedbackRepository={productFeedbackRepository}
          knowledgeRepository={knowledgeRepository}
          dtsReloadRepository={dtsReloadRepository}
          runtimeMode={runtimeMode}
          userGovernanceActions={userGovernanceActions}
        />}
      </ToastProvider>
    </TooltipProvider>
  );
}

function AppShell({
  authClient,
  workflowPublicationClient,
  debuggingAdminClient,
  debuggingGateway,
  initialAppState,
  logAnalysisRepository,
  listParameterConfigSets,
  parameterRepository,
  parameterTopologyRepository,
  parameterCatalogRepository,
  parameterCatalogGovernanceRepository,
  parameterInitializationRepository,
  productFeedbackRepository,
  knowledgeRepository,
  dtsReloadRepository,
  runtimeMode,
  userGovernanceActions
}: {
  authClient?: WiseEffAuthClient;
  workflowPublicationClient?: WorkflowPublicationClient;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  debuggingGateway?: DebuggingGateway;
  initialAppState: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  parameterRepository?: ParameterRepository;
  parameterTopologyRepository?: ParameterTopologyRepository;
  parameterCatalogRepository?: AppRuntime["parameterCatalogRepository"];
  parameterCatalogGovernanceRepository?: AppRuntime["parameterCatalogGovernanceRepository"];
  parameterInitializationRepository?: ParameterInitializationRepository;
  productFeedbackRepository?: ProductFeedbackRepository;
  knowledgeRepository?: KnowledgeRepository;
  dtsReloadRepository?: DtsReloadRepository;
  runtimeMode: WiseEffRuntimeMode;
  userGovernanceActions?: UserGovernanceActions;
}) {
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const stateRef = useRef(state);
  const [path, setPath] = useState(() => getPageByPath(window.location.pathname).path);
  const [search, setSearch] = useState(() => window.location.pathname === "/log-dashboard" ? "" : window.location.search);
  const operatingOrganizationId = new URLSearchParams(search).get("organizationId") ?? undefined;
  const scopeKey = `${state.currentUserId}:${operatingOrganizationId ?? "home"}`;
  const scopeRef = useRef({ key: scopeKey, generation: 0 });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1 };
  const scopeGeneration = scopeRef.current.generation;
  const historyIndex = useRef(0);
  const navigationRequest = useRef(0);
  const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
  const [topBarLeadingActions, setTopBarLeadingActions] = useState<ReactNode | null>(null);
  const [projectInitOpen, setProjectInitOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [apiAuthStatus, setApiAuthStatus] = useState<ApiAuthStatus>(runtimeMode === "api" ? "checking" : "authenticated");
  const [apiAuthError, setApiAuthError] = useState("");
  const [authProbeAttempt, setAuthProbeAttempt] = useState(0);
  const [apiAuthPermissions, setApiAuthPermissions] = useState<string[]>([]);
  const [apiAuthRoles, setApiAuthRoles] = useState<AuthContextDto["roles"] | null>(null);
  const [apiProjectMemberships, setApiProjectMemberships] = useState<AuthContextDto["projectMemberships"]>([]);
  const [homeOrganizationSuspended, setHomeOrganizationSuspended] = useState(false);
  const [organizationId, setOrganizationId] = useState(
    () => (runtimeMode === "api" ? "" : CATALOG_ORGANIZATION_ID)
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  // Below 768px the sidebar becomes an overlay drawer (ui-design-system §Layout);
  // between 769–900px it stays the auto-collapsed rail the media query used to force.
  const isMobileNavViewport = useMediaQuery("(max-width: 768px)");
  const isTabletRailViewport = useMediaQuery("(min-width: 769px) and (max-width: 900px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const effectiveSidebarCollapsed = !isMobileNavViewport && (sidebarCollapsed || isTabletRailViewport);
  const page = getPageByPath(path);
  const showHomeOrganizationSuspended = homeOrganizationSuspended && page.key !== "user-permissions" && page.key !== "platform-organizations";
  const pageKeyRef = useRef(page.key);
  const xiaozeContextSummary = useMemo(() => getXiaozeContextSummary(path), [path]);
  const topBarActionsContextValue = useMemo(
    () => ({ setActions: setTopBarActions, setLeadingActions: setTopBarLeadingActions }),
    []
  );
  const isPlatformHome = page.key === "home";
  const isParameterHome = page.key === "parameter-home";
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const showsApplicationFooter = !isProjectConfigurationWorkbenchPath(path)
    && page.key !== "parameter-review" && page.key !== "parameter-submissions";
  const usesProjectScope = pageUsesProjectScope(page.key);
  const xiaozePageContext = useMemo(
    () => ({
      path,
      pageKey: page.key,
      ...(usesProjectScope
        ? {
            projectId: state.activeProjectId,
            projectName: state.configDraft.projects.find((project) => project.id === state.activeProjectId)?.name
          }
        : {}),
      roleId: currentRoleId
    }),
    [path, page.key, usesProjectScope, state.activeProjectId, state.configDraft.projects, currentRoleId]
  );
  const mockParameterRuntimeRef = useRef<MockRuntimeState | null>(null);
  if (mockParameterRuntimeRef.current === null) {
    mockParameterRuntimeRef.current = createMockRuntimeState(state);
  } else {
    mockParameterRuntimeRef.current.current = state;
  }
  const homeAuthClient = useMemo(() => authClient ?? createAuthClient(), [authClient]);
  const appRuntime = useMemo(
    () =>
      createAppRuntime(
        runtimeMode,
        { getState: () => stateRef.current, mockParameterRuntime: mockParameterRuntimeRef.current!, organizationId: operatingOrganizationId },
        {
          authClient: homeAuthClient,
          workflowPublicationClient,
          parameterRepository,
          parameterTopologyRepository,
          parameterCatalogRepository,
          parameterCatalogGovernanceRepository,
          logAnalysisRepository,
          productFeedbackRepository,
          knowledgeRepository,
          dtsReloadRepository,
          parameterInitializationRepository,
          debuggingGateway,
          debuggingAdminClient,
          userGovernanceActions,
          listParameterConfigSets
        }
      ),
    [
      runtimeMode,
      operatingOrganizationId,
      state.currentUserId,
      homeAuthClient,
      workflowPublicationClient,
      parameterRepository,
      parameterTopologyRepository,
      parameterCatalogRepository,
      parameterCatalogGovernanceRepository,
      logAnalysisRepository,
      productFeedbackRepository,
      knowledgeRepository,
      dtsReloadRepository,
      parameterInitializationRepository,
      debuggingGateway,
      debuggingAdminClient,
      userGovernanceActions,
      listParameterConfigSets
    ]
  );
  const {
    parameterRepository: parameterRepositoryClient,
    parameterDashboardRepository: dashboardRepository,
    logAnalysisRepository: logAnalysisRepositoryClient,
    productFeedbackRepository: productFeedbackRepositoryClient,
    dtsReloadRepository: dtsReloadRepositoryClient,
    parameterInitializationRepository: parameterInitializationRepositoryClient,
    debuggingGateway: debuggingGatewayClient,
    debuggingAdminClient: debuggingAdminCatalogClient
  } = appRuntime;
  const publication = useWorkflowPublication(
    appRuntime.workflowPublicationClient,
    apiAuthStatus === "authenticated" ? `${state.currentUserId}:${organizationId}:${path}` : null,
    runtimeMode === "mock" && !workflowPublicationClient ? INITIAL_MOCK_WORKFLOW_PUBLICATION : undefined
  );
  const isPublicationAdministrator = runtimeMode === "api"
    ? Boolean(apiAuthRoles?.some((role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin")))
    : currentRoleId === "admin" || currentRoleId === "platform-admin";
  const canManagePublication = runtimeMode === "api"
    ? Boolean(apiAuthRoles?.some((role) => role.projectId === null && role.roleId === "platform-admin"))
    : currentRoleId === "platform-admin";
  const visibleWorkflows = WORKFLOW_IDS.filter((id) =>
    (isPublicationAdministrator || publication.status === "ready" && publication.publication?.workflows[id] === true) &&
    navigationItems.some((item) => workflowForGroup(item.group) === id && canAccessPage(currentRoleId, item.key))
  );
  const currentWorkflow = workflowForGroup(page.group);
  const canEnterPublishedPage = currentWorkflow === null || isPublicationAdministrator ||
    publication.status === "ready" && publication.publication?.workflows[currentWorkflow] === true;
  const canAccessCurrentPage = (canAccessPage(currentRoleId, page.key) || runtimeMode === "api" && page.key === "parameter-submissions" && Boolean(apiProjectMemberships?.length)) && canEnterPublishedPage &&
    ((page.key !== "workflow-publication" && page.key !== "platform-organizations") || canManagePublication);
  const [dashboardState, dashboardDispatch] = useReducer(dashboardReducer, initialDashboardState);
  const dashboardRepositoryRef = useRef(dashboardRepository);
  dashboardRepositoryRef.current = dashboardRepository;
  const dashboardRuntime = useMemo(
    () => createParameterDashboardRuntime({ repository: dashboardRepository,
      dispatch: (action) => { if (scopeRef.current.generation === scopeGeneration && dashboardRepositoryRef.current === dashboardRepository) dashboardDispatch(action); } }),
    [dashboardRepository, scopeGeneration]
  );
  const knowledgeCapability = useMemo<KnowledgeCapability>(
    () => ({
      userId: state.currentUserId,
      // knowledge:view is the member default; mock mode has no narrower gate
      // (the /knowledge page is open to every prototype role).
      canView: runtimeMode === "api" ? apiAuthPermissions.includes("knowledge:view") : true,
      canEdit:
        runtimeMode === "api"
          ? apiAuthPermissions.includes("knowledge:edit")
          : canPerform(currentRoleId, "knowledge.edit"),
      canManage:
        runtimeMode === "api"
          ? apiAuthPermissions.includes("knowledge:manage")
          : canPerform(currentRoleId, "knowledge.manage")
    }),
    [apiAuthPermissions, currentRoleId, runtimeMode, state.currentUserId]
  );
  // Mock mode is a data-source substitution (ADR-0002): the demo account may start runs.
  const canStartDtsReload =
    runtimeMode === "api" ? apiAuthPermissions.includes("debugging:dts-reload") : true;
  const canPromoteDtsReloadDrafts =
    runtimeMode === "api"
      ? apiAuthPermissions.includes("parameter:edit") &&
        (apiAuthPermissions.includes("debugging:dts-reload") || apiAuthPermissions.includes("admin:access"))
      : true;
  const parameterRepositoryRef = useRef(parameterRepositoryClient);
  parameterRepositoryRef.current = parameterRepositoryClient;
  const parameterActions = useMemo<ParameterRuntimeActions>(
    () =>
      createParameterRuntimeActions({
        runtimeMode,
        repository: parameterRepositoryClient,
        canonicalRepository: appRuntime.parameterCatalogRepository,
        dispatch: (action) => { if (scopeRef.current.generation === scopeGeneration && parameterRepositoryRef.current === parameterRepositoryClient) dispatch(action); },
        getParameterProjectId: (parameterId) => stateRef.current.parameters.find((parameter) => parameter.id === parameterId)?.projectId
      }),
    [appRuntime.parameterCatalogRepository, parameterRepositoryClient, runtimeMode, scopeGeneration]
  );
  const logRepositoryRef = useRef(logAnalysisRepositoryClient);
  logRepositoryRef.current = logAnalysisRepositoryClient;
  const logActions = useMemo<LogRuntimeActions>(
    () =>
      createLogRuntimeActions({
        mode: runtimeMode,
        repository: logAnalysisRepositoryClient,
        dispatch: (action) => { if (scopeRef.current.generation === scopeGeneration && logRepositoryRef.current === logAnalysisRepositoryClient) dispatch(action); },
        getState: () => stateRef.current
      }),
    [logAnalysisRepositoryClient, runtimeMode, scopeGeneration]
  );
  const debuggingActions = useMemo<DebuggingRuntimeActions>(
    () =>
      createDebuggingRuntimeActions({
        mode: runtimeMode,
        gateway: debuggingGatewayClient,
        dispatch,
        getState: () => stateRef.current
      }),
    [debuggingGatewayClient, runtimeMode]
  );
  const DebuggingAdminPageWithRuntime = useCallback(
    (props: PageProps & { area?: "parameter" | "nodes" }) => (
      <DebuggingAdminPage
        {...props}
        runtimeMode={runtimeMode}
        debuggingAdminClient={debuggingAdminCatalogClient}
        parameterRepository={parameterRepositoryClient}
        parameterCatalogRepository={appRuntime.parameterCatalogRepository}
        dtsReloadRepository={dtsReloadRepositoryClient}
        apiAuthPermissions={apiAuthPermissions}
      />
    ),
    [apiAuthPermissions, appRuntime.parameterCatalogRepository, debuggingAdminCatalogClient, dtsReloadRepositoryClient, parameterRepositoryClient, runtimeMode]
  );
  const refreshParameterInitializationFromApi = useCallback(async () => {
    if (runtimeMode !== "api" || pageKeyRef.current === "home") {
      return;
    }
    // Admin-only endpoint; non-admins must not probe it (browser diagnostics treat 403 as failure).
    const canListInitReviews =
      apiAuthPermissions.includes("admin:access") || canPerform(migrateLegacyRoleId(stateRef.current.activeRoleId), "admin.access");
    if (!canListInitReviews) {
      return;
    }
    try {
      const pending = await parameterInitializationRepositoryClient.listPendingReviews();
      const drafts: ProjectParameterInitializationDraft[] = [];
      const statuses: Record<string, ProjectInitializationStatus> = {};
      for (const review of pending) {
        const stateDto = await parameterInitializationRepositoryClient.getInitialization(review.projectId);
        statuses[review.projectId] = stateDto.status;
        if (stateDto.draft) {
          drafts.push(toLegacyInitializationDraft(stateDto.draft));
        }
      }
      const existingDrafts = stateRef.current.parameterInitializationDrafts.filter(
        (draft) => !drafts.some((item) => item.id === draft.id)
      );
      const existingReviews = stateRef.current.parameterInitializationReviews.filter(
        (review) => !pending.some((item) => item.id === review.id)
      );
      dispatch({
        type: "HYDRATE_PARAMETER_INITIALIZATION",
        drafts: [...drafts, ...existingDrafts],
        reviews: [...pending.map(toLegacyInitializationReview), ...existingReviews],
        statuses
      });
    } catch {
      // Background hydrate must not toast — API-mode unit tests and non-review
      // pages would otherwise accumulate spurious "无法刷新…" notifications.
    }
  }, [apiAuthPermissions, parameterInitializationRepositoryClient, runtimeMode]);

  const hydratedParameterScope = useRef<number | null>(null);
  const hydrateActiveProjectInitialization = useCallback(
    async (projectId: string) => {
      if (runtimeMode !== "api" || !projectId || hydratedParameterScope.current !== scopeRef.current.generation) {
        return;
      }
      try {
        const stateDto = await parameterInitializationRepositoryClient.getInitialization(projectId);
        dispatch({
          type: "HYDRATE_PROJECT_INITIALIZATION_STATUS",
          projectId,
          status: stateDto.status
        });
        if (stateDto.draft) {
          const legacyDraft = toLegacyInitializationDraft(stateDto.draft);
          const without = stateRef.current.parameterInitializationDrafts.filter(
            (draft) => draft.projectId !== projectId
          );
          dispatch({
            type: "HYDRATE_PARAMETER_INITIALIZATION",
            drafts: [legacyDraft, ...without]
          });
        }
      } catch {
        // Keep local status when the project is unavailable or unauthorized.
      }
    },
    [parameterInitializationRepositoryClient, runtimeMode]
  );

  const initializationCreatedProjectIds = useRef(new Set<string>());
  const previewParameterInitializationViaApi = useCallback<ParameterInitializationRepository["previewSnapshot"]>(
    (input) => parameterInitializationRepositoryClient.previewSnapshot(input),
    [parameterInitializationRepositoryClient]
  );
  const submitParameterInitializationViaApi = useCallback(
    async (
      action: Extract<AppAction, { type: "SUBMIT_PARAMETER_INITIALIZATION" }>,
      expectedSnapshots?: Awaited<ReturnType<ParameterInitializationRepository["previewSnapshot"]>>
    ) => {
      const projectCode = action.draft.projectCode.trim().toUpperCase();
      const projectId = action.draft.projectCode
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!projectId) {
        return;
      }
      try {
        const adminClient = appRuntime.parameterAdminClient ?? createParameterAdminClient();
        if (!initializationCreatedProjectIds.current.has(projectId)) {
          await adminClient.createProject({
            id: projectId,
            name: action.draft.projectName.trim(),
            code: projectCode
          });
          initializationCreatedProjectIds.current.add(projectId);
        }
        const emptyLibrary =
          !action.draft.primarySourceProjectId || action.draft.sourceProjectIds.length === 0;
        let bindingSnapshots = [] as Awaited<
          ReturnType<ParameterInitializationRepository["previewSnapshot"]>
        >;
        if (!emptyLibrary) {
          bindingSnapshots = expectedSnapshots ?? await parameterInitializationRepositoryClient.previewSnapshot({
            projectId,
            primarySourceProjectId: action.draft.primarySourceProjectId,
            supplementSourceProjectIds: action.draft.supplementSourceProjectIds,
            selectedSourceBindingIds: action.draft.selectedParameterIds,
            selectedModuleIds: action.draft.selectedModules,
            selectedRisks: action.draft.selectedRisks
          });
        }
        const draft = await parameterInitializationRepositoryClient.upsertDraft({
          projectId,
          projectName: action.draft.projectName.trim(),
          projectCode,
          ownerUserId: action.draft.ownerUserId,
          sourceProjectIds: emptyLibrary ? [] : action.draft.sourceProjectIds,
          primarySourceProjectId: emptyLibrary ? null : action.draft.primarySourceProjectId,
          supplementSourceProjectIds: emptyLibrary ? [] : action.draft.supplementSourceProjectIds,
          selectedModuleIds: action.draft.selectedModules,
          selectedRisks: action.draft.selectedRisks,
          selectedSourceBindingIds: bindingSnapshots.map((item) => item.sourceProjectParameterBindingId),
          bindingSnapshots,
          emptyLibrary,
          notes: action.draft.notes
        });
        const review = await parameterInitializationRepositoryClient.submit(projectId);
        dispatch({
          type: "HYDRATE_PARAMETER_INITIALIZATION",
          drafts: [toLegacyInitializationDraft(draft), ...stateRef.current.parameterInitializationDrafts],
          reviews: [toLegacyInitializationReview(review), ...stateRef.current.parameterInitializationReviews],
          statuses: { [projectId]: "initialization_pending_review" }
        });
        dispatch({
          type: "ADD_PARAMETER_ADMIN_PROJECT",
          project: { id: projectId, name: action.draft.projectName.trim(), code: projectCode }
        });
        dispatch({ type: "ADD_NOTIFICATION", message: `${draft.projectName} 参数初始化已提交审阅。` });
        setProjectInitOpen(false);
      } catch (error) {
        dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "参数初始化提交失败，请稍后重试。") });
        if (expectedSnapshots !== undefined) throw error;
      }
    },
    [parameterInitializationRepositoryClient, appRuntime.parameterAdminClient]
  );

  const handleInitializationWizardDispatch = useCallback(
    (action: AppAction) => {
      if (runtimeMode === "api" && action.type === "SUBMIT_PARAMETER_INITIALIZATION") {
        void submitParameterInitializationViaApi(action);
        return;
      }
      dispatch(action);
    },
    [runtimeMode, submitParameterInitializationViaApi]
  );

  const hydrateAuthContext = useCallback((context: AuthContextDto) => {
    const primaryRole = pickPrimaryPlatformRoleId(context.roles.map((role) => role.roleId));
    setApiAuthPermissions(context.permissions);
    setApiAuthRoles(context.roles);
    setApiProjectMemberships(context.projectMemberships ?? []);
    setHomeOrganizationSuspended(context.organization.status === "suspended");
    setOrganizationId(context.organization.id);
    dispatch({
      type: "HYDRATE_AUTH_CONTEXT",
      roleId: primaryRole,
      user: {
        id: context.user.id,
        name: context.user.name,
        ...(context.user.email ? { email: context.user.email } : {}),
        ...(context.user.username ? { username: context.user.username } : {}),
        title: context.user.title,
        roleId: primaryRole,
        roles: context.roles.map((role) => ({ projectId: role.projectId, roleId: migrateLegacyRoleId(role.roleId) })),
        isActive: context.user.isActive,
        createdAt: new Date().toISOString(),
        lastActive: "just now"
      }
    });
  }, []);

  const [apiRuntimeFailures, setApiRuntimeFailures] = useState<ReadonlySet<ApiRuntimeDataDomain>>(
    () => new Set()
  );
  const [apiRuntimeSynced, setApiRuntimeSynced] = useState(runtimeMode !== "api");
  const [apiRuntimePending, setApiRuntimePending] = useState<ReadonlySet<ApiRuntimeDataDomain>>(
    () => new Set(runtimeMode === "api" ? ["parameters", "logs", "debugging"] : [])
  );
  const domainDataHydratedRef = useRef(false);
  const apiRuntimeGeneration = useRef(0);
  const hydratedScope = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (runtimeMode !== "api" || apiAuthStatus !== "authenticated") return;
    const previous = hydratedScope.current;
    hydratedScope.current = scopeGeneration;
    if (previous === null || previous === scopeGeneration) return;
    domainDataHydratedRef.current = false;
    apiRuntimeGeneration.current += 1;
    dashboardDispatch({ type: "DASHBOARD_SUMMARY_LOADING" });
    dashboardDispatch({ type: "DASHBOARD_HOTSPOTS_LOADING" });
    dispatch({ type: "HYDRATE_PARAMETER_RUNTIME", projects: [], parameters: [], changeRequests: [], parameterSubmissionRounds: [], parameterDrafts: [] });
    dispatch({ type: "HYDRATE_LOG_RUNTIME", logs: [] });
  }, [runtimeMode, apiAuthStatus, scopeGeneration]);

  const refreshApiRuntimeData = useCallback(
    async (cancelledRef?: { current: boolean }, roleId = stateRef.current.activeRoleId) => {
      const generation = ++apiRuntimeGeneration.current;
      domainDataHydratedRef.current = true;
      const runtimeRoleId = migrateLegacyRoleId(roleId);
      const debuggingProtocol = pageKeyRef.current === "node-debugging" ? readInitialNodeDebuggingProtocol() : "hdc";
      const canUseDebugging = canPerform(runtimeRoleId, "debugging.use");
      const debuggingRefresh = canUseDebugging
        ? debuggingActions.refresh({ protocol: debuggingProtocol }, { notifyOnFailure: false })
        : Promise.resolve("skipped" as const);
      setApiRuntimePending(new Set(["parameters", "logs", "debugging"]));
      const settleDomain = async (domain: ApiRuntimeDataDomain, request: Promise<unknown>) => {
        let failed = false;
        try {
          const result = await request;
          failed = domain === "parameters" && Boolean(result && typeof result === "object" && "notification" in result);
        } catch {
          failed = true;
        }
        if (cancelledRef?.current || generation !== apiRuntimeGeneration.current) return;
        // Settle domains independently: unrelated device discovery must not hold a page's controls.
        if (failed) dispatch({ type: "CLEAR_API_RUNTIME_DOMAIN", domain });
        setApiRuntimeFailures((current) => {
          const next = new Set(current);
          if (failed) next.add(domain);
          else next.delete(domain);
          return next;
        });
        setApiRuntimePending((current) => {
          const next = new Set(current);
          next.delete(domain);
          return next;
        });
        if (domain === "parameters") {
          hydratedParameterScope.current = failed ? null : scopeRef.current.generation;
          setApiRuntimeSynced(true);
        }
      };
      await Promise.all([
        settleDomain("parameters", parameterActions.refresh({ notifyOnFailure: false })),
        settleDomain("logs", logActions.refresh(undefined, { notifyOnFailure: false })),
        settleDomain("debugging", debuggingRefresh)
      ]);
    },
    [debuggingActions, logActions, parameterActions]
  );

  const mockNotificationsClient = useMemo(
    () =>
      runtimeMode === "mock"
        ? createStateBackedNotificationsClient({
            getInbox: () => stateRef.current.notificationInbox,
            setInbox: (items) => dispatch({ type: "SET_NOTIFICATION_INBOX", items })
          })
        : undefined,
    [runtimeMode, dispatch]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!apiRuntimeSynced || apiRuntimeFailures.has("parameters") || page.key === "home") {
      return;
    }
    const urlProjectId = page.key === "parameters" || page.key === "parameter-review" || page.key === "parameter-submissions"
      ? new URLSearchParams(search).get("project") || new URLSearchParams(search).get("projectId") : null;
    const projectId = urlProjectId || state.activeProjectId;
    if (!projectId) {
      return;
    }
    void hydrateActiveProjectInitialization(projectId);
  }, [
    apiRuntimeSynced,
    apiRuntimeFailures,
    hydrateActiveProjectInitialization,
    page.key,
    search,
    state.activeProjectId
  ]);

  useEffect(() => {
    if (runtimeMode !== "api" || apiAuthStatus !== "authenticated" || page.key === "home") {
      return;
    }
    void refreshParameterInitializationFromApi();
  }, [apiAuthStatus, page.key, refreshParameterInitializationFromApi, runtimeMode]);

  useEffect(() => {
    pageKeyRef.current = page.key;
  }, [page.key]);

  useEffect(() => {
    if (
      runtimeMode !== "api" ||
      apiAuthStatus !== "authenticated" ||
      page.key === "home" ||
      domainDataHydratedRef.current
    ) {
      return;
    }
    domainDataHydratedRef.current = true;
    void refreshApiRuntimeData();
  }, [apiAuthStatus, page.key, refreshApiRuntimeData, runtimeMode]);

  useEffect(() => {
    writeSidebarCollapsedPreference(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (runtimeMode !== "api") {
      return;
    }

    const cancelledRef = { current: false };
    const client = appRuntime.authClient;

    setApiAuthStatus("checking");
    client
      .getCurrentAuthContext()
      .then((context) => {
        if (cancelledRef.current) return;
        domainDataHydratedRef.current = false;
        hydrateAuthContext(context);
        setApiAuthStatus("authenticated");
        setApiAuthError("");
        if (pageKeyRef.current === "home") {
          setApiRuntimeSynced(true);
        }
      })
      .catch((error) => {
        if (cancelledRef.current) return;
        if (isAuthRejectionError(error)) {
          clearLocalAuthToken();
          setApiAuthStatus("unauthenticated");
          setApiAuthError(authProbeErrorMessage(error));
          return;
        }
        // Backend restart or network blip: keep the token and show the retry
        // state instead of dropping the user to the login form (FA-21).
        setApiAuthStatus("unreachable");
        setApiAuthError("");
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [appRuntime.authClient, authProbeAttempt, hydrateAuthContext, runtimeMode]);

  useEffect(() => {
    historyIndex.current = window.history.state?.wiseeffNavigationIndex ?? 0;
    window.history.replaceState({ ...window.history.state, wiseeffNavigationIndex: historyIndex.current }, "");
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    window.history.pushState = (data, unused, url) => {
      const previousPath = window.location.pathname;
      const previousIndex = window.history.state?.wiseeffNavigationIndex ?? historyIndex.current;
      const nextIndex = previousIndex + 1;
      originalPush.call(window.history, { ...data, wiseeffNavigationIndex: nextIndex }, unused, url);
      if (window.location.pathname === previousPath && previousIndex === historyIndex.current) historyIndex.current = nextIndex;
      navigationRequest.current += 1;
    };
    window.history.replaceState = (data, unused, url) => {
      const index = window.history.state?.wiseeffNavigationIndex ?? historyIndex.current;
      originalReplace.call(window.history, { ...data, wiseeffNavigationIndex: index }, unused, url);
      navigationRequest.current += 1;
    };
    const syncPathFromHistory = (event?: PopStateEvent) => {
      const request = ++navigationRequest.current;
      const nextIndex = event ? window.history.state?.wiseeffNavigationIndex ?? 0 : historyIndex.current;
      const applyNavigation = () => {
        historyIndex.current = nextIndex;
        if (isStaticDownloadPath(window.location.pathname)) return;
        const nextPage = getPageByPath(window.location.pathname);
        const nextSearch = window.location.pathname === "/log-dashboard" ? "" : window.location.search;
        if (nextPage.path !== window.location.pathname) {
          window.history.replaceState({ ...window.history.state, wiseeffNavigationIndex: nextIndex }, "", `${nextPage.path}${nextSearch}`);
        }
        setPath(nextPage.path);
        setSearch(nextSearch);
      };
      if (event && nextIndex !== historyIndex.current) {
        const decision = requestSettingsLeave();
        if (decision instanceof Promise) {
          const requestedUrl = window.location.href;
          void decision.then((allowed) => {
            if (request !== navigationRequest.current || window.location.href !== requestedUrl) return;
            if (allowed) applyNavigation();
            else window.history.go(historyIndex.current - nextIndex);
          });
          return;
        }
        if (!decision) { window.history.go(historyIndex.current - nextIndex); return; }
      }
      applyNavigation();
    };

    syncPathFromHistory();
    window.addEventListener("popstate", syncPathFromHistory);
    return () => {
      window.removeEventListener("popstate", syncPathFromHistory);
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      navigationRequest.current += 1;
    };
  }, []);

  // Unsubmitted parameter drafts must survive accidental reloads/navigation.
  useEffect(() => {
    const guardUnload = (event: BeforeUnloadEvent) => {
      if (unsavedParameterWorkCount() > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("beforeunload", guardUnload);
    };
  }, []);

  const navigate = useCallback((nextPath: string, options?: { replace?: boolean }) => {
    const request = ++navigationRequest.current;
    const url = new URL(nextPath, window.location.origin);
    if (isStaticDownloadPath(url.pathname)) {
      const decision = requestSettingsLeave();
      if (decision instanceof Promise) void decision.then((allowed) => { if (allowed && request === navigationRequest.current) window.location.assign(url.href); });
      else if (decision) window.location.assign(url.href);
      return;
    }
    const nextPage = getPageByPath(url.pathname);
    if (url.pathname === "/log-dashboard") url.search = "";
    const nextUrl = `${nextPage.path}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl === currentUrl) {
      setPath(nextPage.path);
      setSearch(url.search);
      return;
    }

    const applyNavigation = () => {
      window.history[options?.replace ? "replaceState" : "pushState"](null, "", nextUrl);
      historyIndex.current = window.history.state?.wiseeffNavigationIndex ?? historyIndex.current + (options?.replace ? 0 : 1);
      setPath(nextPage.path);
      setSearch(url.search);
    };
    const decision = requestSettingsLeave();
    if (decision instanceof Promise) void decision.then((allowed) => { if (allowed && request === navigationRequest.current) applyNavigation(); });
    else if (decision) applyNavigation();
  }, []);

  const retryAuthProbe = useCallback(() => {
    setApiAuthStatus("checking");
    setAuthProbeAttempt((attempt) => attempt + 1);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const dismissNotification = useCallback(() => {
    dispatch({ type: "DISMISS_NOTIFICATION" });
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const toggleMobileNav = useCallback(() => {
    setMobileNavOpen((open) => !open);
  }, []);

  /** Drawer navigation closes the drawer before routing (nav click auto-close). */
  const navigateFromSidebar = useCallback(
    (nextPath: string) => {
      setMobileNavOpen(false);
      const projectRoutes = ["/parameters", "/parameter-review", "/parameter-submissions"];
      const params = new URLSearchParams(search);
      const projectId = projectRoutes.includes(path)
        ? params.get("project") || params.get("projectId") : null;
      const destination = new URL(projectId && projectRoutes.includes(nextPath) ? `${nextPath}?project=${encodeURIComponent(projectId)}` : nextPath, window.location.origin);
      navigate(withBusinessOrganizationScope(`${destination.pathname}${destination.search}${destination.hash}`, operatingOrganizationId));
    },
    [navigate, search, path, operatingOrganizationId]
  );

  // Close the drawer when the viewport crosses back above the drawer breakpoint.
  useEffect(() => {
    if (!isMobileNavViewport) {
      setMobileNavOpen(false);
    }
  }, [isMobileNavViewport]);

  // Route changes reset the main scroll position (ui-design-system §Layout);
  // search-only updates (filters, project switches) keep the current position.
  useEffect(() => {
    const mainContent = document.querySelector(".main-content");
    if (mainContent) {
      mainContent.scrollTop = 0;
    }
  }, [path]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // Escape closes the top-most layer only; open dialogs take precedence.
      if (document.querySelector('.modal-backdrop, [data-slot="dialog-overlay"]')) {
        return;
      }
      setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  const handleAuthSession = useCallback(
    async (session: AuthSessionDto) => {
      domainDataHydratedRef.current = false;
      hydrateAuthContext(session.auth);
      setApiAuthStatus("authenticated");
      setApiAuthError("");
      if (pageKeyRef.current === "home") {
        setApiRuntimeSynced(true);
      }
      dispatch({ type: "ADD_NOTIFICATION", message: "已登录雷泽账号" });
    },
    [hydrateAuthContext]
  );

  const handleLogout = useCallback(async () => {
    domainDataHydratedRef.current = false;
    const client = appRuntime.authClient;
    try {
      await client.logout?.();
    } catch {
      // A failed server-side logout must not trap the user in the app;
      // always clear the local session and return to the login screen.
    }
    clearLocalAuthToken();
    clearSessionDraftsForLogout();
    setApiAuthRoles(null);
    setApiProjectMemberships([]);
    setApiAuthStatus("unauthenticated");
    setApiAuthError("");
    dispatch({ type: "ADD_NOTIFICATION", message: "已退出登录" });
  }, [appRuntime.authClient]);

  const handleUpdateCurrentUserProfile = useCallback(
    async (input: UpdateCurrentUserProfileInput) => {
      const client = appRuntime.authClient;
      if (!client.updateCurrentUserProfile) {
        throw new Error("当前认证方式不支持资料更新。");
      }
      const context = await client.updateCurrentUserProfile(input);
      hydrateAuthContext(context);
      dispatch({ type: "ADD_NOTIFICATION", message: "个人资料已更新" });
    },
    [appRuntime.authClient, hydrateAuthContext]
  );

  const handleChangeCurrentUserPassword = useCallback(
    async (input: ChangeCurrentUserPasswordInput) => {
      const client = appRuntime.authClient;
      if (!client.changePassword) {
        throw new Error("当前认证方式不支持修改密码。");
      }
      await client.changePassword(input);
      dispatch({ type: "ADD_NOTIFICATION", message: "密码已更新，其它会话已退出" });
    },
    [appRuntime.authClient]
  );

  const appShellClassName = isPlatformHome
    ? "app-shell home-shell"
    : [
        "app-shell",
        effectiveSidebarCollapsed ? "sidebar-is-collapsed" : "",
        mobileNavOpen ? "mobile-nav-open" : ""
      ]
        .filter(Boolean)
        .join(" ");

  if (runtimeMode === "api" && apiAuthStatus === "checking") {
    // Session probe in flight: show the app-shell skeleton instead of a blank
    // screen (or a flash of the login form) while `/api/v1/me` resolves.
    return <AppShellSkeleton />;
  }

  if (runtimeMode === "api" && apiAuthStatus === "unreachable") {
    // Network-level probe failure: only an auth rejection (401 family) may
    // route to the login form.
    return <AppShellConnectionError onRetry={retryAuthProbe} />;
  }

  if (runtimeMode === "api" && apiAuthStatus !== "authenticated") {
    return (
      <ApiAuthPage
        authClient={appRuntime.authClient}
        error={apiAuthError}
        status={apiAuthStatus}
        onAuthenticated={handleAuthSession}
      />
    );
  }

  // Explicit opt-in only: mounting the inspector drags in the CopilotKit
  // announcement banner, which has no standalone off switch upstream.
  const enableXiaozeInspector = xiaozeInspectorEnabled && canPerform(currentRoleId, "admin.access");
  const showXiaozeProactiveInsights =
    runtimeMode === "api" &&
    xiaozeProactiveEnabled &&
    !isPlatformHome &&
    canAccessCurrentPage &&
    supportsXiaozeProactiveInsights(page.key);
  const proactiveInsightsBanner = showXiaozeProactiveInsights ? (
    <div className="xiaoze-proactive-insights">
      <XiaozeProactiveInsights key={`${state.currentUserId}:${operatingOrganizationId ?? "home"}`} enabled organizationId={operatingOrganizationId} />
    </div>
  ) : null;

  const apiRuntimeDomainLabels: Record<ApiRuntimeDataDomain, string> = {
    parameters: "参数",
    logs: "日志",
    debugging: "调试"
  };
  const pageRuntimeDomain: ApiRuntimeDataDomain | null = !canAccessCurrentPage ? null : page.group === "参数管理" || page.key === "dts-reload"
    ? "parameters"
    : page.group === "日志分析" ? "logs" : page.group === "调试平台" && page.key !== "debugging-admin" ? "debugging" : null;
  const pageRuntimeState = runtimeMode !== "api" || !pageRuntimeDomain
    ? "ready"
    : apiRuntimePending.has(pageRuntimeDomain) ? "loading" : apiRuntimeFailures.has(pageRuntimeDomain) ? "error" : "ready";
  const apiRuntimeStatusBanner =
    pageRuntimeState === "error" && pageRuntimeDomain ? (
      <div className="api-runtime-error-banner" role="alert" aria-live="assertive">
        <AlertTriangle size={18} aria-hidden="true" />
        <div className="api-runtime-error-banner__body">
          <strong>
            无法连接雷泽{apiRuntimeDomainLabels[pageRuntimeDomain]} API，当前无数据
          </strong>
          <p>为避免误读，连接失败时不展示演示数据；请确认后端服务可用后重试。</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void refreshApiRuntimeData()}
        >
          重试
        </button>
      </div>
    ) : pageRuntimeState === "loading" ? (
      <div className="api-runtime-sync-banner" role="status">
        <LoaderCircle size={16} className="api-runtime-sync-banner__spinner" aria-hidden="true" />
        正在连接雷泽服务，加载真实数据…
      </div>
    ) : null;
  const publicationPreviewBanner = isPublicationAdministrator && currentWorkflow && publication.status === "ready" &&
    publication.publication?.workflows[currentWorkflow] === false
    ? <div className="api-runtime-sync-banner" role="status">管理员预览 · 此工作流尚未向用户开放</div> : null;

  const appShell = (
    <div className={appShellClassName}>
        {!isPlatformHome ? <SkipLink /> : null}
        {!isPlatformHome ? (
          <Sidebar
            activePath={page.path}
            currentRoleId={currentRoleId}
            visibleWorkflows={visibleWorkflows}
            canManagePublication={canManagePublication}
            isCollapsed={effectiveSidebarCollapsed}
            onNavigate={navigateFromSidebar}
            onToggleCollapsed={toggleSidebarCollapsed}
            onFeedback={() => setFeedbackOpen(true)}
          />
        ) : null}
        {!isPlatformHome && mobileNavOpen ? (
          <button
            type="button"
            className="sidebar-drawer-backdrop"
            aria-label="关闭导航菜单"
            onClick={closeMobileNav}
          />
        ) : null}
      <div className={isPlatformHome ? "main-shell home-main-shell" : "main-shell"}>
        {!isPlatformHome ? (
          <TopBar
            state={state}
            dispatch={dispatch}
            page={page}
            search={search}
            onNavigate={navigate}
            pageActions={topBarActions}
            pageLeadingActions={topBarLeadingActions}
            onNewProject={() => setProjectInitOpen(true)}
            canCreateProject={runtimeMode === "api" ? apiAuthPermissions.includes("admin:access") : undefined}
            onLogout={handleLogout}
            onUpdateCurrentUserProfile={handleUpdateCurrentUserProfile}
            onChangeCurrentUserPassword={handleChangeCurrentUserPassword}
            getAuthConfig={appRuntime.authClient.getLocalAuthConfig}
            mockNotificationsClient={mockNotificationsClient}
            mobileNavOpen={mobileNavOpen}
            onToggleMobileNav={toggleMobileNav}
          />
        ) : null}
        <TopBarActionsContext.Provider value={topBarActionsContextValue}>
          {isPlatformHome ? (
            <div className="main-content home-content" data-runtime-state="ready">
              {proactiveInsightsBanner}
              <OrganizationBusinessWorkspace homeSuspended={showHomeOrganizationSuspended} homePath={path} actorId={state.currentUserId} organizationId={isOrganizationBusinessPath(path) ? operatingOrganizationId : undefined} workspaceClient={appRuntime.organizationWorkspaceClient} onNavigate={navigate}>
              <PageRouter key={`${state.currentUserId}:${operatingOrganizationId ?? "home"}:${page.key}`}
                page={page}
                publication={publication}
                visibleWorkflows={visibleWorkflows}
                publicationAdministrator={isPublicationAdministrator}
                onFeedback={() => setFeedbackOpen(true)}
                state={state}
                dispatch={dispatch}
                onNavigate={navigate}
                onNewProject={() => setProjectInitOpen(true)}
                debuggingActions={debuggingActions}
                logActions={logActions}
                parameterActions={parameterActions}
                runtime={appRuntime}
                knowledgeCapability={knowledgeCapability}
                canStartDtsReload={canStartDtsReload}
                canPromoteDtsReloadDrafts={canPromoteDtsReloadDrafts}
                runtimeMode={runtimeMode}
                search={search}
                onSearchChange={setSearch}
                dashboardState={dashboardState}
                dashboardRuntime={dashboardRuntime}
                onDashboardWindowChange={(window) => dashboardDispatch({ type: "DASHBOARD_SET_WINDOW", window })}
                onDashboardDimensionChange={(dimension) =>
                  dashboardDispatch({ type: "DASHBOARD_SET_DIMENSION", dimension })
                }
                onDashboardOverviewScopeChange={(scope) =>
                  dashboardDispatch({ type: "DASHBOARD_SET_OVERVIEW_SCOPE", scope })
                }
                onDashboardProjectChange={(projectId) =>
                  dashboardDispatch({ type: "DASHBOARD_SET_PROJECT", projectId })
                }
                onAuthContextRefresh={hydrateAuthContext}
                onEndSession={handleLogout}
                organizationId={organizationId}
                sessionPermissions={apiAuthPermissions}
                sessionRoles={runtimeMode === "api" ? apiAuthRoles : undefined}
                projectMemberships={runtimeMode === "api" ? apiProjectMemberships : undefined}
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              /></OrganizationBusinessWorkspace>
            </div>
          ) : (
            <main
              id={MAIN_CONTENT_ID}
              className="main-content"
              tabIndex={-1}
              aria-label={isParameterHome ? "参数管理首页" : page.title}
              data-runtime-state={pageRuntimeState}
              aria-busy={pageRuntimeState === "loading"}
            >
              {apiRuntimeStatusBanner}
              {publicationPreviewBanner}
              {proactiveInsightsBanner}
              <div className="page-content" inert={pageRuntimeState === "loading"}>
                <OrganizationBusinessWorkspace homeSuspended={showHomeOrganizationSuspended} homePath={path} actorId={state.currentUserId} organizationId={isOrganizationBusinessPath(path) ? operatingOrganizationId : undefined} workspaceClient={appRuntime.organizationWorkspaceClient} onNavigate={navigate}>
                <PageRouter key={`${state.currentUserId}:${operatingOrganizationId ?? "home"}:${page.key}`}
                  page={page}
                  publication={publication}
                  visibleWorkflows={visibleWorkflows}
                  publicationAdministrator={isPublicationAdministrator}
                  onFeedback={() => setFeedbackOpen(true)}
                  state={state}
                  dispatch={dispatch}
                  onNavigate={navigate}
                  onNewProject={() => setProjectInitOpen(true)}
                  debuggingActions={debuggingActions}
                  logActions={logActions}
                  parameterActions={parameterActions}
                  runtime={appRuntime}
                  knowledgeCapability={knowledgeCapability}
                  canStartDtsReload={canStartDtsReload}
                  canPromoteDtsReloadDrafts={canPromoteDtsReloadDrafts}
                  runtimeMode={runtimeMode}
                  search={search}
                  onSearchChange={setSearch}
                  dashboardState={dashboardState}
                  dashboardRuntime={dashboardRuntime}
                  onDashboardWindowChange={(window) => dashboardDispatch({ type: "DASHBOARD_SET_WINDOW", window })}
                  onDashboardDimensionChange={(dimension) =>
                    dashboardDispatch({ type: "DASHBOARD_SET_DIMENSION", dimension })
                  }
                  onDashboardOverviewScopeChange={(scope) =>
                    dashboardDispatch({ type: "DASHBOARD_SET_OVERVIEW_SCOPE", scope })
                  }
                  onDashboardProjectChange={(projectId) =>
                    dashboardDispatch({ type: "DASHBOARD_SET_PROJECT", projectId })
                  }
                  onAuthContextRefresh={hydrateAuthContext}
                  onEndSession={handleLogout}
                  organizationId={organizationId}
                  sessionPermissions={apiAuthPermissions}
                  sessionRoles={runtimeMode === "api" ? apiAuthRoles : undefined}
                  projectMemberships={runtimeMode === "api" ? apiProjectMemberships : undefined}
                  DebuggingAdminPage={DebuggingAdminPageWithRuntime}
                /></OrganizationBusinessWorkspace>
              </div>
              {showsApplicationFooter ? (
                <AppFooter config={appFooterConfig} onFeedback={() => setFeedbackOpen(true)} />
              ) : null}
            </main>
          )}
        </TopBarActionsContext.Provider>
        {!isPlatformHome && !showsApplicationFooter ? (
          <div className="shell-footer">
            <AppFooter config={appFooterConfig} onFeedback={() => setFeedbackOpen(true)} />
          </div>
        ) : null}
      </div>
      {runtimeMode === "api" && !isPlatformHome && canAccessCurrentPage ? (
        <XiaozePageContextRegistrar
          path={path}
          pageKey={page.key}
          projectId={usesProjectScope ? state.activeProjectId : undefined}
          roleId={currentRoleId}
          visibleRecords={xiaozeContextSummary ? [{ summary: xiaozeContextSummary }] : undefined}
        />
      ) : null}
        {projectInitOpen ? (
          <ProjectParameterInitializationWizard
            state={state}
            dispatch={handleInitializationWizardDispatch}
            onClose={() => setProjectInitOpen(false)}
            onPreview={runtimeMode === "api" ? previewParameterInitializationViaApi : undefined}
            onSubmit={runtimeMode === "api" ? submitParameterInitializationViaApi : undefined}
          />
        ) : null}
      <FeedbackDialog
        key={scopeKey}
        open={feedbackOpen}
        pagePath={path}
        pageTitle={page.title}
        productFeedbackRepository={productFeedbackRepositoryClient}
        onOpenChange={setFeedbackOpen}
      />
      <AppToastLayer notifications={state.notifications} onDismiss={dismissNotification} />
      </div>
  );

  return runtimeMode === "api" ? (
    <XiaozePageContext.Provider value={xiaozePageContext}>
      <XiaozeProvider enableInspector={enableXiaozeInspector} userId={state.currentUserId} organizationId={operatingOrganizationId}>{appShell}</XiaozeProvider>
    </XiaozePageContext.Provider>
  ) : (
    appShell
  );
}

function Sidebar({
  activePath,
  currentRoleId,
  visibleWorkflows,
  canManagePublication,
  isCollapsed,
  onNavigate,
  onToggleCollapsed,
  onFeedback
}: {
  activePath: string;
  currentRoleId: string;
  visibleWorkflows: readonly WorkflowId[];
  canManagePublication: boolean;
  isCollapsed: boolean;
  onNavigate: (path: string) => void;
  onToggleCollapsed: () => void;
  onFeedback: () => void;
}) {
  const activePageKey = getPageByPath(activePath).key;
  const visibleNavigationItems = navigationItems.filter(
    (item) => item.key !== "parameter-submissions" && canAccessPage(currentRoleId, item.key) && isDiscoveryGroupVisible(item.group, visibleWorkflows)
  );
  const groups = visibleNavigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = isCollapsed ? "展开侧边栏" : "收起侧边栏";

  return (
    <aside
      id="app-sidebar"
      aria-label="主导航侧边栏"
      className={isCollapsed ? "sidebar sidebar-collapsed" : "sidebar sidebar-expanded"}
    >
      <div className="brand-block">
        <div className="brand-mark">
          <WiseEffIcon decorative />
        </div>
        <div className="brand-copy">
          <div className="brand-title">雷泽</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-expanded={!isCollapsed}
              aria-label={toggleLabel}
              className="sidebar-toggle"
              size="icon"
              type="button"
              variant="ghost"
              onClick={onToggleCollapsed}
            >
              <ToggleIcon size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="nav-scroll">
        <nav aria-label="主导航">
          {Object.entries(groups).map(([group, items]) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-label">{group}</div>
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === activePageKey;
                return (
                  <Tooltip key={item.path}>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={item.label}
                        aria-current={isActive ? "page" : undefined}
                        className={isActive ? "nav-item active" : "nav-item"}
                        type="button"
                        variant="ghost"
                        onClick={() => onNavigate(item.path)}
                      >
                        <Icon size={18} />
                        <span>{item.label}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>
      <div className="utility-nav">
        {utilityItems
          .filter((item) => (!item.path || canAccessPage(currentRoleId, getPageByPath(item.path).key)) &&
            ((item.path !== "/workflow-publication" && item.path !== "/platform/organizations") || canManagePublication))
          .map((item) => {
            const Icon = item.icon;
            const path = item.path === "/organization" && canManagePublication ? "/platform/organizations" : item.path;
            const button = (
              <Button
                aria-label={item.label}
                className={
                  item.path && (getPageByPath(item.path).key === activePageKey || path === activePath)
                    ? "nav-item compact active"
                    : "nav-item compact"
                }
                disabled={!item.path}
                type="button"
                variant="ghost"
                onClick={() => path && onNavigate(path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Button>
            );

            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="问题反馈" className="nav-item compact feedback-entry" type="button" variant="ghost" onClick={onFeedback}>
              <MessageSquareText size={18} />
              <span>问题反馈</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">问题反馈</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}

function TopBar({
  state,
  dispatch,
  page,
  search,
  onNavigate,
  pageActions,
  pageLeadingActions,
  onNewProject,
  canCreateProject: canCreateProjectOverride,
  onLogout,
  onUpdateCurrentUserProfile,
  onChangeCurrentUserPassword,
  getAuthConfig,
  mockNotificationsClient,
  mobileNavOpen = false,
  onToggleMobileNav
}: {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  page: PageConfig;
  search: string;
  onNavigate: (path: string) => void;
  pageActions?: ReactNode;
  pageLeadingActions?: ReactNode;
  onNewProject: () => void;
  canCreateProject?: boolean;
  onLogout?: () => Promise<void> | void;
  onUpdateCurrentUserProfile?: (input: UpdateCurrentUserProfileInput) => Promise<void>;
  onChangeCurrentUserPassword?: (input: ChangeCurrentUserPasswordInput) => Promise<void>;
  getAuthConfig?: WiseEffAuthClient["getLocalAuthConfig"];
  mockNotificationsClient?: import("@/infrastructure/http/notificationsClient").NotificationsClient;
  mobileNavOpen?: boolean;
  onToggleMobileNav?: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [pendingProjectSwitch, setPendingProjectSwitch] = useState<{
    projectId: string;
    unsavedCount: number;
  } | null>(null);
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canCreateProject = canCreateProjectOverride ?? canPerform(currentRoleId, "parameter.edit");
  const showProjectInitAction = page.key === "parameters" && canCreateProject;
  const showProjectSelector = pageUsesProjectScope(page.key) && page.key !== "parameter-home";
  const workspaceOwnsHeader = /^\/log-admin\/skills\/[^/]+\/?$/.test(page.path);
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const visibleUserName = currentUser?.name ?? "账户信息暂不可用";
  const projectOptions = state.configDraft.projects.map((project) => ({ value: project.id, label: project.name }));
  const selectedProjectId =
    page.key === "parameters" || page.key === "parameter-review" || page.key === "parameter-submissions"
      ? new URLSearchParams(search).get("project") || new URLSearchParams(search).get("projectId") || state.activeProjectId : state.activeProjectId;
  const commitProjectChange = (projectId: string) => {
    dispatch({ type: "SET_PROJECT", projectId });

    if (page.key === "parameters" || page.key === "parameter-review" || page.key === "parameter-submissions") {
      onNavigate(`/${page.key}?project=${encodeURIComponent(projectId)}`);
    }
  };

  const handleProjectChange = (projectId: string) => {
    // Switching projects tears down the parameter workbench; unsaved drafts
    // must be acknowledged before they are dropped (confirm matrix, presented
    // through the shared ConfirmDialog primitive).
    if (page.key === "parameters") {
      const unsavedCount = unsavedParameterWorkCount();
      if (unsavedCount > 0) {
        setPendingProjectSwitch({ projectId, unsavedCount });
        return;
      }
    }
    commitProjectChange(projectId);
  };

  return (
    <header className="topbar" aria-label="页面栏">
      <div className="topbar-page">
        <div className="topbar-page-head">
          {onToggleMobileNav ? (
            <button
              type="button"
              className="button ghost topbar-nav-toggle"
              aria-label={mobileNavOpen ? "关闭导航菜单" : "打开导航菜单"}
              aria-expanded={mobileNavOpen}
              aria-controls="app-sidebar"
              onClick={onToggleMobileNav}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
          ) : null}
          {!workspaceOwnsHeader ? <div className="topbar-title">{page.title}</div> : null}
          {pageLeadingActions ? <div className="topbar-page-leading">{pageLeadingActions}</div> : null}
        </div>
        {!workspaceOwnsHeader && page.subtitle ? <div className="topbar-subtitle">{page.subtitle}</div> : null}
      </div>
      <div className="topbar-actions">
        {showProjectInitAction || pageActions ? (
          <div className="topbar-page-actions" role="toolbar" aria-label={`${page.title}页面操作`}>
            {showProjectInitAction ? (
              <button className="button subtle" type="button" onClick={onNewProject}>
                <FileText size={16} />
                新建项目
              </button>
            ) : null}
            {pageActions}
          </div>
        ) : null}
        {showProjectSelector ? (
          <SelectControl
            ariaLabel="项目"
            className="topbar-project-select"
            value={selectedProjectId}
            onValueChange={handleProjectChange}
            options={projectOptions}
          />
        ) : null}
        <TopBarNotifications mockNotificationsClient={mockNotificationsClient} onNavigate={onNavigate} />
        <Popover.Root key={`${page.path}${search}`}>
        <Popover.Trigger asChild>
          <button
            ref={userMenuTriggerRef}
            aria-label={`${visibleUserName}，打开用户菜单`}
            className="topbar-user-trigger"
            type="button"
          >
            <span className="avatar topbar-user-avatar" aria-hidden="true">
              <UserRound size={17} />
            </span>
            <span className="topbar-user-summary">
              <strong>{visibleUserName}</strong>
            </span>
            <ChevronDown size={14} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
            <Popover.Content className="topbar-user-menu" aria-label="用户菜单" align="end" sideOffset={8}
              onCloseAutoFocus={(event) => { if (profileOpen) event.preventDefault(); }}>
              <div className="topbar-user-menu__identity">
                <strong>{visibleUserName}</strong>
                <span>{currentUser ? userAccountIdentifier(currentUser) : "账号标识未记录"}</span>
              </div>
              <div className="topbar-user-menu__identity" aria-label="版本信息">
                <span>© {new Date().getFullYear()} {appFooterConfig.copyrightOwner}</span>
                <span>版本 {appFooterConfig.version}</span>
              </div>
              <div className="topbar-user-menu__field topbar-user-menu__role" aria-label="当前用户角色">
                <span>角色</span>
                <strong>{getRequiredRoleLabel(currentRoleId)}</strong>
              </div>
              <div className="topbar-user-menu__actions">
                <Popover.Close asChild>
                <button
                  type="button"
                  className="button"
                  disabled={!currentUser || !onUpdateCurrentUserProfile}
                  onClick={() => {
                    userMenuTriggerRef.current?.focus();
                    setProfileOpen(true);
                  }}
                >
                  个人资料
                </button>
                </Popover.Close>
                {onLogout ? (
                  <Popover.Close asChild>
                  <button type="button" className="button ghost" onClick={() => void onLogout()}>
                    退出登录
                  </button>
                  </Popover.Close>
                ) : null}
              </div>
            </Popover.Content>
        </Popover.Portal>
        </Popover.Root>
      </div>
      {profileOpen && currentUser && onUpdateCurrentUserProfile ? (
        <ProfileDialog
          user={currentUser}
          onCancel={() => setProfileOpen(false)}
          onSave={async (input) => {
            await onUpdateCurrentUserProfile(input);
            setProfileOpen(false);
          }}
          onChangePassword={onChangeCurrentUserPassword}
          getAuthConfig={getAuthConfig}
        />
      ) : null}
      <ConfirmDialog
        open={pendingProjectSwitch !== null}
        title="切换项目"
        description={`有 ${pendingProjectSwitch?.unsavedCount ?? 0} 项未保存的修改，切换项目将丢弃这些修改。`}
        confirmLabel="丢弃并切换"
        tone="danger"
        onConfirm={() => {
          if (pendingProjectSwitch) {
            commitProjectChange(pendingProjectSwitch.projectId);
          }
          setPendingProjectSwitch(null);
        }}
        onCancel={() => setPendingProjectSwitch(null)}
      />
    </header>
  );
}

const selfRegistrationRoleHints: Record<string, string> = {
  guest: "访客只能查看参数页面。",
  "hardware-user": "注册后可登录；参数修改需由管理员配置项目参与和编辑角色。",
  "software-user": "注册后可登录；参数修改需由管理员配置项目参与和编辑角色。",
  "hardware-committer": "硬件MDE 注册后需管理员批准才能登录。",
  "software-committer": "软件MDE 注册后需管理员批准才能登录。"
};

function ApiAuthPage({
  authClient,
  error,
  status,
  onAuthenticated
}: {
  authClient: WiseEffAuthClient;
  error: string;
  status: ApiAuthStatus;
  onAuthenticated: (session: AuthSessionDto) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState<PlatformRoleId>("hardware-user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistrationDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localConfig, setLocalConfig] = useState<LocalAuthPublicConfigDto | null>(
    authClient.getLocalAuthConfig
      ? null
      : {
          provider: "local",
          selfRegisterEnabled: Boolean(authClient.register),
          hasLocalAdmin: true,
          evaluationOrganizationName: null
        }
  );
  const roleOptions = useMemo(
    () => platformRoles.filter((role) => selfRegistrationRoleIds.has(role.id)).map((role) => ({ value: role.id, label: role.name })),
    []
  );
  const pendingRequestedRoleName = pendingRegistration
    ? (platformRoles.find((role) => role.id === pendingRegistration.requestedRoleId)?.name ?? pendingRegistration.requestedRoleId)
    : "";
  const pendingAssignedRoleName = pendingRegistration
    ? (platformRoles.find((role) => role.id === pendingRegistration.assignedRoleId)?.name ?? pendingRegistration.assignedRoleId)
    : "";
  const canSelfRegister =
    Boolean(authClient.register) &&
    (authClient.getLocalAuthConfig ? Boolean(localConfig?.selfRegisterEnabled) : true);

  useEffect(() => {
    if (!authClient.getLocalAuthConfig) {
      return;
    }
    let cancelled = false;
    void authClient
      .getLocalAuthConfig()
      .then((config) => {
        if (!cancelled) {
          setLocalConfig(config);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalConfig({
            provider: "local",
            selfRegisterEnabled: false,
            hasLocalAdmin: true,
            evaluationOrganizationName: null
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authClient]);

  useEffect(() => {
    if (!canSelfRegister && mode === "register") {
      setMode("login");
    }
  }, [canSelfRegister, mode]);

  function changeMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setFormError("");
    setPendingRegistration(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setPendingRegistration(null);
    setSubmitting(true);

    try {
      if (mode === "login") {
        if (!authClient.login) {
          throw new Error("本地账号登录未启用。");
        }
        await onAuthenticated(await authClient.login({ username, password }));
      } else {
        if (!authClient.register) {
          throw new Error("本地账号注册未启用。");
        }
        if (password !== confirmPassword) {
          setFormError("两次输入的密码不一致。");
          return;
        }
        const response = await authClient.register({
          name,
          username,
          roleId,
          password
        });
        if (isPendingRegistrationResponse(response)) {
          setPendingRegistration(response);
          setPassword("");
          setConfirmPassword("");
          return;
        }
        await onAuthenticated(response);
      }
    } catch (submitError) {
      setFormError(presentError(submitError, mode === "login" ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen" aria-labelledby="auth-title">
      <section className="auth-panel">
        <div className="auth-brand">
          <WiseEffIcon className="auth-brand-icon" title="雷泽" />
          <div>
            <span className="eyebrow">WiseEff</span>
            <h1 id="auth-title">{mode === "login" ? "登录雷泽" : "注册雷泽"}</h1>
          </div>
        </div>

        {localConfig?.hasLocalAdmin === false ? (
          <section className="auth-pending-notice" aria-labelledby="auth-bootstrap-title">
            <p className="eyebrow">首次开通</p>
            <h2 id="auth-bootstrap-title">还没有管理员账号</h2>
            <p>请先在服务器上创建首位管理员，再使用该账号登录。自助注册不能创建管理员。</p>
            <pre className="auth-bootstrap-command">
              npm run admin:bootstrap -- --username … --password … --name …
            </pre>
          </section>
        ) : null}

        {canSelfRegister ? (
          <div className="auth-mode-tabs" role="tablist" aria-label="认证方式">
            <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => changeMode("login")}>
              登录
            </button>
            <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => changeMode("register")}>
              注册
            </button>
          </div>
        ) : null}

        {!canSelfRegister && localConfig ? <p className="auth-help">加入组织请联系管理员获取邀请链接或创建账号。</p> : null}

        {mode === "register" ? (
          <p className="auth-help">
            {`${
              localConfig?.evaluationOrganizationName
                ? `新账号将加入体验组织「${localConfig.evaluationOrganizationName}」。`
                : "新账号将加入指定体验组织。"
            } 用户名须为 3–64 个字符，仅限字母、数字、点、下划线和连字符。`}
          </p>
        ) : null}

        {pendingRegistration ? (
          <section className="auth-pending-notice" aria-labelledby="auth-pending-title">
            <p className="eyebrow">注册审批</p>
            <h2 id="auth-pending-title">注册申请已提交</h2>
            <p>
              {pendingRegistration.user.username} 已提交 {pendingRequestedRoleName} 申请。管理员批准前账号不会登录到工作台，
              批准后可使用当前用户名和密码登录。
            </p>
            <dl>
              <div>
                <dt>申请角色</dt>
                <dd>{pendingRequestedRoleName}</dd>
              </div>
              <div>
                <dt>基础角色</dt>
                <dd>{pendingAssignedRoleName}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {!pendingRegistration ? (
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" ? (
              <>
                <label>
                  <span>姓名</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                <div className="auth-form-field">
                  <label>
                    <span>角色</span>
                    <SelectControl
                      id="local-auth-role"
                      value={roleId}
                      onValueChange={setRoleId}
                      options={roleOptions}
                      ariaLabel="角色"
                      className="auth-select-control"
                    />
                  </label>
                  <span className="auth-field-hint" id="local-auth-role-hint">
                    {selfRegistrationRoleHints[roleId] ?? "管理员不能自助注册，需由现有管理员创建。"}
                  </span>
                </div>
              </>
            ) : null}
            <div className="auth-form-field">
              <label>
                <span>用户名</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={64}
                  aria-describedby={mode === "register" ? "local-auth-username-hint" : undefined}
                  required
                />
              </label>
              {mode === "register" ? (
                <span className="auth-field-hint" id="local-auth-username-hint">
                  3–64 个字符，仅限字母、数字、点、下划线和连字符。
                </span>
              ) : null}
            </div>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </label>
            {mode === "register" ? (
              <label>
                <span>确认密码</span>
                <input
                  type="password"
                  value={confirmPassword}
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            ) : null}
            {formError || (status === "unauthenticated" && error) ? (
              <p role="alert" className="auth-error">{formError || error}</p>
            ) : null}
            <button className="button primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? "处理中" : mode === "login" ? "登录" : "注册"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

export function ProfileDialog({
  user,
  onCancel,
  onSave,
  onChangePassword,
  getAuthConfig
}: {
  user: User;
  onCancel: () => void;
  onSave: (input: UpdateCurrentUserProfileInput) => Promise<void>;
  onChangePassword?: (input: ChangeCurrentUserPasswordInput) => Promise<void>;
  getAuthConfig?: WiseEffAuthClient["getLocalAuthConfig"];
}) {
  const [provider, setProvider] = useState<LocalAuthPublicConfigDto["provider"] | null>(getAuthConfig ? null : onChangePassword ? "local" : "development");
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  useEffect(() => {
    if (!getAuthConfig) return;
    let active = true;
    setProvider(null); setCapabilityError(false);
    void getAuthConfig().then((config) => { if (active) setProvider(config.provider); }).catch(() => { if (active) setCapabilityError(true); });
    return () => { active = false; };
  }, [getAuthConfig, capabilityAttempt]);
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onSave({ name, title });
    } catch (saveError) {
      setError(presentError(saveError, "保存失败，请稍后重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onChangePassword) {
      return;
    }
    setPasswordError("");
    if (newPassword !== confirmNewPassword) {
      setPasswordError("两次输入的密码不一致。");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (saveError) {
      setPasswordError(presentError(saveError, "修改密码失败，请稍后重试。"));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  const busy = submitting || passwordSubmitting;

  return (
    <ModalDialog open onDismiss={busy ? undefined : onCancel} className="profile-dialog">
      {({ titleId }) => (
        <div className="modal-form-contents">
          <form onSubmit={submit}>
            <header>
              <span className="eyebrow">账号</span>
              <h2 id={titleId}>个人资料</h2>
              <p>{userAccountIdentifier(user)}</p>
              {provider === "oidc" ? <p className="auth-field-hint">登录标识由组织身份提供方管理。姓名和职务仅更新雷泽中的显示资料。</p> : null}
            </header>
            <label>
              <span>姓名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              <span>职务</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            {error ? <p role="alert" className="auth-error">{error}</p> : null}
            <footer>
              <button type="button" className="button profile-dialog__button profile-dialog__button--secondary" onClick={onCancel} disabled={busy}>
                取消
              </button>
              <button type="submit" className="button primary profile-dialog__button profile-dialog__button--primary" disabled={busy}>
                保存
              </button>
            </footer>
          </form>
          {capabilityError ? <div role="alert" className="auth-error">无法确认密码修改能力，个人资料仍可保存。<button type="button" className="button ghost" onClick={() => setCapabilityAttempt((value) => value + 1)}>重试账号能力</button></div>
            : !provider ? <p role="status" className="auth-field-hint">正在确认账号能力…</p>
            : provider === "oidc" ? <p className="auth-field-hint">密码由组织身份提供方管理，请在组织身份系统中修改。</p>
            : provider !== "local" ? <p className="auth-field-hint">当前登录方式不提供本地密码修改，请联系组织管理员。</p> : null}
          {provider === "local" && onChangePassword ? (
            <form className="profile-dialog__password" onSubmit={submitPassword} aria-labelledby="profile-password-title">
              <h3 id="profile-password-title">修改密码</h3>
              <p className="auth-field-hint">更新后当前会话保持登录，其它会话会退出。</p>
              <label>
                <span>当前密码</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                <span>新密码</span>
                <input
                  type="password"
                  value={newPassword}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                <span>确认新密码</span>
                <input
                  type="password"
                  value={confirmNewPassword}
                  minLength={8}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              {passwordError ? <p role="alert" className="auth-error">{passwordError}</p> : null}
              <footer>
                <button type="submit" className="button primary profile-dialog__button profile-dialog__button--primary" disabled={busy}>
                  更新密码
                </button>
              </footer>
            </form>
          ) : null}
        </div>
      )}
    </ModalDialog>
  );
}

export default App;
