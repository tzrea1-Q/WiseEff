import { useEffect, useMemo, useRef, useState } from "react";
import type { createParameterDashboardRuntime } from "@/application/parameters/parameterDashboardRuntime";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { DashboardWindow, HotspotDimension, OverviewScope, WorkbenchSignals } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/domain/prototype/types";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { useTopBarLeadingActions } from "@/components/layout";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { AnalysisContextControls } from "./components/AnalysisContextControls";
import { InsightSection } from "./components/InsightSection";
import { OverviewRow } from "./components/OverviewRow";
import { WorkbenchPageToggle } from "./components/WorkbenchPageToggle";
import { WorkbenchPrimary } from "./components/WorkbenchPrimary";
import { derivePersonalWorkbench } from "./workbench/derivePersonalWorkbench";
import { DEFAULT_WORKBENCH_PAGE, type WorkbenchPage } from "./workbenchPage";
import "./parameter-home.css";

const EMPTY_SIGNALS: WorkbenchSignals = {
  reviewQueue: 0,
  myDrafts: 0,
  returnedChanges: 0,
  waitingMerge: 0,
  unappliedImportBatches: 0,
  inactiveAccounts: 0
};

export type ParameterHomePageProps = {
  state: PrototypeState;
  dashboardState: DashboardState;
  dashboardRuntime: ReturnType<typeof createParameterDashboardRuntime>;
  onDashboardWindowChange: (window: DashboardWindow) => void;
  onDashboardDimensionChange: (dimension: HotspotDimension) => void;
  onDashboardOverviewScopeChange: (scope: OverviewScope) => void;
  onDashboardProjectChange: (projectId: string | null) => void;
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
};

