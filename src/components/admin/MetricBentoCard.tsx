import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MetricTrend = {
  direction: "up" | "down" | "flat";
  text: string;
};

export type MetricBentoCardVariant = "spark" | "radial" | "pulse" | "peak";
export type MetricBentoCardSeverity = "neutral" | "success" | "warning" | "error";

export type MetricBentoCardProps = {
  label: string;
  value: string;
  variant: MetricBentoCardVariant;
  caption?: string;
  trend?: MetricTrend;
  data?: number[];
  percent?: number;
  severity?: MetricBentoCardSeverity;
  active?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
};

const severityClass: Record<MetricBentoCardSeverity, string> = {
  neutral: "border-border bg-card text-card-foreground",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-destructive/30 bg-destructive/5 text-foreground"
};

const trendIcon = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus
} as const;

function normalizeData(data: number[] = [2, 4, 3, 7, 5, 9, 8]) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(max - min, 1);
  return { min, max, span, data };
}

const VW = 300;
const VH = 120;
const PL = 28;
const PR = 8;
const PT = 14;
const PB = 22;

function SparkChart({ data }: { data?: number[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const { min, max, data: values } = normalizeData(data);
  const cw = VW - PL - PR;
  const ch = VH - PT - PB;
  const maxVal = Math.ceil(max);
  const midVal = Math.round(maxVal / 2);

  const points = values.map((v, i) => ({
    x: values.length <= 1 ? PL + cw / 2 : PL + (i / (values.length - 1)) * cw,
    y: PT + ch - ((v - min) / Math.max(max - min, 1)) * ch,
    value: v
  }));

  const linePath = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const gridYs = [0, 0.5, 1].map((r) => PT + ch * r);

  // Generate X-axis date labels
  const xLabels = (() => {
    const count = values.length;
    const today = new Date();
    const indexes = count <= 7
      ? Array.from({ length: count }, (_, i) => i)
      : [0, Math.floor(count / 4), Math.floor(count / 2), Math.floor(count * 3 / 4), count - 1];
    return indexes.map((idx) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (count - 1 - idx));
      return { idx, label: `${d.getMonth() + 1}/${d.getDate()}` };
    });
  })();

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const viewX = ratio * VW;
    let closest = 0;
    let closestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - viewX);
      if (d < closestD) { closestD = d; closest = i; }
    });
    setHoverIdx(closest);
  };

  const hp = hoverIdx !== null ? points[hoverIdx] : null;
  const tooltipLeft = hp ? Math.min(0.9, Math.max(0.05, (hp.x - PL) / cw)) : 0;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="h-40 w-full">
        {gridYs.map((y, i) => (
          <line key={i} x1={PL} x2={VW - PR} y1={y} y2={y} stroke="#d1d5db" strokeDasharray="3 4" strokeWidth={0.8} />
        ))}
        {[maxVal, midVal, 0].map((tick, i) => (
          <text key={i} x={PL - 4} y={gridYs[i] + 3} fill="#6b7280" fontSize={8} textAnchor="end" style={{ fontFamily: "system-ui, sans-serif" }}>{tick}</text>
        ))}
        {xLabels.map(({ idx, label }) => (
          <text key={idx} x={points[idx]?.x ?? PL} y={VH - 5} fill="#6b7280" fontSize={8} textAnchor="middle" style={{ fontFamily: "system-ui, sans-serif" }}>{label}</text>
        ))}
        <polyline points={linePath} fill="none" stroke="var(--app-primary, #2563eb)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <>
            <line x1={hp.x} x2={hp.x} y1={PT} y2={PT + ch} stroke="var(--app-primary, #2563eb)" strokeDasharray="2 3" strokeWidth={1} />
            <circle cx={hp.x} cy={hp.y} r={4} fill="var(--app-primary, #2563eb)" stroke="#fff" strokeWidth={2} />
          </>
        )}
        <rect x={PL} y={PT} width={cw} height={ch} fill="transparent" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "crosshair" }} />
      </svg>
      {hp && (
        <div
          className="absolute -top-1 rounded bg-foreground px-2 py-0.5 text-xs font-semibold text-background shadow"
          style={{ left: `${(tooltipLeft * 100).toFixed(1)}%` }}
        >
          {hp.value} 次
        </div>
      )}
    </div>
  );
}

function renderSpark(data?: number[]) {
  return <SparkChart data={data} />;
}

function renderRadial(percent = 0) {
  const normalized = Math.min(Math.max(percent, 0), 100);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-24 text-primary">
      <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="6" />
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (circumference * normalized) / 100}
        strokeLinecap="round"
        strokeWidth="6"
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}

function renderPulse(severity: MetricBentoCardSeverity) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-20 items-center justify-center rounded-full",
        severity === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
      )}
    >
      <span className="absolute size-12 rounded-full bg-current opacity-10" />
      <span className="size-5 rounded-full bg-current" />
    </span>
  );
}

function renderPeak(data?: number[]) {
  const values = data ?? [2, 4, 3, 7, 5, 9, 8];
  const maxValue = Math.max(...values, 1);

  return (
    <div className="flex h-24 items-end gap-1.5" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          data-peak-bar
          className="w-3 rounded-t-sm bg-primary/70"
          style={{ height: `${Math.max(10, (value / maxValue) * 88)}px` }}
        />
      ))}
    </div>
  );
}

export function MetricBentoCard({
  label,
  value,
  variant,
  caption,
  trend,
  data,
  percent,
  severity = "neutral",
  active = false,
  icon,
  onClick,
  className
}: MetricBentoCardProps) {
  const TrendIcon = trend ? trendIcon[trend.direction] : null;
  const visual =
    icon ??
    (variant === "spark"
      ? renderSpark(data)
      : variant === "radial"
        ? renderRadial(percent)
        : variant === "pulse"
          ? renderPulse(severity)
          : renderPeak(data));
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <strong className="mt-1 block text-3xl font-semibold leading-none text-foreground">{value}</strong>
        </div>
        {trend && TrendIcon ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
            <TrendIcon className="size-3.5" />
            {trend.text}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex min-h-40 items-end justify-between gap-3">
        <div className="min-w-0 flex-1">{visual}</div>
      </div>
      {caption ? <p className="mt-3 text-xs text-muted-foreground">{caption}</p> : null}
    </>
  );
  const cardClassName = cn(
    "rounded-lg border p-4 shadow-sm transition-colors",
    severityClass[severity],
    active && "ring-2 ring-primary/35",
    onClick && "text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className
  );

  if (!onClick) {
    return <div className={cardClassName}>{content}</div>;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      className={cardClassName}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {content}
    </div>
  );
}
