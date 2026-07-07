import { useState } from "react";
import type { ProjectRiskBucket } from "@/domain/parameters/dashboardTypes";

type ProjectRiskBarChartProps = {
  buckets: ProjectRiskBucket[];
  onNavigate: (path: string) => void;
};

type TooltipState = {
  projectId: string;
  label: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export function ProjectRiskBarChart({ buckets, onNavigate }: ProjectRiskBarChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (buckets.length === 0) {
    return (
      <div className="project-risk-bar-chart empty" role="status">
        暂无项目风险数据。
      </div>
    );
  }

  return (
    <div className="project-risk-bar-chart" aria-label="各项目参数更新情况">
      <div className="project-risk-bar-chart-scroller">
        {buckets.map((bucket) => {
          const heightDenominator = Math.max(1, bucket.total);
          const highRatio = bucket.high / heightDenominator;
          const mediumRatio = bucket.medium / heightDenominator;
          const lowRatio = bucket.low / heightDenominator;
          const nextTooltip = {
            projectId: bucket.projectId,
            label: bucket.projectCode,
            high: bucket.high,
            medium: bucket.medium,
            low: bucket.low,
            total: bucket.total
          };

          return (
            <button
              key={bucket.projectId}
              type="button"
              data-testid="project-risk-row"
              className="project-risk-row"
              onClick={() => onNavigate(`/parameters?project=${encodeURIComponent(bucket.projectId)}`)}
              onMouseEnter={() => setTooltip(nextTooltip)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={() => setTooltip(nextTooltip)}
              onBlur={() => setTooltip(null)}
              aria-label={`${bucket.projectCode} 高 ${bucket.high} 中 ${bucket.medium} 低 ${bucket.low}`}
            >
              <span className="project-risk-row-bar">
                {bucket.high > 0 && (
                  <span
                    className="project-risk-segment risk-high"
                    style={{ height: `${(highRatio * 100).toFixed(2)}%` }}
                  >
                    {highRatio > 0.08 ? bucket.high : ""}
                  </span>
                )}
                {bucket.medium > 0 && (
                  <span
                    className="project-risk-segment risk-medium"
                    style={{ height: `${(mediumRatio * 100).toFixed(2)}%` }}
                  >
                    {mediumRatio > 0.08 ? bucket.medium : ""}
                  </span>
                )}
                {bucket.low > 0 && (
                  <span
                    className="project-risk-segment risk-low"
                    style={{ height: `${(lowRatio * 100).toFixed(2)}%` }}
                  >
                    {lowRatio > 0.08 ? bucket.low : ""}
                  </span>
                )}
              </span>
              <span className="project-risk-row-label">{bucket.projectCode}</span>
              <span className="project-risk-row-total">{bucket.total}</span>
            </button>
          );
        })}
      </div>

      {tooltip && (
        <div data-testid="project-risk-tooltip" className="project-risk-tooltip" role="status">
          <strong>{tooltip.label}</strong>
          <span>高 {tooltip.high}</span>
          <span>中 {tooltip.medium}</span>
          <span>低 {tooltip.low}</span>
          <span>总 {tooltip.total}</span>
        </div>
      )}
    </div>
  );
}
