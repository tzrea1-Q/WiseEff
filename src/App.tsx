import {
  ChevronDown,
  FileText,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound
} from "lucide-react";
import { createPortal } from "react-dom";
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
import { canAccessPage, canPerform } from "@/app/permissions";
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
import { reducer, type AppAction } from "@/application/state/appState";
import { createAppRuntime, type WiseEffAuthClient } from "@/app/appRuntime";

function isStaticDownloadPath(pathname: string) {
  return pathname.startsWith("/downloads/");
}
import { TopBarActionsContext } from "./components/layout";
import { readInitialNodeDebuggingProtocol } from "./NodeDebuggingPage";
import {
  initialState,
  mockDataFingerprint,
  roles
} from "./mockData";
import {
  type DebugParameter,
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
import { createMockRuntimeState, type MockRuntimeState } from "@/infrastructure/mock/mockState";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { UserGovernanceActions } from "@/UserPermissionsPage";

type ApiAuthStatus = "checking" | "authenticated" | "unauthenticated";

function isPendingRegistrationResponse(response: RegisterLocalAccountResponseDto): response is PendingRegistrationDto {
  return "status" in response && response.status === "pending_approval";
}

function authProbeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return ["Authorization bearer token is required.", "Session is not active.", "User is not authenticated."].includes(message) ? "" : message;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "wiseeff.sidebar.collapsed";
const localAuthOrganizations = ["硬件部", "软件部"] as const;
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

export type ParameterValueDraft = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

export type ParameterEditorDraft = {
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  moduleId?: string;
  modulePath?: string[];
  range: string;
  unit: string;
  risk: DebugParameter["risk"];
  valueKind: import("@/powerManagementConfig").ParameterValueKind;
};

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
  dtsReloadRepository?: DtsReloadRepository | null;
  runtimeMode?: WiseEffRuntimeMode;
  userGovernanceActions?: UserGovernanceActions;
};

