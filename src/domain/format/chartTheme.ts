import type { CSSProperties } from "react";

/**
 * Shared chart theming over the design tokens
 * (docs/design-docs/ui-design-system.md § Charts).
 *
 * Values are `var()` references, not resolved colors, so charts follow the
 * active theme (light/dark) without re-rendering. Recharts passes them through
 * to SVG attributes and inline styles, where CSS custom properties resolve
 * natively.
 */

const CHART_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)"
] as const;

/** Categorical series color; indexes beyond the ramp wrap around. */
export function chartSeriesColor(index: number): string {
  const ramp = CHART_SERIES_COLORS;
  return ramp[((index % ramp.length) + ramp.length) % ramp.length];
}

/** Status-toned series for charts whose axis is semantic, not categorical. */
export const chartStatusColors = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  success: "var(--success)",
  info: "var(--info)"
} as const;

export const chartGridStroke = "var(--border)";

/** Axis tick props shared by recharts XAxis/YAxis (`--text-muted` at 12px). */
export const chartAxisTick = { fontSize: 12, fill: "var(--text-muted)" } as const;

/** Tooltip styled like a popover: raised surface, level-2 shadow, md radius. */
export const chartTooltipContentStyle: CSSProperties = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-2)",
  color: "var(--text)",
  fontSize: "var(--text-sm)",
  lineHeight: "var(--leading-sm)",
  padding: "var(--space-2) var(--space-3)"
};

export const chartTooltipLabelStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontWeight: 600
};

export const chartTooltipItemStyle: CSSProperties = {
  color: "var(--text)"
};
