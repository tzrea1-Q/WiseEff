import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import { computeEyebrow } from "@/hotspotPresentation";
import { cn } from "@/lib/utils";
import { HotspotScorePanel } from "./HotspotScorePanel";

const SCORE_CEILING = 250;

type HotspotLeaderboardProps = {
  hotspots: DashboardHotspot[];
  selectedId: string | null;
  expandedIds: string[];
  sectionId: string;
  state: PrototypeState;
  isAccordionMode: boolean;
  onSelectionChange: (id: string | null) => void;
  onToggleExpanded: (id: string) => void;
};

export function HotspotLeaderboard({
  hotspots,
  selectedId,
  expandedIds,
  sectionId,
  state,
  isAccordionMode,
  onSelectionChange,
  onToggleExpanded
}: HotspotLeaderboardProps) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedHotspot = selectedId ? hotspots.find((hotspot) => hotspot.id === selectedId) ?? null : null;
  const effectiveSelected = isAccordionMode ? selectedHotspot : selectedHotspot ?? hotspots[0] ?? null;
  const dimensionCeiling = getDimensionCeiling(hotspots);

  if (!isAccordionMode && !effectiveSelected) {
    return <div className="parameter-home__hotspot-empty">暂无可展示的热区。</div>;
  }

  if (isAccordionMode && hotspots.length === 0) {
    return <div className="parameter-home__hotspot-empty">暂无可展示的热区。</div>;
  }

  const selectByIndex = (index: number) => {
    const hotspot = hotspots[index];
    if (!hotspot) {
      return;
    }

    if (isAccordionMode) {
      onToggleExpanded(hotspot.id);
      return;
    }

    onSelectionChange(hotspot.id);
  };

  const onKeyDownFor =
    (index: number) =>
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = hotspots.length - 1;
      const focusIndex = (nextIndex: number) => {
        event.preventDefault();
        rowRefs.current[nextIndex]?.focus();
      };

      if (event.key === "ArrowDown") {
        focusIndex(Math.min(index + 1, lastIndex));
      } else if (event.key === "ArrowUp") {
        focusIndex(Math.max(index - 1, 0));
      } else if (event.key === "Home") {
        focusIndex(0);
      } else if (event.key === "End") {
        focusIndex(lastIndex);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectByIndex(index);
      }
    };

  return (
    <div className="parameter-home__hotspot-layout" data-accordion={isAccordionMode ? "true" : "false"}>
      <div className="parameter-home__hotspot-leaderboard">
        <div className="parameter-home__hotspot-board">
          <div className="parameter-home__hotspot-list-head" role="presentation">
            <span className="parameter-home__hotspot-col-rank">
              <span className="parameter-home__hotspot-rank-dot parameter-home__hotspot-rank-dot--placeholder" aria-hidden="true" />
              排名
            </span>
            <span className="parameter-home__hotspot-col-identity">对象</span>
            <span className="parameter-home__hotspot-col-status">状态</span>
            <span className="parameter-home__hotspot-col-score">热度</span>
            <span className="parameter-home__hotspot-col-trend">
              趋势
              {isAccordionMode ? (
                <ChevronRight
                  aria-hidden="true"
                  className="parameter-home__hotspot-row-chevron parameter-home__hotspot-row-chevron--placeholder"
                  size={16}
                />
              ) : null}
            </span>
          </div>
          <ul className="parameter-home__hotspot-list" role="list">
          {hotspots.map((hotspot, index) => {
            const expanded = isAccordionMode ? expandedIds.includes(hotspot.id) : hotspot.id === effectiveSelected?.id;
            const panelId = `${sectionId}-panel-${hotspot.id}`;

            return (
              <HotspotRow
                key={hotspot.id}
                hotspot={hotspot}
                rank={index + 1}
                eyebrow={computeEyebrow(hotspot, state)}
                expanded={expanded}
                panelId={panelId}
                isAccordionMode={isAccordionMode}
                tabIndex={expanded || (!isAccordionMode && hotspot.id === effectiveSelected?.id) ? 0 : -1}
                rowSelectRef={(element) => {
                  rowRefs.current[index] = element;
                }}
                onSelect={() => selectByIndex(index)}
                onKeyDown={onKeyDownFor(index)}
              >
                {isAccordionMode && expanded ? (
                  <HotspotScorePanel
                    hotspot={hotspot}
                    dimensionCeiling={dimensionCeiling}
                    sectionId={`${sectionId}-${hotspot.id}`}
                    variant="accordion"
                  />
                ) : null}
              </HotspotRow>
            );
          })}
          </ul>
        </div>
      </div>
      {!isAccordionMode && effectiveSelected ? (
        <HotspotScorePanel
          hotspot={effectiveSelected}
          dimensionCeiling={dimensionCeiling}
          sectionId={sectionId}
          variant="desktop"
        />
      ) : null}
    </div>
  );
}

