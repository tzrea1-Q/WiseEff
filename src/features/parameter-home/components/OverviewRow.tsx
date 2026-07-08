import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { DashboardKpis, DashboardSummary, OverviewScope } from "@/domain/parameters/dashboardTypes";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";
import { deriveOverviewPresentation } from "../overview/deriveOverviewPresentation";
import { Panel } from "./Panel";
import { SectionEmpty, SectionError, SectionSkeleton } from "./SectionState";
import { SituationStrip } from "./SituationStrip";
import { UpdateTrendChart } from "./UpdateTrendChart";

type OverviewRowProps = {
  summaryStatus: SectionStatus;
  summary: DashboardSummary | null;
  kpis: DashboardKpis | null;
  overviewScope: OverviewScope;
  roleView: WorkbenchRoleView;
  onOverviewScopeChange: (scope: OverviewScope) => void;
  summaryError?: string | null;
  onSummaryRetry: () => void;
};

export function OverviewRow({
  summaryStatus,
  summary,
  kpis,
  overviewScope,
  roleView,
  onOverviewScopeChange,
  summaryError,
  onSummaryRetry
}: OverviewRowProps) {
  const presentation = deriveOverviewPresentation(
    roleView,
    overviewScope,
    summary?.kpis ?? null,
    summary?.personalKpis ?? null
  );
  const points = overviewScope === "personal" ? summary?.personalTrend ?? [] : summary?.trend ?? [];

  return (
    <div className="parameter-home__overview-row">
      <SituationStrip
        variant="sidebar"
        status={summaryStatus}
        kpis={kpis}
        personalKpis={summary?.personalKpis ?? null}
        scope={overviewScope}
        roleView={roleView}
        onScopeChange={onOverviewScopeChange}
        error={summaryError}
        onRetry={onSummaryRetry}
      />
      <Panel title={presentation.trendTitle} subtitle={summary?.windowLabel} className="parameter-home__panel--trend">
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
    </div>
  );
}
