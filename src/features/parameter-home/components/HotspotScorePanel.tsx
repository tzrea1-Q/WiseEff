import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { RecommendedHotspotActions } from "./HotspotLeaderboard";

const HOTSPOT_DIMENSIONS: Array<{ key: keyof DashboardHotspot["scoreBreakdown"]; label: string }> = [
  { key: "frequency", label: "变更频次" },
  { key: "risk", label: "风险权重" },
  { key: "impact", label: "影响范围" },
  { key: "workflow", label: "流程堆积" },
  { key: "drift", label: "异常偏离" }
];

type HotspotScorePanelProps = {
  hotspot: DashboardHotspot;
  dimensionCeiling: number;
  sectionId: string;
  variant: "desktop" | "accordion";
  roleId: string;
  onNavigate: (path: string) => void;
};

export function HotspotScorePanel({
  hotspot,
  dimensionCeiling,
  sectionId,
  variant,
  roleId,
  onNavigate
}: HotspotScorePanelProps) {
  const titleId = `${sectionId}-panel-title`;

  return (
    <aside
      id={`${sectionId}-panel`}
      className="parameter-home__hotspot-panel"
      data-variant={variant}
      role="region"
      aria-live="polite"
      aria-labelledby={titleId}
    >
      <header>
        <h3 id={titleId}>热度评分构成 · {hotspot.title}</h3>
      </header>
      <section className="parameter-home__hotspot-panel-evidence">
        <h4>关联证据</h4>
        <ul>
          {hotspot.evidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      </section>
      <section className="parameter-home__hotspot-panel-dimensions">
        <h4>维度得分</h4>
        <ul className="parameter-home__dimension-bars">
          {HOTSPOT_DIMENSIONS.map((dimension) => {
            const value = hotspot.scoreBreakdown[dimension.key];
            return (
              <li key={dimension.key}>
                <span className="parameter-home__dim-label">{dimension.label}</span>
                <span
                  className="parameter-home__dim-bar"
                  role="progressbar"
                  aria-label={dimension.label}
                  aria-valuemin={0}
                  aria-valuemax={dimensionCeiling}
                  aria-valuenow={value}
                >
                  <span style={{ width: `${Math.min(100, (value / dimensionCeiling) * 100)}%` }} />
                </span>
                <span className="parameter-home__dim-value">{value}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="parameter-home__hotspot-panel-actions">
        <RecommendedHotspotActions hotspot={hotspot} roleId={roleId} onNavigate={onNavigate} />
      </section>
    </aside>
  );
}
