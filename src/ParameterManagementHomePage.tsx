import { useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, ChevronRight, Layers3, TrendingUp, Users } from "lucide-react";
import type { PrototypeState } from "./mockData";
import { deriveParameterHomepageAnalytics, type HomepageTimeWindow, type HotspotDimension, type ParameterHotspot } from "./parameterHomepageAnalytics";
import { ProjectRiskBarChart } from "./components/ProjectRiskBarChart";
import { UpdateTrendChart } from "./components/UpdateTrendChart";
import { useTopBarActions } from "./components/layout";
import { computeEyebrow, generateHotspotActions } from "./hotspotPresentation";
import { useIsAccordionMode } from "./components/hotspots/useIsAccordionMode";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ParameterManagementHomePageProps = {
  state: PrototypeState;
  onNavigate: (path: string) => void;
  timeWindow?: HomepageTimeWindow;
};

const hotspotDimensionOptions: Array<{ value: HotspotDimension; label: string }> = [
  { value: "overall", label: "总榜" },
  { value: "module", label: "模块榜" },
  { value: "project", label: "项目榜" },
  { value: "parameter", label: "参数榜" }
];

const metricIcons = [BarChart3, Layers3, TrendingUp, Users] as const;
const SCORE_CEILING = 250;
const HOTSPOT_DIMENSIONS: Array<{ key: keyof ParameterHotspot["scoreBreakdown"]; label: string }> = [
  { key: "frequency", label: "变更频次" },
  { key: "risk", label: "风险权重" },
  { key: "impact", label: "影响范围" },
  { key: "workflow", label: "流程堆积" },
  { key: "drift", label: "异常偏离" }
];

const parameterHomeQuickEntries = [
  { title: "参数修改", path: "/parameters" },
  { title: "参数审阅", path: "/parameter-review" },
  { title: "管理后台", path: "/parameter-admin" }
];

export function ParameterManagementHomePage({ state, onNavigate, timeWindow = "30d" }: ParameterManagementHomePageProps) {
  const [hotspotDimension, setHotspotDimension] = useState<HotspotDimension>("overall");
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const isAccordionMode = useIsAccordionMode(1099);

  const analytics = useMemo(
    () => deriveParameterHomepageAnalytics(state, timeWindow, hotspotDimension),
    [state, timeWindow, hotspotDimension]
  );
  useTopBarActions(
    <nav className="parameter-homepage-quick-nav" aria-label="参数管理快捷入口">
      {parameterHomeQuickEntries.map((entry) => (
        <Button key={entry.path} type="button" variant="outline" onClick={() => onNavigate(entry.path)}>
          {entry.title}
        </Button>
      ))}
    </nav>,
    []
  );
  const metrics = [
    { title: "参数总量", value: analytics.summary.totalParameters, detail: "全量运行参数" },
    { title: "管理项目总数", value: state.configDraft.projects.length, detail: "纳入治理项目" },
    { title: "修改频次", value: analytics.summary.changeEvents, detail: "近窗变更事件" },
    { title: "开发人员总数", value: state.developers.length, detail: "参数协作角色" }
  ];

  return (
    <section className="parameter-homepage" aria-label="参数管理首页">
      <p className="parameter-homepage-headline homepage-panel" data-testid="parameter-home-headline">
        <span>{analytics.opsHeadline}</span>
      </p>

      <section className="parameter-homepage-metrics" aria-label="核心指标">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return <MetricCard key={metric.title} title={metric.title} value={metric.value} detail={metric.detail} Icon={Icon} />;
        })}
      </section>

      <section className="parameter-homepage-charts" aria-label="参数态势图表">
        <div className="homepage-panel parameter-homepage-chart-card">
          <div className="parameter-homepage-section-head">
            <div>
              <h2>参数更新趋势</h2>
              <span>{analytics.timeWindowLabel}</span>
            </div>
          </div>
          <UpdateTrendChart series={analytics.updateTrend} timeWindow={timeWindow} />
        </div>
        <div className="homepage-panel parameter-homepage-chart-card">
          <div className="parameter-homepage-section-head">
            <div>
              <h2>各项目参数更新情况</h2>
              <ul className="project-risk-legend" aria-label="各项目参数更新情况颜色说明">
                <li>
                  <span className="project-risk-legend-dot risk-high" aria-hidden="true" />
                  红色 高风险
                </li>
                <li>
                  <span className="project-risk-legend-dot risk-medium" aria-hidden="true" />
                  橙色 中风险
                </li>
                <li>
                  <span className="project-risk-legend-dot risk-low" aria-hidden="true" />
                  蓝色 低风险
                </li>
              </ul>
            </div>
          </div>
          <ProjectRiskBarChart buckets={analytics.riskBuckets} onNavigate={onNavigate} />
        </div>
      </section>

      <section className="parameter-homepage-hotspots homepage-panel" aria-label="热门模块">
        <div className="parameter-homepage-section-head">
          <div>
            <h2>热门模块</h2>
            <span>
              {analytics.timeWindowLabel} · {analytics.hotspots.length} 个热区
            </span>
          </div>
          <HotspotDimensionSelect
            value={hotspotDimension}
            onChange={(nextDimension) => {
              setHotspotDimension(nextDimension);
              setSelectedHotspotId(null);
            }}
          />
        </div>
        <HotspotLeaderboard
          hotspots={analytics.hotspots}
          selectedId={selectedHotspotId}
          sectionId="parameter-home-hotspots"
          state={state}
          isAccordionMode={isAccordionMode}
          onNavigate={onNavigate}
          onSelectionChange={setSelectedHotspotId}
        />
      </section>
    </section>
  );
}