export function ParameterHomePage({
  state,
  dashboardState,
  dashboardRuntime,
  onDashboardWindowChange,
  onDashboardDimensionChange,
  onDashboardOverviewScopeChange,
  onDashboardProjectChange,
  onNavigate,
  onNewProject
}: ParameterHomePageProps) {
  const [workbenchPage, setWorkbenchPage] = useState<WorkbenchPage>(DEFAULT_WORKBENCH_PAGE);
  const [projectDestination, setProjectDestination] = useState<string | null>(null);

  // The dashboard loads when this page mounts or its analysis context changes;
  // the shell no longer watches page.key on the page's behalf.
  useEffect(() => {
    const projectId = dashboardState.projectScope ?? undefined;
    const perspectiveRoleId = migrateLegacyRoleId(state.activeRoleId);
    void dashboardRuntime.loadSummary({ projectId, window: dashboardState.window, perspectiveRoleId });
    void dashboardRuntime.loadHotspots({
      projectId,
      window: dashboardState.window,
      dimension: dashboardState.dimension
    });
  }, [
    dashboardState.projectScope,
    dashboardState.window,
    dashboardState.dimension,
    dashboardRuntime,
    state.activeRoleId
  ]);

  const hotspotsAvailable = dashboardState.hotspots.status === "ready" || dashboardState.hotspots.status === "empty";
  const hotspotCount = hotspotsAvailable ? dashboardState.hotspots.data.length : 0;
  useTopBarLeadingActions(
    <WorkbenchPageToggle
      placement="bar"
      page={workbenchPage}
      hotspotCount={hotspotCount}
      hotspotStatus={dashboardState.hotspots.status}
      onPageChange={setWorkbenchPage}
    />,
    [workbenchPage, hotspotCount, dashboardState.hotspots.status]
  );

  const projectId = dashboardState.projectScope ?? undefined;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const projectOptions = useMemo(
    () => state.configDraft.projects
      // Legacy mock accounts have no scoped bindings; API accounts carry roles.
      .filter((project) => currentUser?.isActive && (currentUser.roles === undefined || currentUser.roles.some(
        (role) => role.projectId === null || role.projectId === project.id
      )))
      .map((project) => ({ value: project.id, label: project.name })),
    [currentUser, state.configDraft.projects]
  );
  const summary = dashboardState.summary.data;
  const hotspots = hotspotsAvailable ? dashboardState.hotspots.data : [];
  const workbench = useMemo(
    () =>
      derivePersonalWorkbench({
        roleId: state.activeRoleId,
        signals: summary?.workbenchSignals ?? EMPTY_SIGNALS,
        projectScope: dashboardState.projectScope,
        activeBindingCount: summary?.kpis.totalBindings,
        hotspotsStatus: dashboardState.hotspots.status,
        changeRequests: state.changeRequests,
        drafts: state.parameterDrafts,
        projects: state.configDraft.projects.map((project) => ({
          id: project.id,
          name: project.name,
          code: project.code
        })),
        hotspots
      }),
    [
      state.activeRoleId,
      dashboardState.projectScope,
      dashboardState.hotspots.status,
      state.changeRequests,
      state.parameterDrafts,
      state.configDraft.projects,
      summary?.workbenchSignals,
      summary?.kpis.totalBindings,
      hotspots
    ]
  );
  const previousRoleViewRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previousRoleViewRef.current === workbench.roleView) return;
    previousRoleViewRef.current = workbench.roleView;
    onDashboardOverviewScopeChange(workbench.roleView === "guest" ? "overall" : "personal");
  }, [workbench.roleView, onDashboardOverviewScopeChange]);

  const reloadSummary = () => {
    void dashboardRuntime.loadSummary({
      projectId,
      window: dashboardState.window,
      perspectiveRoleId: migrateLegacyRoleId(state.activeRoleId)
    });
  };

  const reloadHotspots = () => {
    void dashboardRuntime.loadHotspots({
      projectId,
      window: dashboardState.window,
      dimension: dashboardState.dimension
    });
  };

  const overviewRow = (
    <OverviewRow
      summaryStatus={dashboardState.summary.status}
      summary={summary}
      kpis={summary?.kpis ?? null}
      overviewScope={dashboardState.overviewScope}
      roleView={workbench.roleView}
      onOverviewScopeChange={onDashboardOverviewScopeChange}
      summaryError={dashboardState.summary.error}
      onSummaryRetry={reloadSummary}
    />
  );

  const workbenchPrimary = (
    <WorkbenchPrimary
      workbench={workbench}
      summaryStatus={dashboardState.summary.status}
      summaryError={dashboardState.summary.error}
      onSummaryRetry={reloadSummary}
      onNavigate={(path) => {
        const [pathname, query = ""] = path.split("?", 2);
        if (["/parameters", "/parameter-review", "/parameter-submissions"].includes(pathname)
          && !new URLSearchParams(query).get("project")) {
          setProjectDestination(path);
        } else {
          onNavigate(path);
        }
      }}
      onNewProject={onNewProject}
    />
  );

  const insightSection = (
    <InsightSection
      emphasis={workbench.emphasis}
      dimension={dashboardState.dimension}
      hotspotsStatus={dashboardState.hotspots.status}
      summary={summary}
      hotspots={hotspots}
      hotspotsError={dashboardState.hotspots.error}
      state={state}
      layout="page"
      onHotspotsRetry={reloadHotspots}
    />
  );

  return (
    <section className="parameter-home" aria-label="参数管理首页">
      <ModalDialog open={projectDestination !== null} onDismiss={() => setProjectDestination(null)} className="confirm-dialog" describedBy>
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>选择要查看的项目</h2>
            <p id={descriptionId}>当前卡片汇总全部授权项目。选择项目后查看该项目的参数或待办。</p>
            <div className="flex flex-wrap gap-2">
            {projectOptions.map((project) => (
              <Button key={project.value} type="button" variant="outline" onClick={() => {
                if (!projectDestination) return;
                const [pathname, query = ""] = projectDestination.split("?", 2);
                const params = new URLSearchParams(query);
                params.set("project", project.value);
                setProjectDestination(null);
                onDashboardProjectChange(project.value);
                onNavigate(`${pathname}?${params.toString()}`);
              }}>{project.label}</Button>
            ))}
            </div>
            {projectOptions.length === 0 ? <p>当前没有可查看的项目。</p> : null}
            <Button type="button" variant="ghost" onClick={() => setProjectDestination(null)}>取消</Button>
          </>
        )}
      </ModalDialog>
      <div className="parameter-home__context-bar">
        <AnalysisContextControls
          window={dashboardState.window}
          dimension={dashboardState.dimension}
          projectScope={dashboardState.projectScope}
          projectOptions={projectOptions}
          showHotspotDimension={workbenchPage === "hotspots"}
          onWindowChange={onDashboardWindowChange}
          onDimensionChange={onDashboardDimensionChange}
          onProjectChange={onDashboardProjectChange}
        />
      </div>

      {workbenchPage === "overview" ? (
        <div className="parameter-home__page parameter-home__page--overview" role="tabpanel" aria-label="工作台">
          {overviewRow}
          {workbenchPrimary}
        </div>
      ) : (
        <div className="parameter-home__page parameter-home__page--hotspots" role="tabpanel" aria-label="热榜">
          {insightSection}
        </div>
      )}
    </section>
  );
}
