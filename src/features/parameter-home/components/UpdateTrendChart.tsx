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
};

export function UpdateTrendChart({ points }: UpdateTrendChartProps) {
  const data = points.map((point) => ({
    label: point.label,
    changeCount: point.changeCount,
    workflowEventCount: point.workflowEventCount
  }));

  return (
    <figure role="img" aria-label="参数更新趋势" className="parameter-home__chart-shell">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Area type="monotone" dataKey="changeCount" name="参数变更" stroke="#2563eb" fill="#93c5fd" fillOpacity={0.35} />
          <Line type="monotone" dataKey="workflowEventCount" name="流程事件" stroke="#7c3aed" dot={false} />
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
