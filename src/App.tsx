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
import { AppShellSkeleton } from "@/components/common/AppShellSkeleton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { TopBarNotifications } from "./components/notifications/TopBarNotifications";
import { createStateBackedNotificationsClient } from "@/infrastructure/mock/mockNotificationsGateway";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { supportsXiaozeProactiveInsights } from "@/features/agent/xiaozeProactiveInsights";
import { FeedbackDialog } from "@/features/product-feedback/FeedbackDialog";
import { xiaozeProactiveEnabled } from "@/infrastructure/http/runtimeMode";
import { getPageByPath, getXiaozeContextSummary, navigationItems, pageUsesProjectScope, PageConfig, utilityItems } from "./appConfig";
import { isDiscoveryGroupVisible } from "@/domain/workflowDiscovery";
import { createApiInitialState } from "@/application/state/apiInitialState";
import { reducer, type AppAction, type ApiRuntimeDataDomain } from "@/application/state/appState";
import { createAppRuntime, type WiseEffAuthClient } from "@/app/appRuntime";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clearLocalAuthToken,
  type AuthContextDto,
  type AuthSessionDto,
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

type SelectOption<Value extends string = string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

function SelectControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  id,
  className,
  placeholder,
  disabled
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: SelectOption<Value>[];
  ariaLabel?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as Value)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className} data-value={value}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function userAccountIdentifier(user: User) {
  return user.username ?? user.email ?? "No account identifier";
}

type AppProps = {
  authClient?: WiseEffAuthClient;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  debuggingGateway?: DebuggingGateway;
  initialAppState?: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  parameterRepository?: ParameterRepository;
  parameterTopologyRepository?: ParameterTopologyRepository;
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
  debuggingAdminClient,
  debuggingGateway,
  initialAppState,
  logAnalysisRepository,
  listParameterConfigSets,
  parameterRepository,
  parameterTopologyRepository,
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
        <AppShell
          authClient={authClient}
          debuggingAdminClient={debuggingAdminClient}
          debuggingGateway={debuggingGateway}
          initialAppState={resolvedInitialAppState}
          key={mockDataFingerprint}
          logAnalysisRepository={logAnalysisRepository}
          listParameterConfigSets={listParameterConfigSets}
          parameterRepository={parameterRepository}
          parameterTopologyRepository={parameterTopologyRepository}
          parameterInitializationRepository={parameterInitializationRepository}
          productFeedbackRepository={productFeedbackRepository}
          knowledgeRepository={knowledgeRepository}
          dtsReloadRepository={dtsReloadRepository}
          runtimeMode={runtimeMode}
          userGovernanceActions={userGovernanceActions}
        />
      </ToastProvider>
    </TooltipProvider>
  );
}

