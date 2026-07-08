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
  layout?: "embedded" | "page";
  onHotspotsRetry: () => void;
};

export function InsightSection({
  emphasis,
  dimension,
  hotspotsStatus,
  summary,
  hotspots,
  hotspotsError,
  state,
  layout = "embedded",
  onHotspotsRetry
}: InsightSectionProps) {
  const [expanded, setExpanded] = useState(emphasis === "insight-first" || layout === "page");
  const [expandedHotspotIds, setExpandedHotspotIds] = useState<string[]>([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const isViewportAccordion = useIsAccordionMode(1099);
  const isAccordionMode = layout === "page" || isViewportAccordion;

  useEffect(() => {
    setExpandedHotspotIds([]);
    setSelectedHotspotId(null);
  }, [dimension]);

  const toggleHotspotExpanded = (id: string) => {
    setExpandedHotspotIds((current) =>
      current.includes(id) ? current.filter((hotspotId) => hotspotId !== id) : [...current, id]
    );
  };

  return (
    <section
      className={layout === "page" ? "parameter-home__insight parameter-home__insight--page" : "parameter-home__insight"}
      aria-label={layout === "page" ? "热榜" : "洞察分析"}
    >
      {layout === "embedded" && emphasis === "action-first" ? (
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
                expandedIds={expandedHotspotIds}
                sectionId="parameter-home-hotspots"
                state={state}
                isAccordionMode={isAccordionMode}
                onSelectionChange={setSelectedHotspotId}
                onToggleExpanded={toggleHotspotExpanded}
              />
            ) : null}
        </Panel>
      ) : null}
    </section>
  );
}
