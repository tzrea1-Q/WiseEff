export type ComparisonMetricsProps = {
  total: number;
  drift: number;
  synced: number;
  highRisk: number;
  onShowDrift: () => void;
  onShowHighRisk: () => void;
};

function driftRatio(total: number, drift: number) {
  return total > 0 ? Math.round((drift / total) * 100) : 0;
}

export function ComparisonMetrics({ total, drift, synced, highRisk, onShowDrift, onShowHighRisk }: ComparisonMetricsProps) {
  const ratio = driftRatio(total, drift);

  return (
    <section className="comparison-metrics" aria-label="参数对比摘要">
      <article className="metric-card" data-tone="muted">
        <header>对比范围</header>
        <strong>{total}</strong>
        <small>{synced} 项已同步</small>
        <div className="metric-card__progress" aria-hidden="true">
          <span style={{ width: "100%" }} />
        </div>
      </article>

      <button className="metric-card metric-card--button" data-tone={drift > 0 ? "warn" : "success"} type="button" onClick={onShowDrift}>
        <header>差异参数</header>
        <strong>{drift}</strong>
        <small>{ratio}% 需要审阅</small>
        <div className="metric-card__progress" aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      </button>

      <button
        className="metric-card metric-card--button"
        data-tone={highRisk > 0 ? "danger" : "muted"}
        disabled={highRisk === 0}
        type="button"
        onClick={onShowHighRisk}
      >
        <header>高重要性差异</header>
        <strong>{highRisk}</strong>
        <small>{highRisk > 0 ? "建议优先处理" : "暂无高风险差异"}</small>
        <div className="metric-card__progress" aria-hidden="true">
          <span style={{ width: total > 0 ? `${Math.round((highRisk / total) * 100)}%` : "0%" }} />
        </div>
      </button>
    </section>
  );
}
