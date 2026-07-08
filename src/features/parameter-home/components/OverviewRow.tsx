import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { DashboardKpis, DashboardSummary } from "@/domain/parameters/dashboardTypes";
import { Panel } from "./Panel";
import { SectionEmpty, SectionError, SectionSkeleton } from "./SectionState";
import { SituationStrip } from "./SituationStrip";
import { UpdateTrendChart } from "./UpdateTrendChart";

type OverviewRowProps = {
  summaryStatus: SectionStatus;
  summary: DashboardSummary | null;
  kpis: DashboardKpis | null;
  summaryError?: string | null;
  onSummaryRetry: () => void;
};

export function OverviewRow({
  summaryStatus,
  summary,
  kpis,
  summaryError,
  onSummaryRetry
}: OverviewRowProps) {
  return (
    <div className="parameter-home__overview-row">
      <SituationStrip
        variant="sidebar"
        status={summaryStatus}
        kpis={kpis}
        error={summaryError}
        onRetry={onSummaryRetry}
      />
      <Panel title="参数更新趋势" subtitle={summary?.windowLabel} className="parameter-home__panel--trend">
        {summaryStatus === "loading" || summaryStatus === "idle" ? <SectionSkeleton label="加载趋势" /> : null}
        {summaryStatus === "error" ? (
          <SectionError message={summaryError ?? "趋势加载失败"} onRetry={onSummaryRetry} />
        ) : null}
        {summaryStatus === "empty" ? <SectionEmpty message="当前窗口暂无趋势数据" /> : null}
        {summaryStatus === "ready" && summary ? <UpdateTrendChart points={summary.trend} /> : null}
      </Panel>
    </div>
  );
}
