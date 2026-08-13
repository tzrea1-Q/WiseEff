import {
  chartAxisTick,
  chartGridStroke,
  chartSeriesColor,
  chartStatusColors,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle
} from "@/domain/format/chartTheme";
import type { ProjectRiskBucket } from "@/domain/parameters/dashboardTypes";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ProjectRiskChartProps = {
  buckets: ProjectRiskBucket[];
};

export function ProjectRiskChart({ buckets }: ProjectRiskChartProps) {
  const data = buckets.map((bucket) => ({
    label: bucket.projectCode,
    high: bucket.high,
    medium: bucket.medium,
    low: bucket.low
  }));

  return (
    <figure role="img" aria-label="各项目参数风险分布" className="parameter-home__chart-shell">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={chartAxisTick} />
          <YAxis allowDecimals={false} width={28} tick={chartAxisTick} />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
          />
          <Legend />
          {/* Risk is a semantic axis: high/medium map to status tokens, low
              stays on the categorical accent (chart-1) as the neutral series. */}
          <Bar dataKey="high" name="高风险" stackId="risk" fill={chartStatusColors.danger} />
          <Bar dataKey="medium" name="中风险" stackId="risk" fill={chartStatusColors.warning} />
          <Bar dataKey="low" name="低风险" stackId="risk" fill={chartSeriesColor(0)} />
        </BarChart>
      </ResponsiveContainer>
      <table className="parameter-home__chart-fallback">
        <caption>各项目参数风险分布</caption>
        <thead>
          <tr>
            <th>项目</th>
            <th>高</th>
            <th>中</th>
            <th>低</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.projectId}>
              <td>{bucket.projectCode}</td>
              <td>{bucket.high}</td>
              <td>{bucket.medium}</td>
              <td>{bucket.low}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
