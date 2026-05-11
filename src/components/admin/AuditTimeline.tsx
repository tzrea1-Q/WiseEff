import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AuditEvent, RiskLevel } from "@/mockData";

export type AuditTimelineProps = {
  events: AuditEvent[];
  initialVisible?: number;
  className?: string;
};

const severityBadge: Record<RiskLevel, string> = {
  High: "bg-destructive/10 text-destructive",
  Medium: "bg-amber-100 text-amber-900",
  Low: "bg-muted text-muted-foreground"
};

const severityLabel: Record<RiskLevel, string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

export function AuditTimeline({ events, initialVisible = 5, className }: AuditTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = expanded ? events : events.slice(0, initialVisible);
  const canExpand = events.length > initialVisible;

  return (
    <section className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">审计事件</h3>
          <span className="text-xs text-muted-foreground">{events.length} 条</span>
        </div>
      </header>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无审计事件</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {visibleEvents.map((event) => (
              <li key={event.id} className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10px] font-semibold uppercase",
                    severityBadge[event.severity]
                  )}
                >
                  {severityLabel[event.severity]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{event.action}</p>
                  <p className="text-xs text-muted-foreground">
                    <span>{event.actor}</span>
                    <span className="mx-1">·</span>
                    <span>{event.time}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {canExpand ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-3 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
            >
              <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "收起" : `展开更多（${events.length - initialVisible}）`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
