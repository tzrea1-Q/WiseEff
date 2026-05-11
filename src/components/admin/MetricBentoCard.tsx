import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
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

  return data.map((value, index) => {
    const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
    const y = 36 - ((value - min) / span) * 30 + 4;
    return { x, y, value };
  });
}

function renderSpark(data?: number[]) {
  const points = normalizeData(data);
  const pointString = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

  return (
    <svg aria-hidden="true" viewBox="0 0 100 44" className="h-12 w-full text-primary">
      <polyline points={pointString} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function renderRadial(percent = 0) {
  const normalized = Math.min(Math.max(percent, 0), 100);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-14 text-primary">
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
        "relative flex size-12 items-center justify-center rounded-full",
        severity === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
      )}
    >
      <span className="absolute size-8 rounded-full bg-current opacity-10" />
      <span className="size-3 rounded-full bg-current" />
    </span>
  );
}

function renderPeak(data?: number[]) {
  const points = normalizeData(data);
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="flex h-12 items-end gap-1" aria-hidden="true">
      {points.map((point, index) => (
        <span
          key={`${point.value}-${index}`}
          data-peak-bar
          className="w-2 rounded-t-sm bg-primary/70"
          style={{ height: `${Math.max(8, (point.value / maxValue) * 44)}px` }}
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
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <strong className="mt-1 block text-2xl font-semibold leading-none text-foreground">{value}</strong>
        </div>
        {trend && TrendIcon ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
            <TrendIcon className="size-3.5" />
            {trend.text}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex min-h-14 items-end justify-between gap-3">
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
