import type { ReactNode } from "react";
import "./overview-page.css";

type OverviewPageProps = {
  label: string;
  summary?: ReactNode;
  quickActions?: ReactNode;
  children?: ReactNode;
};

export function OverviewPage({ label, summary, quickActions, children }: OverviewPageProps) {
  return (
    <section className="overview-page" aria-label={label}>
      {summary ? <div className="overview-page__summary">{summary}</div> : null}
      {children ? <div className="overview-page__content">{children}</div> : null}
      {quickActions ? <div className="overview-page__actions" role="group" aria-label="快捷操作">{quickActions}</div> : null}
    </section>
  );
}

export function OverviewTile({ label, value, trend, hasSamples, metricKey }: {
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  hasSamples: boolean;
  metricKey?: string;
}) {
  return (
    <div className="overview-tile" data-kpi={metricKey} data-has-samples={hasSamples}>
      <dt className="overview-tile__label">{label}</dt>
      <dd className="overview-tile__value">{hasSamples ? value : "暂无样本"}</dd>
      {hasSamples && trend != null ? <dd className="overview-tile__trend">{trend}</dd> : null}
    </div>
  );
}

export function OverviewVerdict({ hasSamples, children }: { hasSamples: boolean; children: ReactNode }) {
  return <strong data-overview-verdict data-has-samples={hasSamples}>{hasSamples ? children : "暂无样本，无法判断"}</strong>;
}
