import type { Dispatch, ReactNode } from "react";

import type {
  ApplyParameterImportBatchInput,
  DiscardParameterDraftsInput,
  DtsImportParseResult,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParseDtsImportInput,
  ReviewParameterChangeInput,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import type {
  ParameterRuntimeActionFailure,
  ParameterRuntimeActions,
  ParameterRuntimeRefreshOptions,
  ParameterRuntimeRefreshResult,
  ParameterRuntimeVoidResult
} from "@/application/parameters/parameterRuntime";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { createParameterDashboardRuntime } from "@/application/parameters/parameterDashboardRuntime";
import type { DebuggingRuntimeActions } from "@/application/debugging/debuggingRuntime";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { LogRuntimeActions } from "@/application/logs/logRuntime";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import { resolveDtsReloadRepository } from "@/application/dts-reload/dtsReloadRuntime";
import { createMockDtsReloadBridgeSeams } from "@/infrastructure/mock/mockDtsReloadRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import type { AppAction } from "@/application/state/appState";
import type { DashboardWindow, HotspotDimension, OverviewScope } from "@/domain/parameters/dashboardTypes";
import { canAccessPage, canPerform, getAccessibleFallbackPath, getRequiredRoleForPage, getRequiredRoleLabel } from "@/app/permissions";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { AuditCenterPage } from "@/AuditCenterPage";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { LinearTemplateHome } from "@/linear-template/LinearTemplateHome";
import { LogDashboardPage } from "@/features/log-analysis/LogDashboardPage";
import { LogsPage } from "@/features/log-analysis/LogsPage";
import { ParameterReviewPage } from "@/features/parameter-review/ParameterReviewPage";
import { ParameterSubmissionsPage } from "@/features/parameter-review/ParameterSubmissionsPage";
import { LogAdminPage } from "@/LogAdminPage";
import { NodeDebuggingPage } from "@/NodeDebuggingPage";
import { PlatformConsolePage } from "@/PlatformConsolePage";
import { ParameterAdminNextPage } from "@/ParameterAdminNextPage";
import { ParameterHomePage } from "@/features/parameter-home/ParameterHomePage";
import { FeedbackAdminPage } from "@/features/product-feedback/FeedbackAdminPage";
import { KnowledgeAdminPage } from "@/features/knowledge/KnowledgeAdminPage";
import { KnowledgePage } from "@/features/knowledge/KnowledgePage";
import { DtsReloadPage } from "@/features/dts-reload/DtsReloadPage";
import { ParametersPage as UserParametersPage } from "@/ParametersPage";
import { UserPermissionsPage } from "@/UserPermissionsPage";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { NoEntryPage } from "@/components/NoEntryPage";
import type { PageConfig } from "@/appConfig";
import type { PrototypeState } from "@/domain/prototype/types";
import type { ParameterDraftItem, ParameterRecord } from "@/domain/parameters/types";

const NodeDebuggingPageWithRuntimeProps = NodeDebuggingPage as (
  props: Pick<PageProps, "state" | "debuggingActions"> & { runtimeReady?: boolean }
) => ReactNode;

export type ParameterPageActions = {
  getParameter(parameterId: string): Promise<ParameterRecord>;
  submitChanges(input: SubmitParameterChangesInput): Promise<ParameterRuntimeVoidResult>;
  stashChanges(items: ParameterDraftItem[]): Promise<ParameterRuntimeVoidResult>;
  discardDrafts(input: DiscardParameterDraftsInput): Promise<ParameterRuntimeVoidResult>;
  withdrawSubmissionRound(roundId: string): Promise<ParameterRuntimeVoidResult>;
  reviewChange(input: ReviewParameterChangeInput): Promise<ParameterRuntimeVoidResult>;
  listWorkflowAssignees?: ParameterRuntimeActions["listWorkflowAssignees"];
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
  refresh(options?: ParameterRuntimeRefreshOptions): Promise<ParameterRuntimeRefreshResult>;
};

export type PageProps = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  debuggingActions?: DebuggingRuntimeActions;
  debuggingGateway?: DebuggingGateway;
  debuggingRuntimeReady?: boolean;
  logActions?: LogRuntimeActions;
  parameterActions?: ParameterPageActions;
  parameterTopologyRepository?: ParameterTopologyRepository;
  listParameterConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  productFeedbackRepository?: ProductFeedbackRepository;
  knowledgeRepository?: KnowledgeRepository;
  knowledgeCapability?: KnowledgeCapability;
  /** Resolved by the App composition root for both runtimes (ADR-0002). */
  dtsReloadRepository?: DtsReloadRepository;
  canStartDtsReload?: boolean;
  parameterInitializationRepository?: ParameterInitializationRepository;
  userGovernanceActions?: UserGovernanceActions;
  runtimeMode?: WiseEffRuntimeMode;
  dashboardState?: DashboardState;
  dashboardRuntime?: ReturnType<typeof createParameterDashboardRuntime>;
  onDashboardWindowChange?: (window: DashboardWindow) => void;
  onDashboardDimensionChange?: (dimension: HotspotDimension) => void;
  onDashboardOverviewScopeChange?: (scope: OverviewScope) => void;
  onDashboardProjectChange?: (projectId: string | null) => void;
};