function HotspotDimensionSelect({
  value,
  onChange
}: {
  value: HotspotDimension;
  onChange: (value: HotspotDimension) => void;
}) {
  return (
    <div className="parameter-homepage-inline-select parameter-homepage-dimension-switch">
      <span className="parameter-homepage-select-label">热榜维度</span>
      <ToggleGroup
        aria-label="热榜维度"
        className="parameter-homepage-select"
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onChange(nextValue as HotspotDimension);
          }
        }}
      >
        {hotspotDimensionOptions.map((option) => (
          <ToggleGroupItem key={option.value} className="parameter-homepage-dimension-option" value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  Icon
}: {
  title: string;
  value: number;
  detail: string;
  Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}) {
  return (
    <Card className="parameter-homepage-card homepage-metric-card metric-card">
      <Icon size={18} aria-hidden={true} />
      <CardDescription>{title}</CardDescription>
      <CardTitle>{value}</CardTitle>
      <p>{detail}</p>
    </Card>
  );
}

export function HotspotLeaderboard({
  hotspots,
  selectedId,
  sectionId,
  state,
  isAccordionMode,
  onNavigate,
  onSelectionChange
}: {
  hotspots: ParameterHotspot[];
  selectedId: string | null;
  sectionId: string;
  state: PrototypeState;
  isAccordionMode: boolean;
  onNavigate: (path: string) => void;
  onSelectionChange: (id: string) => void;
}) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const effectiveSelected = hotspots.find((hotspot) => hotspot.id === selectedId) ?? hotspots[0] ?? null;
  const dimensionCeiling = getDimensionCeiling(hotspots);

  if (!effectiveSelected) {
    return (
      <div className="parameter-homepage-hotspot-layout">
        <div className="hotspot-empty">暂无可展示的热区。</div>
      </div>
    );
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
    <div className="parameter-homepage-hotspot-layout" data-accordion={isAccordionMode ? "true" : "false"}>
      <div className="hotspot-leaderboard">
        <div className="hotspot-list-head" role="presentation">
          <span>排名</span>
          <span>对象</span>
          <span>状态</span>
          <span>热度</span>
          <span>趋势</span>
          <span aria-hidden="true">·</span>
        </div>
        <ul className="hotspot-list" role="list">
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
                  <HotspotDetailPanel
                    hotspot={hotspot}
                    dimensionCeiling={dimensionCeiling}
                    sectionId={sectionId}
                    variant="accordion"
                    onNavigate={onNavigate}
                  />
                ) : null}
              </HotspotRow>
            );
          })}
        </ul>
      </div>
      {!isAccordionMode ? (
        <HotspotDetailPanel
          hotspot={effectiveSelected}
          dimensionCeiling={dimensionCeiling}
          sectionId={sectionId}
          variant="desktop"
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
  hotspot: ParameterHotspot;
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
    <li className="hotspot-row" data-selected={selected ? "true" : "false"} data-rank={rank}>
      <button
        ref={rowSelectRef}
        type="button"
        className="hotspot-row-select"
        aria-current={selected ? "true" : undefined}
        aria-controls={panelId}
        aria-expanded={isAccordionMode ? selected : undefined}
        aria-label={`选择热区 #${rank} ${hotspot.title}`}
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <RankCell rank={rank} />
        <span className="hotspot-col-identity">
          <span className="hotspot-title">{hotspot.title}</span>
          <span className="hotspot-eyebrow">{eyebrow}</span>
        </span>
        <span className="hotspot-col-status">
          <StatusTag hotspot={hotspot} />
        </span>
        <span className="hotspot-col-score">
          <ScoreBar value={hotspot.score} />
          <span className="hotspot-score-num">{hotspot.score.toFixed(1)}</span>
        </span>
        <span className="hotspot-col-trend">
          <TrendIndicator hotspot={hotspot} />
        </span>
      </button>
      <button type="button" className="hotspot-row-enter" aria-label={`进入 ${navigationLabel}`} onClick={() => onNavigate(hotspot.suggestedPath)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {children}
    </li>
  );
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span className="hotspot-col-rank">
      <span className="hotspot-rank-dot" aria-hidden="true" />
      <span className="hotspot-rank-num">#{rank}</span>
    </span>
  );
}