function App({
  authClient,
  debuggingAdminClient,
  debuggingGateway,
  initialAppState = initialState,
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
  return (
    <TooltipProvider delayDuration={0}>
      <AppShell
        authClient={authClient}
        debuggingAdminClient={debuggingAdminClient}
        debuggingGateway={debuggingGateway}
        initialAppState={initialAppState}
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
  dtsReloadRepository?: DtsReloadRepository | null;
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
  const [debuggingRuntimeReady, setDebuggingRuntimeReady] = useState(runtimeMode !== "api");
  const [apiAuthStatus, setApiAuthStatus] = useState<ApiAuthStatus>(runtimeMode === "api" ? "checking" : "authenticated");
  const [apiAuthError, setApiAuthError] = useState("");
  const [apiAuthPermissions, setApiAuthPermissions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
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
    userGovernanceActions: userGovernanceActionsClient,
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
  const canStartDtsReload = runtimeMode === "api" && apiAuthPermissions.includes("debugging:dts-reload");
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
        const message = error instanceof Error ? error.message : "参数初始化提交失败";
        dispatch({ type: "ADD_NOTIFICATION", message });
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

  const refreshApiRuntimeData = useCallback(
    async (cancelledRef?: { current: boolean }, roleId = stateRef.current.activeRoleId) => {
      const runtimeRoleId = migrateLegacyRoleId(roleId);
      const debuggingProtocol = pageKeyRef.current === "node-debugging" ? readInitialNodeDebuggingProtocol() : "hdc";
      const debuggingRefresh = canPerform(runtimeRoleId, "debugging.use")
        ? debuggingActions.refresh({ protocol: debuggingProtocol })
        : Promise.resolve("skipped" as const);
      const [parameterRefreshResult, logRefreshResult, debuggingRefreshResult] = await Promise.allSettled([
        parameterActions.refresh({ notifyOnFailure: false }),
        logActions.refresh(),
        debuggingRefresh
      ]);
      if (cancelledRef?.current) return;
      if (
        parameterRefreshResult.status === "rejected" ||
        (parameterRefreshResult.value && "notification" in parameterRefreshResult.value)
      ) {
        dispatch({ type: "ADD_NOTIFICATION", message: "无法连接雷泽参数 API，已保留本地演示数据" });
      } else if (!parameterRuntimeConnectedRef.current) {
        parameterRuntimeConnectedRef.current = true;
        dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽参数 API" });
      }
      if (logRefreshResult.status === "rejected") {
        if (
          !(
            logRefreshResult.reason instanceof Error &&
            (logRefreshResult.reason as { alreadyNotified?: unknown }).alreadyNotified === true
          )
        ) {
          dispatch({ type: "ADD_NOTIFICATION", message: "无法加载雷泽日志 API，已保留本地演示数据" });
        }
      } else if (!logRuntimeConnectedRef.current) {
        logRuntimeConnectedRef.current = true;
        dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽日志 API" });
      }
      if (!canPerform(runtimeRoleId, "debugging.use")) {
        setDebuggingRuntimeReady(true);
      } else if (debuggingRefreshResult.status === "rejected") {
        setDebuggingRuntimeReady(false);
        if (
          !(
            debuggingRefreshResult.reason instanceof Error &&
            (debuggingRefreshResult.reason as { alreadyNotified?: unknown }).alreadyNotified === true
          )
        ) {
          dispatch({ type: "ADD_NOTIFICATION", message: "无法加载雷泽调试 API，已保留本地演示数据" });
        }
      } else {
        setDebuggingRuntimeReady(true);
        if (!debuggingRuntimeConnectedRef.current) {
          debuggingRuntimeConnectedRef.current = true;
          dispatch({ type: "ADD_NOTIFICATION", message: "已连接雷泽调试 API" });
        }
      }
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
    void hydrateActiveProjectInitialization(state.activeProjectId);
  }, [hydrateActiveProjectInitialization, state.activeProjectId]);

  useEffect(() => {
    if (runtimeMode !== "api" || apiAuthStatus !== "authenticated") {
      return;
    }
    void refreshParameterInitializationFromApi();
  }, [apiAuthStatus, refreshParameterInitializationFromApi, runtimeMode]);

  useEffect(() => {
    if (page.key !== "parameter-home") {
      return;
    }
    const projectId = dashboardState.projectScope ?? undefined;
    const perspectiveRoleId = migrateLegacyRoleId(state.activeRoleId);
    void dashboardRuntime.loadSummary({ projectId, window: dashboardState.window, perspectiveRoleId });
    void dashboardRuntime.loadHotspots({
      projectId,
      window: dashboardState.window,
      dimension: dashboardState.dimension
    });
  }, [page.key, dashboardState.projectScope, dashboardState.window, dashboardState.dimension, dashboardRuntime, state.activeRoleId]);

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
        clearLocalAuthToken();
        setApiAuthStatus("unauthenticated");
        setApiAuthError(authProbeErrorMessage(error));
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [appRuntime.authClient, hydrateAuthContext, refreshApiRuntimeData, runtimeMode]);

  useEffect(() => {
    if (runtimeMode !== "api" || page.key !== "user-permissions" || !userGovernanceActionsClient || !canPerform(currentRoleId, "users.manage")) {
      return;
    }

    let cancelled = false;
    userGovernanceActionsClient
      .listUsers()
      .then((users) => {
        if (!cancelled) {
          dispatch({ type: "HYDRATE_USERS", users });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "ADD_NOTIFICATION", message: "无法加载雷泽用户 API，已保留本地演示用户" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRoleId, page.key, runtimeMode, userGovernanceActionsClient]);

  useEffect(() => {
    if (runtimeMode !== "api" || page.key !== "node-debugging") {
      return;
    }
    if (!canPerform(currentRoleId, "debugging.use")) {
      return;
    }

    let cancelled = false;
    const protocol = readInitialNodeDebuggingProtocol();
    void debuggingActions
      .refresh({ protocol })
      .then(() => {
        if (!cancelled) {
          setDebuggingRuntimeReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDebuggingRuntimeReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRoleId, debuggingActions, page.key, runtimeMode]);

  useEffect(() => {
    const syncPathFromHistory = () => {
      if (isStaticDownloadPath(window.location.pathname)) {
        return;
      }
      const nextPage = getPageByPath(window.location.pathname);
      if (nextPage.path !== window.location.pathname) {
        window.history.replaceState(null, "", nextPage.path);
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

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

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
    : sidebarCollapsed
      ? "app-shell sidebar-is-collapsed"
      : "app-shell";

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

  const enableXiaozeInspector = canPerform(currentRoleId, "admin.access");
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

  const appShell = (
    <div className={appShellClassName}>
        {!isPlatformHome ? (
          <Sidebar
            activePath={page.path}
            currentRoleId={currentRoleId}
            isCollapsed={sidebarCollapsed}
            onNavigate={navigate}
            onToggleCollapsed={toggleSidebarCollapsed}
            productFeedbackRepository={productFeedbackRepositoryClient}
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
                debuggingRuntimeReady={debuggingRuntimeReady}
                logActions={logActions}
                parameterActions={parameterActions}
                runtime={appRuntime}
                knowledgeCapability={knowledgeCapability}
                canStartDtsReload={canStartDtsReload}
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
                DebuggingAdminPage={DebuggingAdminPageWithRuntime}
              />
            </div>
          ) : (
            <main className="main-content" aria-label={isParameterHome ? "参数管理首页" : undefined}>
              {proactiveInsightsBanner}
              <PageRouter
                page={page}
                state={state}
                dispatch={dispatch}
                onNavigate={navigate}
                onNewProject={() => setProjectInitOpen(true)}
                debuggingActions={debuggingActions}
                debuggingRuntimeReady={debuggingRuntimeReady}
                logActions={logActions}
                parameterActions={parameterActions}
                runtime={appRuntime}
                knowledgeCapability={knowledgeCapability}
                canStartDtsReload={canStartDtsReload}
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
  const visibleNavigationItems = navigationItems.filter((item) => canAccessPage(currentRoleId, item.key));
  const groups = visibleNavigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = isCollapsed ? "展开侧边栏" : "收起侧边栏";

  return (
    <aside aria-label="主导航侧边栏" className={isCollapsed ? "sidebar sidebar-collapsed" : "sidebar sidebar-expanded"}>
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
                className={item.path === activePath ? "nav-item compact active" : "nav-item compact"}
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
  mockNotificationsClient
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
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canCreateProject = canPerform(currentRoleId, "parameter.edit");
  const showProjectInitAction =
    page.key.startsWith("parameter") &&
    canCreateProject &&
    page.key !== "parameter-admin" &&
    page.key !== "parameter-home";
  const showProjectSelector = pageUsesProjectScope(page.key) && page.key !== "parameter-home";
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const currentRole = roles.find((role) => role.id === currentRoleId);
  const projectOptions = state.configDraft.projects.map((project) => ({ value: project.id, label: project.name }));
  const selectedProjectId =
    page.key === "parameters" ? new URLSearchParams(search).get("project") || state.activeProjectId : state.activeProjectId;
  const handleProjectChange = (projectId: string) => {
    dispatch({ type: "SET_PROJECT", projectId });

    if (page.key === "parameters") {
      onNavigate(`/parameters?project=${encodeURIComponent(projectId)}`);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-page">
        <div className="topbar-page-head">
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
              <strong>{currentUser?.name ?? "Prototype user"}</strong>
              <small>{currentRole?.name ?? "Guest"}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {userMenuOpen ? (
            <div className="topbar-user-menu" aria-label="用户菜单">
              <div className="topbar-user-menu__identity">
                <strong>{currentUser?.name ?? "Prototype user"}</strong>
                <span>{currentUser ? userAccountIdentifier(currentUser) : "No user selected"}</span>
              </div>
              <div className="topbar-user-menu__field topbar-user-menu__role" aria-label="当前用户角色">
                <span>Role</span>
                <strong>{currentRole?.name ?? "Guest"}</strong>
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
  const [organization, setOrganization] = useState<(typeof localAuthOrganizations)[number]>("硬件部");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState<PlatformRoleId>("hardware-user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistrationDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const organizationOptions = useMemo(
    () => localAuthOrganizations.map((value) => ({ value, label: value })),
    []
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
          organization,
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
      setFormError(submitError instanceof Error ? submitError.message : "认证请求失败。");
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
            <p className="eyebrow">Pending Approval</p>
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
                  <span>组织</span>
                  <SelectControl
                    id="local-auth-organization"
                    value={organization}
                    onValueChange={setOrganization}
                    options={organizationOptions}
                    ariaLabel="组织"
                    className="auth-select-control"
                  />
                </label>
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

  return createPortal(
    <div className="modal-backdrop profile-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <form className="profile-dialog" onSubmit={submit}>
        <header>
          <span className="eyebrow">Account</span>
          <h2 id="profile-dialog-title">个人资料</h2>
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
    </div>,
    document.body
  );
}


export default App;
