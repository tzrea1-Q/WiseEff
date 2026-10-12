import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { DashboardKpis, DashboardSummary, OverviewScope } from "@/domain/parameters/dashboardTypes";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";
import { deriveOverviewPresentation } from "../overview/deriveOverviewPresentation";
import { Panel } from "./Panel";
import { SectionEmpty, SectionError, SectionSkeleton } from "./SectionState";
import { SituationStrip } from "./SituationStrip";
import { UpdateTrendChart } from "./UpdateTrendChart";
import { OverviewPage } from "@/components/layout/OverviewPage";
import type { ReactNode } from "react";

type OverviewRowProps = {
  summaryStatus: SectionStatus;
  summary: DashboardSummary | null;
  kpis: DashboardKpis | null;
  overviewScope: OverviewScope;
  roleView: WorkbenchRoleView;
  onOverviewScopeChange: (scope: OverviewScope) => void;
  summaryError?: string | null;
  onSummaryRetry: () => void;
  quickActions?: ReactNode;
};

export function OverviewRow({
  summaryStatus,
  summary,
  kpis,
  overviewScope,
  roleView,
  onOverviewScopeChange,
  summaryError,
  onSummaryRetry,
  quickActions
}: OverviewRowProps) {
  const presentation = deriveOverviewPresentation(
    roleView,
    overviewScope,
    summary?.kpis ?? null,
    summary?.personalKpis ?? null
  );
  const points = overviewScope === "personal" ? summary?.personalTrend ?? [] : summary?.trend ?? [];

  return (
    <OverviewPage label="参数工作台概览" quickActions={quickActions} summary={
      <SituationStrip
        status={summaryStatus}
        kpis={kpis}
        personalKpis={summary?.personalKpis ?? null}
        scope={overviewScope}
        roleView={roleView}
        onScopeChange={onOverviewScopeChange}
        error={summaryError}
        onRetry={onSummaryRetry}
      />
    }>
      <Panel title={presentation.trendTitle} subtitle={summaryStatus === "ready" || summaryStatus === "empty" ? summary?.windowLabel : undefined} className="parameter-home__panel--trend">
        {summaryStatus === "loading" || summaryStatus === "idle" ? <SectionSkeleton label="加载趋势" /> : null}
        {summaryStatus === "error" ? (
          <SectionError message={summaryError ?? "趋势加载失败"} onRetry={onSummaryRetry} />
        ) : null}
        {summaryStatus === "empty" ? <SectionEmpty message="当前窗口暂无趋势数据" /> : null}
        {summaryStatus === "ready" && summary ? (
          <UpdateTrendChart
            points={points}
            changeSeriesName={presentation.changeSeriesName}
            workflowSeriesName={presentation.workflowSeriesName}
          />
        ) : null}
      </Panel>
    </OverviewPage>
  );
}
