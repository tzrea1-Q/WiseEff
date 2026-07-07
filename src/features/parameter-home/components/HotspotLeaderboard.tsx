import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import type { PrototypeState } from "@/mockData";
import { computeEyebrow, generateHotspotActions } from "@/hotspotPresentation";
import { canAccessPage } from "@/app/permissions";
import { getPageByPath } from "@/appConfig";
import { HotspotScorePanel } from "./HotspotScorePanel";

const SCORE_CEILING = 250;

type HotspotLeaderboardProps = {
  hotspots: DashboardHotspot[];
  selectedId: string | null;
  sectionId: string;
  state: PrototypeState;
  isAccordionMode: boolean;
  onNavigate: (path: string) => void;
  onSelectionChange: (id: string) => void;
};

export function HotspotLeaderboard({
  hotspots,
  selectedId,
  sectionId,
  state,
  isAccordionMode,
  onNavigate,
  onSelectionChange
}: HotspotLeaderboardProps) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const effectiveSelected = hotspots.find((hotspot) => hotspot.id === selectedId) ?? hotspots[0] ?? null;
  const dimensionCeiling = getDimensionCeiling(hotspots);

  if (!effectiveSelected) {
    return <div className="parameter-home__hotspot-empty">暂无可展示的热区。</div>;
  }

  const selectByIndex = (index: number) => {
    const hotspot = hotspots[index];
    if (hotspot) {
      onSelectionChange(hotspot.id);
    }
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
        <div className="parameter-home__hotspot-list-head" role="presentation">
          <span>排名</span>
          <span>对象</span>
          <span>状态</span>
          <span>热度</span>
          <span>趋势</span>
        </div>
        <ul className="parameter-home__hotspot-list" role="list">
          {hotspots.map((hotspot, index) => {
            const selected = hotspot.id === effectiveSelected.id;
            const panelId = `${sectionId}-panel`;

            return (
              <HotspotRow
                key={hotspot.id}
                hotspot={hotspot}
                rank={index + 1}
                eyebrow={computeEyebrow(hotspot, state)}
                selected={selected}
                panelId={panelId}
                isAccordionMode={isAccordionMode}
                tabIndex={selected ? 0 : -1}
                rowSelectRef={(element) => {
                  rowRefs.current[index] = element;
                }}
                onSelect={() => onSelectionChange(hotspot.id)}
                onNavigate={onNavigate}
                onKeyDown={onKeyDownFor(index)}
              >
                {isAccordionMode && selected ? (
                  <HotspotScorePanel
                    hotspot={hotspot}
                    dimensionCeiling={dimensionCeiling}
                    sectionId={sectionId}
                    variant="accordion"
                    roleId={state.activeRoleId}
                    onNavigate={onNavigate}
                  />
                ) : null}
              </HotspotRow>
            );
          })}
        </ul>
      </div>
      {!isAccordionMode ? (
        <HotspotScorePanel
          hotspot={effectiveSelected}
          dimensionCeiling={dimensionCeiling}
          sectionId={sectionId}
          variant="desktop"
          roleId={state.activeRoleId}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

function HotspotRow({
  hotspot,
  rank,
  eyebrow,
  selected,
  panelId,
  isAccordionMode,
  tabIndex,
  rowSelectRef,
  onSelect,
  onNavigate,
  onKeyDown,
  children
}: {
  hotspot: DashboardHotspot;
  rank: number;
  eyebrow: string;
  selected: boolean;
  panelId: string;
  isAccordionMode: boolean;
  tabIndex: number;
  rowSelectRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onNavigate: (path: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}) {
  const navigationLabel = hotspot.kind === "project" ? hotspot.projectCode : hotspot.title;

  return (
    <li className="parameter-home__hotspot-row" data-selected={selected ? "true" : "false"} data-rank={rank}>
      <button
        ref={rowSelectRef}
        type="button"
        className="parameter-home__hotspot-row-select"
        aria-current={selected ? "true" : undefined}
        aria-controls={panelId}
        aria-expanded={isAccordionMode ? selected : undefined}
        aria-label={`选择热区 #${rank} ${hotspot.title}`}
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
        </span>
      </button>
      <button
        type="button"
        className="parameter-home__hotspot-row-enter"
        aria-label={`进入 ${navigationLabel}`}
        onClick={() => onNavigate(hotspot.suggestedPath)}
      >
        <ChevronRight size={16} aria-hidden="true" />
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

export function hotspotForActions(hotspot: DashboardHotspot) {
  return {
    module: hotspot.module,
    projectCode: hotspot.projectCode,
    highRiskCount: hotspot.statusLevel === "watch" ? 3 : hotspot.scoreBreakdown.risk > 20 ? 2 : 0,
    changeCount: Math.max(0, Math.round(hotspot.scoreBreakdown.frequency / 4)),
    title: hotspot.title,
    scoreBreakdown: hotspot.scoreBreakdown
  };
}

export function RecommendedHotspotActions({
  hotspot,
  roleId,
  onNavigate
}: {
  hotspot: DashboardHotspot;
  roleId: string;
  onNavigate: (path: string) => void;
}) {
  const actions = generateHotspotActions(hotspotForActions(hotspot));
  const visibleActions = [actions.primary, actions.secondary].flatMap((action) => {
    if (!action) {
      return [];
    }
    const page = getPageByPath(action.path.split("?")[0]);
    return canAccessPage(roleId, page.key) ? [action] : [];
  });
  const [primaryAction, secondaryAction] = visibleActions;

  if (!primaryAction) {
    return null;
  }

  return (
    <div className="parameter-home__hotspot-actions">
      <button type="button" className="parameter-home__action-btn parameter-home__action-btn--primary" onClick={() => onNavigate(primaryAction.path)}>
        {primaryAction.label} <ArrowRight size={14} aria-hidden="true" />
      </button>
      {secondaryAction ? (
        <button type="button" className="parameter-home__action-btn parameter-home__action-btn--secondary" onClick={() => onNavigate(secondaryAction.path)}>
          {secondaryAction.label}
        </button>
      ) : null}
    </div>
  );
}
