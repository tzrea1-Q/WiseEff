import { useEffect, useState } from "react";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { DashboardHotspot, DashboardSummary, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import type { WorkbenchEmphasis } from "../workbench/derivePersonalWorkbench";
import { useIsAccordionMode } from "@/components/hotspots/useIsAccordionMode";
import { HotspotLeaderboard } from "./HotspotLeaderboard";
import { Panel } from "./Panel";
import { SectionEmpty, SectionError, SectionSkeleton } from "./SectionState";

type InsightSectionProps = {
  emphasis: WorkbenchEmphasis;
  dimension: HotspotDimension;
  hotspotsStatus: SectionStatus;
  summary: DashboardSummary | null;
  hotspots: DashboardHotspot[];
  hotspotsError?: string | null;
  state: PrototypeState;
  onHotspotsRetry: () => void;
  onNavigate: (path: string) => void;
};

export function InsightSection({
  emphasis,
  dimension,
  hotspotsStatus,
  summary,
  hotspots,
  hotspotsError,
  state,
  onHotspotsRetry,
  onNavigate
}: InsightSectionProps) {
  const [expanded, setExpanded] = useState(emphasis === "insight-first");
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const isAccordionMode = useIsAccordionMode(1099);

  useEffect(() => {
    setSelectedHotspotId(null);
  }, [dimension]);

  return (
    <section className="parameter-home__insight" aria-label="洞察分析">
      {emphasis === "action-first" ? (
        <div className="parameter-home__insight-head">
          <button type="button" className="parameter-home__insight-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起洞察" : "展开洞察"}
          </button>
        </div>
      ) : null}

      {expanded ? (
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
      ) : null}
    </section>
  );
}