function StatusTag({ hotspot }: { hotspot: ParameterHotspot }) {
  return (
    <span className="status-tag" data-level={hotspot.statusLevel}>
      {hotspot.status}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  const width = Math.min(100, (value / SCORE_CEILING) * 100);
  const tone = value >= 200 ? "high" : value >= 140 ? "watch" : "normal";

  return (
    <span className="score-bar" data-tone={tone} aria-hidden="true">
      <span className="score-bar-fill" style={{ width: `${width}%` }} />
    </span>
  );
}

function TrendIndicator({ hotspot }: { hotspot: ParameterHotspot }) {
  const Icon =
    hotspot.trend.direction === "up" ? ArrowUpRight : hotspot.trend.direction === "down" ? ArrowDownRight : ArrowRight;
  const prefix = hotspot.trend.delta > 0 ? "+" : "";

  return (
    <span className="trend-indicator" data-direction={hotspot.trend.direction}>
      <Icon size={15} aria-hidden="true" />
      <span>{prefix}{hotspot.trend.delta}%</span>
    </span>
  );
}

function HotspotDetailPanel({
  hotspot,
  dimensionCeiling,
  sectionId,
  variant,
  onNavigate
}: {
  hotspot: ParameterHotspot;
  dimensionCeiling: number;
  sectionId: string;
  variant: "desktop" | "accordion";
  onNavigate: (path: string) => void;
}) {
  const titleId = `${sectionId}-panel-title`;

  return (
    <aside
      id={`${sectionId}-panel`}
      className="hotspot-panel"
      data-variant={variant}
      role="region"
      aria-live="polite"
      aria-labelledby={titleId}
    >
      <header>
        <h3 id={titleId}>AI 评分拆解 · {hotspot.title}</h3>
      </header>
      <section className="hotspot-panel-evidence">
        <h4>关联证据</h4>
        <ul>
          {hotspot.evidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      </section>
      <section className="hotspot-panel-dimensions">
        <h4>维度得分</h4>
        <ul className="dimension-bars">
          {HOTSPOT_DIMENSIONS.map((dimension) => {
            const value = hotspot.scoreBreakdown[dimension.key];
            return (
              <li key={dimension.key}>
                <span className="dim-label">{dimension.label}</span>
                <span
                  className="dim-bar"
                  role="progressbar"
                  aria-label={dimension.label}
                  aria-valuemin={0}
                  aria-valuemax={dimensionCeiling}
                  aria-valuenow={value}
                >
                  <span style={{ width: `${Math.min(100, (value / dimensionCeiling) * 100)}%` }} />
                </span>
                <span className="dim-value">{value}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="hotspot-panel-actions">
        <RecommendedActions hotspot={hotspot} onNavigate={onNavigate} />
      </section>
    </aside>
  );
}

function RecommendedActions({ hotspot, onNavigate }: { hotspot: ParameterHotspot; onNavigate: (path: string) => void }) {
  const actions = generateHotspotActions(hotspot);

  return (
    <div className="hotspot-actions">
      <button type="button" className="action-btn action-btn--primary" onClick={() => onNavigate(actions.primary.path)}>
        {actions.primary.label} <ArrowRight size={14} aria-hidden="true" />
      </button>
      {actions.secondary ? (
        <button type="button" className="action-btn action-btn--secondary" onClick={() => onNavigate(actions.secondary?.path ?? "")}>
          {actions.secondary.label}
        </button>
      ) : null}
    </div>
  );
}

function getDimensionCeiling(hotspots: ParameterHotspot[]) {
  const maxValue = Math.max(10, ...hotspots.flatMap((hotspot) => Object.values(hotspot.scoreBreakdown)));
  return Math.ceil(maxValue * 1.1);
}
