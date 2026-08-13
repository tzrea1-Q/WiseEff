import {
  chartAxisTick,
  chartGridStroke,
  chartSeriesColor,
  chartTooltipContentStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle
} from "@/domain/format/chartTheme";
import type { TrendPoint } from "@/domain/parameters/dashboardTypes";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type UpdateTrendChartProps = {
  points: TrendPoint[];
  changeSeriesName?: string;
  workflowSeriesName?: string;
};

export function UpdateTrendChart({
  points,
  changeSeriesName = "参数变更",
  workflowSeriesName = "流程事件"
}: UpdateTrendChartProps) {
  const data = points.map((point) => ({
    label: point.label,
    changeCount: point.changeCount,
    workflowEventCount: point.workflowEventCount
  }));

  return (
    <figure role="img" aria-label="参数更新趋势" className="parameter-home__chart-shell">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={chartAxisTick} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} width={28} tick={chartAxisTick} />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
          />
          <Area
            type="monotone"
            dataKey="changeCount"
            name={changeSeriesName}
            stroke={chartSeriesColor(0)}
            fill={chartSeriesColor(0)}
            fillOpacity={0.16}
          />
          <Line
            type="monotone"
            dataKey="workflowEventCount"
            name={workflowSeriesName}
            stroke={chartSeriesColor(1)}
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <table className="parameter-home__chart-fallback">
        <caption>参数更新趋势</caption>
        <thead>
          <tr>
            <th>时间</th>
            <th>参数变更</th>
            <th>流程事件</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucketStart}>
              <td>{point.label}</td>
              <td>{point.changeCount}</td>
              <td>{point.workflowEventCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
