import type { DashboardKpis } from "@/domain/parameters/dashboardTypes";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import { Panel } from "./Panel";
import { SectionError, SectionSkeleton } from "./SectionState";

const KPI_ITEMS: Array<{ key: keyof DashboardKpis; label: string }> = [
  { key: "totalParameters", label: "参数总量" },
  { key: "managedProjects", label: "管理项目" },
  { key: "changeFrequency", label: "变更频次" },
  { key: "activeContributors", label: "活跃贡献者" },
  { key: "highRiskParameters", label: "高风险参数" }
];

type SituationStripProps = {
  status: SectionStatus;
  kpis: DashboardKpis | null;
  error?: string | null;
  onRetry?: () => void;
};

export function SituationStrip({ status, kpis, error, onRetry }: SituationStripProps) {
  return (
    <Panel title="态势概览" subtitle="参数库关键指标">
      {status === "loading" || status === "idle" ? <SectionSkeleton label="加载态势指标" /> : null}
      {status === "error" ? (
        <SectionError message={error ?? "态势指标加载失败"} onRetry={onRetry ?? (() => undefined)} />
      ) : null}
      {status === "ready" && kpis ? (
        <div className="parameter-home__kpi-grid">
          {KPI_ITEMS.map((item) => (
            <div key={item.key} className="parameter-home__kpi-tile">
              <div className="parameter-home__kpi-label">{item.label}</div>
              <div className="parameter-home__kpi-value">{kpis[item.key]}</div>
            </div>
          ))}
        </div>
      ) : null}
      {status === "empty" ? <p className="parameter-home__section-empty">当前时间窗口暂无参数活动数据。</p> : null}
    </Panel>
  );
}
