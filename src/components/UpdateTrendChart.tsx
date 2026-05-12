import { useMemo, useState } from "react";
import type { HomepageTimeWindow, UpdateTrendPoint } from "../parameterHomepageAnalytics";

type UpdateTrendChartProps = {
  series: UpdateTrendPoint[];
  timeWindow: HomepageTimeWindow;
};

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 200;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 16;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 28;

function deriveAxisIndexes(length: number, timeWindow: HomepageTimeWindow) {
  if (length <= 0) return [];

  const lastIndex = length - 1;
  if (timeWindow === "30d") {
    const indexes = [];
    for (let index = 0; index < length; index += 5) {
      indexes.push(index);
    }
    return Array.from(new Set([...indexes, lastIndex]));
  }

  const firstIndex = 0;
  const middleIndex = Math.floor(length / 2);
  return Array.from(new Set([firstIndex, middleIndex, lastIndex]));
}

export function UpdateTrendChart({ series, timeWindow }: UpdateTrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartWidth = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const chartHeight = VIEWBOX_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const maxValue = useMemo(() => {
    const raw = Math.max(1, ...series.map((point) => point.value));
    return Math.ceil(raw);
  }, [series]);

  const points = useMemo(
    () =>
      series.map((point, index) => ({
        ...point,
        x:
          series.length <= 1
            ? PADDING_LEFT + chartWidth / 2
            : PADDING_LEFT + (index / (series.length - 1)) * chartWidth,
        y: PADDING_TOP + chartHeight - (point.value / maxValue) * chartHeight
      })),
    [series, chartWidth, chartHeight, maxValue]
  );

  const linePath = useMemo(
    () => points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    [points]
  );

  const areaPath = useMemo(() => {
    if (points.length === 0) return "";
    const first = points[0];
    const last = points[points.length - 1];
    const top = points
      .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    return `M ${first.x.toFixed(2)} ${PADDING_TOP + chartHeight} ${top} L ${last.x.toFixed(2)} ${PADDING_TOP + chartHeight} Z`;
  }, [points, chartHeight]);

  const gridLines = useMemo(
    () => [0, 0.5, 1].map((ratio) => PADDING_TOP + chartHeight * ratio),
    [chartHeight]
  );

  const showDots = timeWindow === "7d";
  const axisIndexes = useMemo(
    () => deriveAxisIndexes(series.length, timeWindow),
    [series.length, timeWindow]
  );

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const viewX = ratio * VIEWBOX_WIDTH;
    let closest = 0;
    let closestDelta = Infinity;
    points.forEach((point, index) => {
      const delta = Math.abs(point.x - viewX);
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = index;
      }
    });
    setHoverIndex(closest);
  };

  const handleMouseLeave = () => setHoverIndex(null);

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const tooltipLeftRatio = hoverPoint
    ? Math.min(0.88, Math.max(0.04, (hoverPoint.x - PADDING_LEFT) / chartWidth))
    : 0;
  const tooltipDate = hoverPoint ? new Date(hoverPoint.date) : null;
  const tooltipText = tooltipDate
    ? `${tooltipDate.getUTCMonth() + 1} 月 ${tooltipDate.getUTCDate()} 日 · 更新 ${hoverPoint?.value} 次`
    : "";

  return (
    <div className="update-trend-chart" aria-label="参数更新趋势">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="参数更新趋势折线图"
      >
        {gridLines.map((y, index) => (
          <line
            key={index}
            x1={PADDING_LEFT}
            x2={VIEWBOX_WIDTH - PADDING_RIGHT}
            y1={y}
            y2={y}
            stroke="var(--outline)"
            strokeDasharray="3 4"
            strokeWidth={1}
          />
        ))}

        {[maxValue, Math.round(maxValue / 2), 0].map((tick, index) => (
          <text
            key={`ytick-${index}`}
            x={PADDING_LEFT - 8}
            y={gridLines[index] + 3}
            fill="var(--outline-strong)"
            fontSize={10}
            textAnchor="end"
          >
            {tick}
          </text>
        ))}

        <defs>
          <linearGradient id="update-trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--app-primary)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--app-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {areaPath && <path d={areaPath} fill="url(#update-trend-area)" />}

        <polyline
          data-testid="update-trend-line"
          points={linePath}
          fill="none"
          stroke="var(--app-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {showDots &&
          points.map((point, index) => (
            <circle
              key={`dot-${index}`}
              data-testid="update-trend-dot"
              cx={point.x}
              cy={point.y}
              r={3.5}
              fill="#fff"
              stroke="var(--app-primary)"
              strokeWidth={1.5}
            />
          ))}

        {axisIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={`xtick-${index}`}
              x={point.x}
              y={VIEWBOX_HEIGHT - 10}
              fill="var(--outline-strong)"
              fontSize={10}
              textAnchor="middle"
            >
              {point.label}
            </text>
          );
        })}

        {hoverPoint && (
          <>
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={PADDING_TOP}
              y2={PADDING_TOP + chartHeight}
              stroke="var(--app-primary)"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={5}
              fill="var(--app-primary)"
              stroke="#fff"
              strokeWidth={2}
            />
          </>
        )}

        <rect
          data-testid="update-trend-overlay"
          x={PADDING_LEFT}
          y={PADDING_TOP}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: "crosshair" }}
        />
      </svg>

      {hoverPoint && (
        <div
          data-testid="update-trend-tooltip"
          className="update-trend-tooltip"
          style={{ left: `${(tooltipLeftRatio * 100).toFixed(2)}%` }}
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}
