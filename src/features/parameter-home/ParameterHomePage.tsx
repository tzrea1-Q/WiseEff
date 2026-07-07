import { useMemo } from "react";
import type { createParameterDashboardRuntime } from "@/application/parameters/parameterDashboardRuntime";
import type { DashboardState } from "@/application/parameters/dashboardState";
import type { DashboardWindow, HotspotDimension, WorkbenchSignals } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import { useTopBarActions } from "@/components/layout";
import { AnalysisContextControls } from "./components/AnalysisContextControls";
import { InsightSection } from "./components/InsightSection";
import { SituationStrip } from "./components/SituationStrip";
import { WorkbenchPrimary } from "./components/WorkbenchPrimary";
import { derivePersonalWorkbench } from "./workbench/derivePersonalWorkbench";
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
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
};

export function ParameterHomePage({
  state,
  dashboardState,
  dashboardRuntime,
  onDashboardWindowChange,
  onDashboardDimensionChange,
  onNavigate,
  onNewProject
}: ParameterHomePageProps) {
  useTopBarActions(null, []);

  const projectId = state.activeProjectId || undefined;
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

  const reloadSummary = () => {
    void dashboardRuntime.loadSummary({ projectId, window: dashboardState.window });
  };

  const reloadHotspots = () => {
    void dashboardRuntime.loadHotspots({
      projectId,
      window: dashboardState.window,
      dimension: dashboardState.dimension
    });
  };

  const situationStrip = (
    <SituationStrip
      status={dashboardState.summary.status}
      kpis={summary?.kpis ?? null}
      error={dashboardState.summary.error}
      onRetry={reloadSummary}
    />
  );

  const workbenchPrimary = (
    <WorkbenchPrimary workbench={workbench} onNavigate={onNavigate} onNewProject={onNewProject} />
  );

  const insightSection = (
    <InsightSection
      emphasis={workbench.emphasis}
      window={dashboardState.window}
      dimension={dashboardState.dimension}
      summaryStatus={dashboardState.summary.status}
      hotspotsStatus={dashboardState.hotspots.status}
      summary={summary}
      hotspots={hotspots}
      summaryError={dashboardState.summary.error}
      hotspotsError={dashboardState.hotspots.error}
      state={state}
      onWindowChange={onDashboardWindowChange}
      onDimensionChange={onDashboardDimensionChange}
      onSummaryRetry={reloadSummary}
      onHotspotsRetry={reloadHotspots}
      onNavigate={onNavigate}
    />
  );

  return (
    <section className="parameter-home" aria-label="参数管理首页">
      <div className="parameter-home__context-bar">
        <AnalysisContextControls
          window={dashboardState.window}
          dimension={dashboardState.dimension}
          onWindowChange={onDashboardWindowChange}
          onDimensionChange={onDashboardDimensionChange}
        />
      </div>

      {workbench.emphasis === "action-first" ? (
        <>
          {workbenchPrimary}
          {situationStrip}
          {insightSection}
        </>
      ) : (
        <>
          {situationStrip}
          {insightSection}
          {workbenchPrimary}
        </>
      )}
    </section>
  );
}
