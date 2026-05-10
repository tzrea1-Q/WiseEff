import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { BarChart3, Flame, Layers3, TrendingUp, Users } from "lucide-react";
import type { PrototypeState } from "./mockData";
import {
  deriveParameterHomepageAnalytics,
  type HomepageTimeWindow,
  type HotspotDimension,
  type ParameterHotspot
} from "./parameterHomepageAnalytics";
import { ProjectRiskBarChart } from "./components/ProjectRiskBarChart";
import { UpdateTrendChart } from "./components/UpdateTrendChart";

type ParameterManagementHomePageProps = {
  state: PrototypeState;
  onNavigate: (path: string) => void;
  timeWindow?: HomepageTimeWindow;
  onTimeWindowChange?: (value: HomepageTimeWindow) => void;
};

const hotspotDimensionOptions: Array<{ value: HotspotDimension; label: string }> = [
  { value: "module", label: "模块" },
  { value: "project", label: "项目" }
];

export const homepageTimeWindowOptions: Array<{ value: HomepageTimeWindow; label: string }> = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "180d", label: "180天" }
];

const metricIcons = [BarChart3, Layers3, TrendingUp, Users] as const;

export function ParameterManagementHomePage({
  state,
  onNavigate,
  timeWindow = "30d",
  onTimeWindowChange
}: ParameterManagementHomePageProps) {
  const [hotspotDimension, setHotspotDimension] = useState<HotspotDimension>("module");
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);

  const analytics = useMemo(
    () => deriveParameterHomepageAnalytics(state, timeWindow, hotspotDimension),
    [state, timeWindow, hotspotDimension]
  );
  const selectedHotspot =
    analytics.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ??
    analytics.hotspots[0] ??
    null;

  const metrics = [
    { title: "参数总量", value: analytics.summary.totalParameters, detail: "全量运行参数" },
    { title: "管理项目总数", value: state.configDraft.projects.length, detail: "纳入治理项目" },
    { title: "修改频次", value: analytics.summary.changeEvents, detail: "近窗变更事件" },
    { title: "开发人员总数", value: state.developers.length, detail: "参数协作角色" }
  ];

  return (
    <section className="parameter-homepage" aria-label="参数管理首页">
      <div className="parameter-homepage-time-window">
        <label className="parameter-homepage-inline-select">
          <span>时间范围</span>
          <select
            aria-label="时间范围"
            className="parameter-homepage-select"
            value={timeWindow}
            onChange={(event) => onTimeWindowChange?.(event.target.value as HomepageTimeWindow)}
          >
            {homepageTimeWindowOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p
        className="parameter-homepage-headline homepage-panel"
        data-testid="parameter-home-headline"
      >
        <span aria-hidden="true">💬</span>
        <span>{analytics.opsHeadline}</span>
      </p>

      <section className="parameter-homepage-metrics" aria-label="核心指标">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return (
            <MetricCard
              key={metric.title}
              title={metric.title}
              value={metric.value}
              detail={metric.detail}
              Icon={Icon}
            />
          );
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
              <h2>分项目风险分布</h2>
              <span>高/中/低 修改聚合</span>
            </div>
          </div>
          <ProjectRiskBarChart buckets={analytics.riskBuckets} onNavigate={onNavigate} />
        </div>
      </section>

      <section className="homepage-entry-grid" aria-label="入口卡片">
        {analytics.entryCards.map((entry) => (
          <EntryCard key={entry.path} entry={entry} onNavigate={onNavigate} />
        ))}
      </section>

      <section className="parameter-homepage-hotspots homepage-panel" aria-label="热门模块">
        <div className="parameter-homepage-section-head">
          <div>
            <h2>热门模块</h2>
            <span>
              {analytics.timeWindowLabel} · {analytics.hotspots.length} 个热区
            </span>
          </div>
          <HotspotDimensionSelect value={hotspotDimension} onChange={setHotspotDimension} />
        </div>
        <div className="parameter-homepage-hotspot-layout">
          <div className="parameter-homepage-hotspot-list">
            {analytics.hotspots.map((hotspot) => (
              <HotspotCard
                key={hotspot.id}
                hotspot={hotspot}
                selected={hotspot.id === selectedHotspot?.id}
                onSelect={() => setSelectedHotspotId(hotspot.id)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
          <HotspotExplanation hotspot={selectedHotspot} />
        </div>
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
    <label className="parameter-homepage-inline-select">
      <span>热榜维度</span>
      <select
        aria-label="热榜维度"
        className="parameter-homepage-select"
        value={value}
        onChange={(event) => onChange(event.target.value as HotspotDimension)}
      >
        {hotspotDimensionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EntryCard({
  entry,
  onNavigate
}: {
  entry: { title: string; description: string; path: string; statusLabel: string; statusValue: string };
  onNavigate: (path: string) => void;
}) {
  return (
    <article className="parameter-homepage-card homepage-entry-card entry-card">
      <div className="parameter-homepage-entry-meta">
        <span>{entry.statusLabel}</span>
        <strong>{entry.statusValue}</strong>
      </div>
      <h3>{entry.title}</h3>
      <p>{entry.description}</p>
      <button type="button" onClick={() => onNavigate(entry.path)}>
        进入 {entry.title}
      </button>
    </article>
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
    <article className="parameter-homepage-card homepage-metric-card metric-card">
      <Icon size={18} aria-hidden={true} />
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function HotspotCard({
  hotspot,
  selected,
  onSelect,
  onNavigate
}: {
  hotspot: ParameterHotspot;
  selected: boolean;
  onSelect: () => void;
  onNavigate: (path: string) => void;
}) {
  const navigationLabel = hotspot.module === "项目参数" ? hotspot.projectCode : hotspot.module;
  const eyebrow = hotspot.module === "项目参数" ? "项目维度" : hotspot.projectCode;

  return (
    <article
      className={
        selected
          ? "parameter-homepage-card hotspot-card selected"
          : "parameter-homepage-card hotspot-card"
      }
    >
      <div className="parameter-homepage-hotspot-head">
        <div>
          <span>{eyebrow}</span>
          <strong>{hotspot.title}</strong>
        </div>
        <Flame size={16} aria-hidden="true" />
      </div>
      <p>{hotspot.explanation}</p>
      <div className="parameter-homepage-hotspot-stats">
        <span>{hotspot.status}</span>
        <strong>{hotspot.score} 分</strong>
      </div>
      <div className="parameter-homepage-hotspot-actions">
        <button type="button" onClick={onSelect}>
          查看评分
        </button>
        <button type="button" onClick={() => onNavigate(hotspot.suggestedPath)}>
          进入 {navigationLabel}
        </button>
      </div>
    </article>
  );
}

function HotspotExplanation({ hotspot }: { hotspot: ParameterHotspot | null }) {
  if (!hotspot) {
    return (
      <aside className="parameter-homepage-card homepage-panel parameter-homepage-explanation">
        <h3>AI 评分拆解</h3>
        <p>暂无可展示的热区。</p>
      </aside>
    );
  }

  const dimensions = [
    { label: "变更频次", value: hotspot.scoreBreakdown.frequency, description: "统计所选窗口内参数与审阅请求的变更密度。" },
    { label: "风险权重", value: hotspot.scoreBreakdown.risk, description: "按高、中、低风险参数数量换算治理优先级。" },
    { label: "影响范围", value: hotspot.scoreBreakdown.impact, description: "结合参数定义覆盖面与日志命中信号评估影响面。" },
    { label: "流程堆积", value: hotspot.scoreBreakdown.workflow, description: "反映审阅请求和高风险项在流程中的堆积程度。" },
    { label: "异常偏离", value: hotspot.scoreBreakdown.drift, description: "衡量当前值相对推荐值的偏离幅度。" }
  ];

  return (
    <aside className="parameter-homepage-card homepage-panel parameter-homepage-explanation">
      <h3>AI 评分拆解</h3>
      <p>{hotspot.explanation}</p>
      <div className="parameter-homepage-evidence">
        <h4>关联证据</h4>
        <ul>
          {hotspot.evidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      </div>
      <div className="parameter-homepage-dimension-list">
        {dimensions.map((dimension) => (
          <div className="breakdown-row" key={dimension.label}>
            <span>
              {dimension.label}
              <small>{dimension.description}</small>
            </span>
            <strong>{dimension.value} 项</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}