function HotspotRow({
  hotspot,
  rank,
  eyebrow,
  expanded,
  panelId,
  isAccordionMode,
  tabIndex,
  rowSelectRef,
  onSelect,
  onKeyDown,
  children
}: {
  hotspot: DashboardHotspot;
  rank: number;
  eyebrow: string;
  expanded: boolean;
  panelId: string;
  isAccordionMode: boolean;
  tabIndex: number;
  rowSelectRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}) {
  return (
    <li className="parameter-home__hotspot-row" data-selected={expanded ? "true" : "false"} data-rank={rank}>
      <button
        ref={rowSelectRef}
        type="button"
        className="parameter-home__hotspot-row-select"
        aria-current={!isAccordionMode && expanded ? "true" : undefined}
        aria-controls={isAccordionMode ? panelId : undefined}
        aria-expanded={isAccordionMode ? expanded : undefined}
        aria-label={
          isAccordionMode
            ? `${expanded ? "收起" : "展开"}热区 #${rank} ${hotspot.title}`
            : `选择热区 #${rank} ${hotspot.title}`
        }
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <RankCell rank={rank} />
        <span className="parameter-home__hotspot-col-identity">
          <span className="parameter-home__hotspot-title">{hotspot.title}</span>
          <span className="parameter-home__hotspot-eyebrow">{eyebrow}</span>
        </span>
        <span className="parameter-home__hotspot-col-status">
          <StatusTag hotspot={hotspot} />
        </span>
        <span className="parameter-home__hotspot-col-score">
          <ScoreBar value={hotspot.score} />
          <span className="parameter-home__hotspot-score-num">{hotspot.score.toFixed(1)}</span>
        </span>
        <span className="parameter-home__hotspot-col-trend">
          <TrendIndicator hotspot={hotspot} />
          {isAccordionMode ? (
            <ChevronRight
              aria-hidden="true"
              className={cn("parameter-home__hotspot-row-chevron", expanded && "parameter-home__hotspot-row-chevron--expanded")}
              size={16}
            />
          ) : null}
        </span>
      </button>
      {children}
    </li>
  );
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span className="parameter-home__hotspot-col-rank">
      <span className="parameter-home__hotspot-rank-dot" aria-hidden="true" />
      <span className="parameter-home__hotspot-rank-num">#{rank}</span>
    </span>
  );
}

function StatusTag({ hotspot }: { hotspot: DashboardHotspot }) {
  return (
    <span className="parameter-home__status-tag" data-level={hotspot.statusLevel}>
      {hotspot.statusLabel}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  const width = Math.min(100, (value / SCORE_CEILING) * 100);
  const tone = value >= 200 ? "high" : value >= 140 ? "watch" : "normal";

  return (
    <span className="parameter-home__score-bar" data-tone={tone} aria-hidden="true">
      <span className="parameter-home__score-bar-fill" style={{ width: `${width}%` }} />
    </span>
  );
}

function TrendIndicator({ hotspot }: { hotspot: DashboardHotspot }) {
  const Icon =
    hotspot.trendDirection === "up" ? ArrowUpRight : hotspot.trendDirection === "down" ? ArrowDownRight : ArrowRight;
  const prefix = hotspot.trendDelta > 0 ? "+" : "";

  return (
    <span className="parameter-home__trend-indicator" data-direction={hotspot.trendDirection}>
      <Icon size={15} aria-hidden="true" />
      <span>
        {prefix}
        {hotspot.trendDelta}%
      </span>
    </span>
  );
}

function getDimensionCeiling(hotspots: DashboardHotspot[]) {
  const maxValue = Math.max(10, ...hotspots.flatMap((hotspot) => Object.values(hotspot.scoreBreakdown)));
  return Math.ceil(maxValue * 1.1);
}
