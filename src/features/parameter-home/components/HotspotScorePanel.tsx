import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";

const DIMENSIONS: Array<{ key: keyof DashboardHotspot["scoreBreakdown"]; label: string }> = [
  { key: "frequency", label: "窗口变更频次" },
  { key: "scope", label: "累计修改范围" },
  { key: "workflow", label: "流程压力" },
  { key: "collaboration", label: "协作广度" }
];

type HotspotScorePanelProps = {
  hotspot: DashboardHotspot;
  dimensionCeiling: number;
  sectionId: string;
  variant: "desktop" | "accordion";
};

export function HotspotScorePanel({ hotspot, dimensionCeiling, sectionId, variant }: HotspotScorePanelProps) {
  const dimensions = DIMENSIONS.map((dimension) =>
    dimension.key === "scope" && hotspot.kind === "parameter" ? { ...dimension, label: "项目修改范围" } : dimension
  );

  return (
    <aside
      id={`${sectionId}-panel`}
      className="parameter-home__hotspot-panel"
      data-variant={variant}
      role="region"
      aria-live="polite"
      aria-label={`${hotspot.title} 热榜详情`}
    >
      <section className="parameter-home__hotspot-panel-evidence">
        <h3>关联证据</h3>
        <ul>
          {hotspot.evidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      </section>
      <section className="parameter-home__hotspot-panel-dimensions">
        <h3>维度得分</h3>
        <ul className="parameter-home__dimension-bars">
          {dimensions.map((dimension) => {
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
    </aside>
  );
}