/**
 * Stable mock bridge seams for `/dts-reload` in mock mode. Created once so re-renders do
 * not churn the LocalDeviceBridgePanel override identities (and thus its refresh effect).
 */
let cachedMockDtsReloadBridgeSeams: ReturnType<typeof createMockDtsReloadBridgeSeams> | null = null;
function mockDtsReloadBridgeSeams() {
  cachedMockDtsReloadBridgeSeams ??= createMockDtsReloadBridgeSeams();
  return cachedMockDtsReloadBridgeSeams;
}

export type PageRouterProps = PageProps & {
  page: PageConfig;
  onNewProject?: () => void;
  TopBarProjectId?: string;
  DebuggingAdminPage: (props: PageProps & { area?: "parameter" | "nodes" }) => ReactNode;
};

export function PageRouter({
  page,
  state,
  dispatch,
  onNavigate,
  search,
  debuggingActions,
  debuggingGateway,
  debuggingRuntimeReady = true,
  logActions,
  parameterActions,
  parameterTopologyRepository,
  listParameterConfigSets,
  productFeedbackRepository,
  knowledgeRepository,
  knowledgeCapability,
  dtsReloadRepository,
  canStartDtsReload = false,
  parameterInitializationRepository,
  userGovernanceActions,
  runtimeMode,
  dashboardState,
  dashboardRuntime,
  onDashboardWindowChange,
  onDashboardDimensionChange,
  onDashboardOverviewScopeChange,
  onDashboardProjectChange,
  onNewProject,
  TopBarProjectId,
  DebuggingAdminPage
}: PageRouterProps) {
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const searchProjectId = new URLSearchParams(search).get("project") ?? "";
  const effectiveParametersProjectId = searchProjectId || state.activeProjectId;
  const activeProjectInitializationStatus =
    state.projectInitializationStatuses[effectiveParametersProjectId] ?? "initialized";
  const canEditParameters =
    canPerform(currentRoleId, "parameter.edit") &&
    (activeProjectInitializationStatus === "initialized" || activeProjectInitializationStatus === "maintenance");

  if (!canAccessPage(currentRoleId, page.key)) {
    const requiredRole = getRequiredRoleForPage(page.key);
    return (
      <section className="permission-denied-page" aria-label="Permission denied">
        <span className="eyebrow">Access control</span>
        <h2>Permission denied</h2>
        <p>Current role: {getRequiredRoleLabel(currentRoleId)}</p>
        <p>Required role: {getRequiredRoleLabel(requiredRole)}</p>
        <button
          className="button primary permission-denied-action"
          type="button"
          onClick={() => onNavigate(getAccessibleFallbackPath(currentRoleId))}
        >
          Back to accessible workspace
        </button>
      </section>
    );
  }

  switch (page.key) {
    case "parameters":
      return (
        <UserParametersPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={search}
          parameterActions={parameterActions}
          topologyRepository={parameterTopologyRepository}
          listConfigSets={listParameterConfigSets}
          effectiveProjectId={effectiveParametersProjectId}
          canEdit={canEditParameters}
          initializationStatus={activeProjectInitializationStatus}
          topBarProjectId={TopBarProjectId ?? effectiveParametersProjectId}
          runtimeMode={runtimeMode}
        />
      );
    case "parameter-submissions":
      return <ParameterSubmissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} parameterActions={parameterActions} />;
    case "parameter-home":
      return (
        <ParameterHomePage
          state={state}
          dashboardState={dashboardState!}
          dashboardRuntime={dashboardRuntime!}
          onDashboardWindowChange={onDashboardWindowChange!}
          onDashboardDimensionChange={onDashboardDimensionChange!}
          onDashboardOverviewScopeChange={onDashboardOverviewScopeChange!}
          onDashboardProjectChange={onDashboardProjectChange!}
          onNavigate={onNavigate}
          onNewProject={onNewProject}
        />
      );
    case "parameter-comparison":
      return (
        <NoEntryPage
          title="页面不可用"
          description="独立参数对比页面已下线，请回到参数工作台通过参数行的查看按钮查看跨项目对比。"
          actionLabel="参数工作台"
          actionPath="/parameters"
          onNavigate={onNavigate}
        />
      );
    case "parameter-review":
      return (
        <ParameterReviewPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={search}
          parameterActions={parameterActions}
          parameterInitializationRepository={parameterInitializationRepository}
          runtimeMode={runtimeMode}
        />
      );
    case "parameter-admin": {
      const isProjectsArea =
        page.path === "/parameter-admin/projects" || page.path.startsWith("/parameter-admin/projects/");
      return (
        <ParameterAdminNextPage
          area={isProjectsArea ? "projects" : "organization"}
          onNavigate={onNavigate}
          search={search}
          pathname={page.path}
          runtimeMode={runtimeMode}
          parameterTopologyRepository={parameterTopologyRepository}
          projects={state.configDraft.projects}
          parameters={state.parameters}
          activeProjectId={state.activeProjectId}
          dispatch={dispatch}
          parameterActions={parameterActions}
          state={state}
          onNewProject={onNewProject}
        />
      );
    }
    case "log-dashboard":
      return <LogDashboardPage state={state} onNavigate={onNavigate} />;
    case "logs":
      return (
        <LogsPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={search}
          logActions={runtimeMode === "api" ? logActions : undefined}
          parameterActions={parameterActions}
        />
      );
    case "log-admin":
      return <LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} logActions={logActions} />;
    case "feedback-admin":
      return productFeedbackRepository ? <FeedbackAdminPage productFeedbackRepository={productFeedbackRepository} /> : null;
    case "knowledge":
      return knowledgeRepository && knowledgeCapability ? (
        <KnowledgePage repository={knowledgeRepository} capability={knowledgeCapability} />
      ) : null;
    case "knowledge-admin":
      return knowledgeRepository && knowledgeCapability ? (
        <KnowledgeAdminPage repository={knowledgeRepository} canManage={knowledgeCapability.canManage} />
      ) : null;
    case "debugging":
      return (
        <NoEntryPage
          title="页面暂时不可用"
          description="参数调试工作区已下线。请使用节点调试读写设备节点，或在调试管理后台维护可调节点目录。"
          actionLabel="节点调试"
          actionPath="/node-debugging"
          onNavigate={onNavigate}
        />
      );
    case "node-debugging":
      return (
        <NodeDebuggingPageWithRuntimeProps
          state={state}
          debuggingActions={runtimeMode === "api" ? debuggingActions : undefined}
          runtimeReady={runtimeMode === "api" ? debuggingRuntimeReady : true}
        />
      );
    case "dts-reload": {
      const mockSeams = runtimeMode === "api" ? null : mockDtsReloadBridgeSeams();
      return (
        <DtsReloadPage
          projects={state.configDraft.projects.map((project) => ({ id: project.id, name: project.name }))}
          initialProjectId={state.activeProjectId}
          repository={dtsReloadRepository ?? resolveDtsReloadRepository(runtimeMode)}
          canStartRun={canStartDtsReload}
          bridges={mockSeams?.bridges}
          probeBridgeHealth={mockSeams?.probeBridgeHealth}
          detectTargets={
            mockSeams
              ? mockSeams.detectTargets
              : debuggingGateway
                ? async (protocol) => {
                    const targets = await debuggingGateway.detectTargets({ protocol });
                    return targets
                      .filter((target) => Boolean(target.targetRef?.trim()))
                      .map((target) => ({
                        targetRef: target.targetRef!.trim(),
                        label: target.bridgeMachineLabel?.trim()
                          ? `${target.bridgeMachineLabel.trim()} · ${target.targetRef!.trim()}`
                          : target.label || target.targetRef!.trim(),
                        bridgeId: target.bridgeId
                      }));
                  }
                : undefined
          }
        />
      );
    }
    case "debugging-admin": {
      const area =
        page.path === "/debugging-admin/nodes" || page.path.startsWith("/debugging-admin/nodes/")
          ? "nodes"
          : "parameter";
      return (
        <DebuggingAdminPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={search}
          debuggingActions={debuggingActions}
          debuggingGateway={debuggingGateway}
          logActions={logActions}
          parameterActions={parameterActions}
          area={area}
        />
      );
    }
    case "user-permissions":
      return <UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} userGovernanceActions={userGovernanceActions} />;
    case "audit":
      return <AuditCenterPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} runtimeMode={runtimeMode} />;
    case "platform-console":
      return <PlatformConsolePage />;
    default:
      return <LinearTemplateHome />;
  }
}