function AppShell({
  authClient,
  debuggingAdminClient,
  debuggingGateway,
  initialAppState,
  logAnalysisRepository,
  listParameterConfigSets,
  parameterRepository,
  parameterTopologyRepository,
  parameterInitializationRepository,
  productFeedbackRepository,
  knowledgeRepository,
  dtsReloadRepository,
  runtimeMode,
  userGovernanceActions
}: {
  authClient?: WiseEffAuthClient;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  debuggingGateway?: DebuggingGateway;
  initialAppState: PrototypeState;
  logAnalysisRepository?: LogAnalysisRepository;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  parameterRepository?: ParameterRepository;
  parameterTopologyRepository?: ParameterTopologyRepository;
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
  const [search, setSearch] = useState(() => window.location.search);
  const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
  const [topBarLeadingActions, setTopBarLeadingActions] = useState<ReactNode | null>(null);
  const [projectInitOpen, setProjectInitOpen] = useState(false);
  const [apiAuthStatus, setApiAuthStatus] = useState<ApiAuthStatus>(runtimeMode === "api" ? "checking" : "authenticated");
  const [apiAuthError, setApiAuthError] = useState("");
  const [authProbeAttempt, setAuthProbeAttempt] = useState(0);
  const [apiAuthPermissions, setApiAuthPermissions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  // Below 768px the sidebar becomes an overlay drawer (ui-design-system §Layout);
  // between 769–900px it stays the auto-collapsed rail the media query used to force.
  const isMobileNavViewport = useMediaQuery("(max-width: 768px)");
  const isTabletRailViewport = useMediaQuery("(min-width: 769px) and (max-width: 900px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const effectiveSidebarCollapsed = !isMobileNavViewport && (sidebarCollapsed || isTabletRailViewport);
  const page = getPageByPath(path);
  const pageKeyRef = useRef(page.key);
  const xiaozeContextSummary = useMemo(() => getXiaozeContextSummary(path), [path]);
  const topBarActionsContextValue = useMemo(
    () => ({ setActions: setTopBarActions, setLeadingActions: setTopBarLeadingActions }),
    []
  );
  const isPlatformHome = page.key === "home";
  const isParameterHome = page.key === "parameter-home";
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canAccessCurrentPage = canAccessPage(currentRoleId, page.key);
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
  const appRuntime = useMemo(
    () =>
      createAppRuntime(
        runtimeMode,
        { getState: () => stateRef.current, mockParameterRuntime: mockParameterRuntimeRef.current! },
        {
          authClient,
          parameterRepository,
          parameterTopologyRepository,
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
      authClient,
      parameterRepository,
      parameterTopologyRepository,
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
  const [dashboardState, dashboardDispatch] = useReducer(dashboardReducer, initialDashboardState);
  const dashboardRuntime = useMemo(
    () => createParameterDashboardRuntime({ repository: dashboardRepository, dispatch: dashboardDispatch }),
    [dashboardRepository]
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
  const parameterActions = useMemo<ParameterRuntimeActions>(
    () =>
      createParameterRuntimeActions({
        runtimeMode,
        repository: parameterRepositoryClient,
        dispatch,
        getParameterProjectId: (parameterId) => stateRef.current.parameters.find((parameter) => parameter.id === parameterId)?.projectId
      }),
    [parameterRepositoryClient, runtimeMode]
  );
  const logActions = useMemo<LogRuntimeActions>(
    () =>
      createLogRuntimeActions({
        mode: runtimeMode,
        repository: logAnalysisRepositoryClient,
        dispatch,
        getState: () => stateRef.current
      }),
    [logAnalysisRepositoryClient, runtimeMode]
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
        dtsReloadRepository={dtsReloadRepositoryClient}
        apiAuthPermissions={apiAuthPermissions}
      />
    ),
    [apiAuthPermissions, debuggingAdminCatalogClient, dtsReloadRepositoryClient, runtimeMode]
  );
  const refreshParameterInitializationFromApi = useCallback(async () => {
    if (runtimeMode !== "api") {
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

  const hydrateActiveProjectInitialization = useCallback(
    async (projectId: string) => {
      if (runtimeMode !== "api" || !projectId) {
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

  const submitParameterInitializationViaApi = useCallback(
    async (action: Extract<AppAction, { type: "SUBMIT_PARAMETER_INITIALIZATION" }>) => {
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
        const adminClient = createParameterAdminClient();
        await adminClient.createProject({
          id: projectId,
          name: action.draft.projectName.trim(),
          code: projectCode
        });
        const emptyLibrary =
          !action.draft.primarySourceProjectId || action.draft.sourceProjectIds.length === 0;
        let bindingSnapshots = [] as Awaited<
          ReturnType<ParameterInitializationRepository["previewSnapshot"]>
        >;
        if (!emptyLibrary) {
          bindingSnapshots = await parameterInitializationRepositoryClient.previewSnapshot({
            projectId,
            primarySourceProjectId: action.draft.primarySourceProjectId,
            supplementSourceProjectIds: action.draft.supplementSourceProjectIds,
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
      }
    },
    [parameterInitializationRepositoryClient]
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
        isActive: context.user.isActive,
        createdAt: new Date().toISOString(),
        lastActive: "just now"
      }
    });
  }, []);

  const parameterRuntimeConnectedRef = useRef(false);
  const logRuntimeConnectedRef = useRef(false);
  const debuggingRuntimeConnectedRef = useRef(false);
  const [apiRuntimeFailures, setApiRuntimeFailures] = useState<ReadonlySet<ApiRuntimeDataDomain>>(
    () => new Set()
  );
  const [apiRuntimeSynced, setApiRuntimeSynced] = useState(runtimeMode !== "api");
  const [apiRuntimeRetrying, setApiRuntimeRetrying] = useState(false);

  const refreshApiRuntimeData = useCallback(
    async (cancelledRef?: { current: boolean }, roleId = stateRef.current.activeRoleId) => {
      const runtimeRoleId = migrateLegacyRoleId(roleId);
      const debuggingProtocol = pageKeyRef.current === "node-debugging" ? readInitialNodeDebuggingProtocol() : "hdc";
      const canUseDebugging = canPerform(runtimeRoleId, "debugging.use");
      const debuggingRefresh = canUseDebugging
        ? debuggingActions.refresh({ protocol: debuggingProtocol }, { notifyOnFailure: false })
        : Promise.resolve("skipped" as const);
      const [parameterRefreshResult, logRefreshResult, debuggingRefreshResult] = await Promise.allSettled([
        parameterActions.refresh({ notifyOnFailure: false }),
        logActions.refresh(undefined, { notifyOnFailure: false }),
        debuggingRefresh
      ]);
      if (cancelledRef?.current) return;
      // Failed domains drop to empty slices + a persistent page banner. Demo data
      // must never stand in for live data in API mode.
      const failures = new Set<ApiRuntimeDataDomain>();
      if (
        parameterRefreshResult.status === "rejected" ||
        (parameterRefreshResult.value && "notification" in parameterRefreshResult.value)
      ) {
        failures.add("parameters");
        dispatch({ type: "CLEAR_API_RUNTIME_DOMAIN", domain: "parameters" });
      } else if (!parameterRuntimeConnectedRef.current) {
        parameterRuntimeConnectedRef.current = true;
        dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽参数 API" });
      }
      if (logRefreshResult.status === "rejected") {
        failures.add("logs");
        dispatch({ type: "CLEAR_API_RUNTIME_DOMAIN", domain: "logs" });
      } else if (!logRuntimeConnectedRef.current) {
        logRuntimeConnectedRef.current = true;
        dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽日志 API" });
      }
      if (canUseDebugging) {
        if (debuggingRefreshResult.status === "rejected") {
          failures.add("debugging");
          dispatch({ type: "CLEAR_API_RUNTIME_DOMAIN", domain: "debugging" });
        } else if (!debuggingRuntimeConnectedRef.current) {
          debuggingRuntimeConnectedRef.current = true;
          dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽调试 API" });
        }
      }
      setApiRuntimeFailures(failures);
      setApiRuntimeSynced(true);
    },
    [debuggingActions, logActions, parameterActions]
  );

  const retryApiRuntimeData = useCallback(async () => {
    setApiRuntimeRetrying(true);
    try {
      await refreshApiRuntimeData();
    } finally {
      setApiRuntimeRetrying(false);
    }
  }, [refreshApiRuntimeData]);
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
    void hydrateActiveProjectInitialization(state.activeProjectId);
  }, [hydrateActiveProjectInitialization, state.activeProjectId]);

  useEffect(() => {
    if (runtimeMode !== "api" || apiAuthStatus !== "authenticated") {
      return;
    }
    void refreshParameterInitializationFromApi();
  }, [apiAuthStatus, refreshParameterInitializationFromApi, runtimeMode]);

  useEffect(() => {
    pageKeyRef.current = page.key;
  }, [page.key]);

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
      .then(async (context) => {
        if (cancelledRef.current) return;
        const primaryRoleId = pickPrimaryPlatformRoleId(context.roles.map((role) => role.roleId));
        hydrateAuthContext(context);
        setApiAuthStatus("authenticated");
        setApiAuthError("");
        await refreshApiRuntimeData(cancelledRef, primaryRoleId);
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
  }, [appRuntime.authClient, authProbeAttempt, hydrateAuthContext, refreshApiRuntimeData, runtimeMode]);

  useEffect(() => {
    const syncPathFromHistory = () => {
      if (isStaticDownloadPath(window.location.pathname)) {
        return;
      }
      const nextPage = getPageByPath(window.location.pathname);
      if (nextPage.path !== window.location.pathname) {
        window.history.replaceState(null, "", `${nextPage.path}${window.location.search}`);
      }
      setPath(nextPage.path);
      setSearch(window.location.search);
    };

    syncPathFromHistory();
    window.addEventListener("popstate", syncPathFromHistory);
    return () => {
      window.removeEventListener("popstate", syncPathFromHistory);
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

  const navigate = useCallback((nextPath: string) => {
    const url = new URL(nextPath, window.location.origin);
    if (isStaticDownloadPath(url.pathname)) {
      window.location.assign(url.href);
      return;
    }
    const nextPage = getPageByPath(url.pathname);
    const nextUrl = `${nextPage.path}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl === currentUrl) {
      setPath(nextPage.path);
      return;
    }

    window.history.pushState(null, "", nextUrl);
    setPath(nextPage.path);
    setSearch(url.search);
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
      navigate(nextPath);
    },
    [navigate]
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
      const primaryRoleId = pickPrimaryPlatformRoleId(session.auth.roles.map((role) => role.roleId));
      hydrateAuthContext(session.auth);
      setApiAuthStatus("authenticated");
      setApiAuthError("");
      await refreshApiRuntimeData(undefined, primaryRoleId);
      dispatch({ type: "ADD_NOTIFICATION", message: "已登录雷泽账号" });
    },
    [hydrateAuthContext, refreshApiRuntimeData]
  );

  const handleLogout = useCallback(async () => {
    const client = appRuntime.authClient;
    try {
      await client.logout?.();
    } catch {
      // A failed server-side logout must not trap the user in the app;
      // always clear the local session and return to the login screen.
    }
    clearLocalAuthToken();
    clearSessionDraftsForLogout();
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
      <XiaozeProactiveInsights enabled />
    </div>
  ) : null;

  const apiRuntimeDomainLabels: Record<ApiRuntimeDataDomain, string> = {
    parameters: "参数",
    logs: "日志",
    debugging: "调试"
  };
  const apiRuntimeStatusBanner =
    runtimeMode !== "api" || isPlatformHome ? null : apiRuntimeFailures.size > 0 ? (
      <div className="api-runtime-error-banner" role="alert" aria-live="assertive">
        <AlertTriangle size={18} aria-hidden="true" />
        <div className="api-runtime-error-banner__body">
          <strong>
            无法连接雷泽{[...apiRuntimeFailures].map((domain) => apiRuntimeDomainLabels[domain]).join("、")} API，当前无数据
          </strong>
          <p>为避免误读，连接失败时不展示演示数据；请确认后端服务可用后重试。</p>
        </div>
        <button
          type="button"
          className="button"
          disabled={apiRuntimeRetrying}
          onClick={() => void retryApiRuntimeData()}
        >
          {apiRuntimeRetrying ? "重试中…" : "重试"}
        </button>
      </div>
    ) : !apiRuntimeSynced ? (
      <div className="api-runtime-sync-banner" role="status">
        <LoaderCircle size={16} className="api-runtime-sync-banner__spinner" aria-hidden="true" />
        正在连接雷泽服务，加载真实数据…
      </div>
    ) : null;

  const appShell = (
    <div className={appShellClassName}>
        {!isPlatformHome ? <SkipLink /> : null}
        {!isPlatformHome ? (
          <Sidebar
            activePath={page.path}
            currentRoleId={currentRoleId}
            isCollapsed={effectiveSidebarCollapsed}
            onNavigate={navigateFromSidebar}
            onToggleCollapsed={toggleSidebarCollapsed}
            productFeedbackRepository={productFeedbackRepositoryClient}
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
            onLogout={handleLogout}
            onUpdateCurrentUserProfile={handleUpdateCurrentUserProfile}
            mockNotificationsClient={mockNotificationsClient}
            mobileNavOpen={mobileNavOpen}
            onToggleMobileNav={toggleMobileNav}
          />
        ) : null}
        <TopBarActionsContext.Provider value={topBarActionsContextValue}>
          {isPlatformHome ? (
            <div className="main-content home-content">
              {proactiveInsightsBanner}
              <PageRouter
                page={page}
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
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              />
            </div>
          ) : (
            <main
              id={MAIN_CONTENT_ID}
              className="main-content"
              tabIndex={-1}
              aria-label={isParameterHome ? "参数管理首页" : page.title}
            >
              {apiRuntimeStatusBanner}
              {proactiveInsightsBanner}
              <PageRouter
                page={page}
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
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              />
            </main>
          )}
        </TopBarActionsContext.Provider>
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
          />
        ) : null}
      <AppToastLayer notifications={state.notifications} onDismiss={dismissNotification} />
      </div>
  );

  return runtimeMode === "api" ? (
    <XiaozePageContext.Provider value={xiaozePageContext}>
      <XiaozeProvider enableInspector={enableXiaozeInspector}>{appShell}</XiaozeProvider>
    </XiaozePageContext.Provider>
  ) : (
    appShell
  );
}

function Sidebar({
  activePath,
  currentRoleId,
  isCollapsed,
  onNavigate,
  onToggleCollapsed,
  productFeedbackRepository
}: {
  activePath: string;
  currentRoleId: string;
  isCollapsed: boolean;
  onNavigate: (path: string) => void;
  onToggleCollapsed: () => void;
  productFeedbackRepository: ProductFeedbackRepository;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pageTitle = getPageByPath(activePath).title;
  const activePageKey = getPageByPath(activePath).key;
  const visibleNavigationItems = navigationItems.filter(
    (item) => canAccessPage(currentRoleId, item.key) && isDiscoveryGroupVisible(item.group)
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
          <div className="brand-subtitle">Driven by AI</div>
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
        <Button
          aria-label="问题反馈"
          className="nav-item compact feedback-entry"
          type="button"
          variant="ghost"
          onClick={() => setFeedbackOpen(true)}
        >
          <MessageSquareText size={18} />
          <span>
            <strong>问题反馈</strong>
            <small>内测收集 · 当前页</small>
          </span>
        </Button>
        {utilityItems
          .filter((item) => !item.path || canAccessPage(currentRoleId, getPageByPath(item.path).key))
          .map((item) => {
            const Icon = item.icon;
            const button = (
              <Button
                aria-label={item.label}
                className={
                  item.path && getPageByPath(item.path).key === activePageKey
                    ? "nav-item compact active"
                    : "nav-item compact"
                }
                disabled={!item.path}
                type="button"
                variant="ghost"
                onClick={() => item.path && onNavigate(item.path)}
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
      </div>
      <FeedbackDialog
        open={feedbackOpen}
        pagePath={activePath}
        pageTitle={pageTitle}
        productFeedbackRepository={productFeedbackRepository}
        onOpenChange={setFeedbackOpen}
      />
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
  onLogout,
  onUpdateCurrentUserProfile,
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
  onLogout?: () => Promise<void> | void;
  onUpdateCurrentUserProfile?: (input: UpdateCurrentUserProfileInput) => Promise<void>;
  mockNotificationsClient?: import("@/infrastructure/http/notificationsClient").NotificationsClient;
  mobileNavOpen?: boolean;
  onToggleMobileNav?: () => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pendingProjectSwitch, setPendingProjectSwitch] = useState<{
    projectId: string;
    unsavedCount: number;
  } | null>(null);
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canCreateProject = canPerform(currentRoleId, "parameter.edit");
  const showProjectInitAction =
    page.key.startsWith("parameter") &&
    canCreateProject &&
    page.key !== "parameter-admin" &&
    page.key !== "parameter-home";
  const showProjectSelector = pageUsesProjectScope(page.key) && page.key !== "parameter-home";
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const projectOptions = state.configDraft.projects.map((project) => ({ value: project.id, label: project.name }));
  const selectedProjectId =
    page.key === "parameters" ? new URLSearchParams(search).get("project") || state.activeProjectId : state.activeProjectId;
  const commitProjectChange = (projectId: string) => {
    dispatch({ type: "SET_PROJECT", projectId });

    if (page.key === "parameters") {
      onNavigate(`/parameters?project=${encodeURIComponent(projectId)}`);
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
          <div className="topbar-title">{page.title}</div>
          {pageLeadingActions ? <div className="topbar-page-leading">{pageLeadingActions}</div> : null}
        </div>
        {page.subtitle ? <div className="topbar-subtitle">{page.subtitle}</div> : null}
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
        <div className="topbar-user-switcher">
          <button
            aria-expanded={userMenuOpen}
            aria-haspopup="dialog"
            aria-label="打开用户菜单"
            className="topbar-user-trigger"
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            <span className="avatar topbar-user-avatar" aria-hidden="true">
              <UserRound size={17} />
            </span>
            <span className="topbar-user-summary">
              <strong>{currentUser?.name ?? "演示用户"}</strong>
              <small>{getRequiredRoleLabel(currentRoleId)}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {userMenuOpen ? (
            <div className="topbar-user-menu" aria-label="用户菜单">
              <div className="topbar-user-menu__identity">
                <strong>{currentUser?.name ?? "演示用户"}</strong>
                <span>{currentUser ? userAccountIdentifier(currentUser) : "未选择用户"}</span>
              </div>
              <div className="topbar-user-menu__field topbar-user-menu__role" aria-label="当前用户角色">
                <span>角色</span>
                <strong>{getRequiredRoleLabel(currentRoleId)}</strong>
              </div>
              <div className="topbar-user-menu__actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  个人资料
                </button>
                {onLogout ? (
                  <button type="button" className="button ghost" onClick={() => void onLogout()}>
                    退出登录
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {profileOpen && currentUser && onUpdateCurrentUserProfile ? (
        <ProfileDialog
          user={currentUser}
          onCancel={() => setProfileOpen(false)}
          onSave={async (input) => {
            await onUpdateCurrentUserProfile(input);
            setProfileOpen(false);
          }}
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
  const [formError, setFormError] = useState("");
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistrationDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
        const response = await authClient.register({
          name,
          username,
          roleId,
          password
        });
        if (isPendingRegistrationResponse(response)) {
          setPendingRegistration(response);
          setPassword("");
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

        <div className="auth-mode-tabs" role="tablist" aria-label="认证方式">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => changeMode("login")}>
            登录
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => changeMode("register")}>
            注册
          </button>
        </div>

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
              </>
            ) : null}
            <label>
              <span>用户名</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
            </label>
            <label>
              <span>密码</span>
              <input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required />
            </label>
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

function ProfileDialog({
  user,
  onCancel,
  onSave
}: {
  user: User;
  onCancel: () => void;
  onSave: (input: UpdateCurrentUserProfileInput) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onSave({ name, title });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog open onDismiss={submitting ? undefined : onCancel} className="profile-dialog">
      {({ titleId }) => (
        <form className="modal-form-contents" onSubmit={submit}>
          <header>
            <span className="eyebrow">账号</span>
            <h2 id={titleId}>个人资料</h2>
            <p>{userAccountIdentifier(user)}</p>
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
            <button type="button" className="button profile-dialog__button profile-dialog__button--secondary" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="button primary profile-dialog__button profile-dialog__button--primary" disabled={submitting}>
              保存
            </button>
          </footer>
        </form>
      )}
    </ModalDialog>
  );
}

export default App;
