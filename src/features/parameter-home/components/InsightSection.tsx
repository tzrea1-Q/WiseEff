import { useState } from "react";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { DashboardHotspot, DashboardSummary, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import type { WorkbenchEmphasis } from "../workbench/derivePersonalWorkbench";
import { useIsAccordionMode } from "@/components/hotspots/useIsAccordionMode";
import { AnalysisContextControls } from "./AnalysisContextControls";
import { HotspotLeaderboard } from "./HotspotLeaderboard";
import { Panel } from "./Panel";
import { ProjectRiskChart } from "./ProjectRiskChart";
import { SectionEmpty, SectionError, SectionSkeleton } from "./SectionState";
import { UpdateTrendChart } from "./UpdateTrendChart";

type InsightSectionProps = {
  emphasis: WorkbenchEmphasis;
  window: DashboardSummary["window"];
  dimension: HotspotDimension;
  summaryStatus: SectionStatus;
  hotspotsStatus: SectionStatus;
  summary: DashboardSummary | null;
  hotspots: DashboardHotspot[];
  summaryError?: string | null;
  hotspotsError?: string | null;
  state: PrototypeState;
  onWindowChange: (window: DashboardSummary["window"]) => void;
  onDimensionChange: (dimension: HotspotDimension) => void;
  onSummaryRetry: () => void;
  onHotspotsRetry: () => void;
  onNavigate: (path: string) => void;
};

export function InsightSection({
  emphasis,
  window,
  dimension,
  summaryStatus,
  hotspotsStatus,
  summary,
  hotspots,
  summaryError,
  hotspotsError,
  state,
  onWindowChange,
  onDimensionChange,
  onSummaryRetry,
  onHotspotsRetry,
  onNavigate
}: InsightSectionProps) {
  const [expanded, setExpanded] = useState(emphasis === "insight-first");
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const isAccordionMode = useIsAccordionMode(1099);

  return (
    <section className="parameter-home__insight" aria-label="洞察分析">
      <div className="parameter-home__insight-head">
        <div>
          <h2>洞察分析</h2>
          <p>{summary?.windowLabel ?? "参数趋势、风险分布与热榜"}</p>
        </div>
        {emphasis === "action-first" ? (
          <button type="button" className="parameter-home__insight-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起洞察" : "展开洞察"}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <>
          <AnalysisContextControls
            window={window}
            dimension={dimension}
            onWindowChange={onWindowChange}
            onDimensionChange={(nextDimension) => {
              onDimensionChange(nextDimension);
              setSelectedHotspotId(null);
            }}
          />

          <div className="parameter-home__charts">
            <Panel title="参数更新趋势" subtitle={summary?.windowLabel}>
              {summaryStatus === "loading" || summaryStatus === "idle" ? <SectionSkeleton label="加载趋势" /> : null}
              {summaryStatus === "error" ? <SectionError message={summaryError ?? "趋势加载失败"} onRetry={onSummaryRetry} /> : null}
              {summaryStatus === "empty" ? <SectionEmpty message="当前窗口暂无趋势数据" /> : null}
              {summaryStatus === "ready" && summary ? <UpdateTrendChart points={summary.trend} /> : null}
            </Panel>

            <Panel title="各项目参数风险分布" subtitle="按风险等级堆叠">
              {summaryStatus === "loading" || summaryStatus === "idle" ? <SectionSkeleton label="加载风险分布" /> : null}
              {summaryStatus === "error" ? <SectionError message={summaryError ?? "风险分布加载失败"} onRetry={onSummaryRetry} /> : null}
              {summaryStatus === "empty" ? <SectionEmpty message="当前暂无项目风险数据" /> : null}
              {summaryStatus === "ready" && summary ? <ProjectRiskChart buckets={summary.riskBuckets} /> : null}
            </Panel>
          </div>

          <Panel
            title="热榜"
            subtitle={summary ? `${summary.windowLabel} · ${hotspots.length} 个热区` : undefined}
          >
            {hotspotsStatus === "loading" || hotspotsStatus === "idle" ? <SectionSkeleton label="加载热榜" /> : null}
            {hotspotsStatus === "error" ? <SectionError message={hotspotsError ?? "热榜加载失败"} onRetry={onHotspotsRetry} /> : null}
            {hotspotsStatus === "empty" ? <SectionEmpty message="当前维度暂无热区数据" /> : null}
            {hotspotsStatus === "ready" ? (
              <HotspotLeaderboard
                hotspots={hotspots}
                selectedId={selectedHotspotId}
                sectionId="parameter-home-hotspots"
                state={state}
                isAccordionMode={isAccordionMode}
                onNavigate={onNavigate}
                onSelectionChange={setSelectedHotspotId}
              />
            ) : null}
          </Panel>
        </>
      ) : null}
    </section>
  );
}
