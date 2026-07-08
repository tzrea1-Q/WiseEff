import { useEffect, useMemo, useRef, useState } from "react";
import type { createParameterDashboardRuntime } from "@/application/parameters/parameterDashboardRuntime";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { DashboardWindow, HotspotDimension, OverviewScope, WorkbenchSignals } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { useTopBarLeadingActions } from "@/components/layout";
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

  const hotspotCount = dashboardState.hotspots.data?.length ?? 0;
  useTopBarLeadingActions(
    <WorkbenchPageToggle
      placement="bar"
      page={workbenchPage}
      hotspotCount={hotspotCount}
      onPageChange={setWorkbenchPage}
    />,
    [workbenchPage, hotspotCount]
  );

  const projectId = dashboardState.projectScope ?? undefined;
  const projectOptions = useMemo(
    () => state.configDraft.projects.map((project) => ({ value: project.id, label: project.name })),
    [state.configDraft.projects]
  );
  const summary = dashboardState.summary.data;
  const hotspots = dashboardState.hotspots.data;
  const workbench = useMemo(
    () =>
      derivePersonalWorkbench({
        roleId: state.activeRoleId,
        signals: summary?.workbenchSignals ?? EMPTY_SIGNALS,
        changeRequests: state.changeRequests,
        drafts: state.parameterDrafts,
        projects: state.configDraft.projects.map((project) => ({
          id: project.id,
          name: project.name,
          code: project.code
        })),
        hotspots
      }),
    [state.activeRoleId, state.changeRequests, state.parameterDrafts, state.configDraft.projects, summary?.workbenchSignals, hotspots]
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
    <WorkbenchPrimary workbench={workbench} onNavigate={onNavigate} onNewProject={onNewProject} />
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
