import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AuditEventView } from "@/domain/audit/types";
import type { RiskLevel } from "@/mockData";

export type AuditTimelineProps = {
  events: AuditEventView[];
  initialVisible?: number;
  selectedId?: string | null;
  onSelect?: (eventId: string) => void;
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

export function AuditTimeline({ events, initialVisible = 5, selectedId, onSelect, className }: AuditTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = expanded ? events : events.slice(0, initialVisible);
  const canExpand = events.length > initialVisible;

  return (
    <section className={cn("audit-timeline-panel rounded-lg border border-border bg-card", className)}>
      <header className="audit-timeline-panel-head">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">审计事件</h3>
          <span className="text-xs text-muted-foreground">{events.length} 条</span>
        </div>
      </header>
      {events.length === 0 ? (
        <p className="audit-timeline-empty text-sm text-muted-foreground">暂无审计事件</p>
      ) : (
        <>
          <ul className="audit-timeline-list">
            {visibleEvents.map((event) => {
              const selected = selectedId === event.id;
              const index = events.findIndex((item) => item.id === event.id) + 1;
              return (
                <li key={event.id} className="audit-timeline-list-item">
                  <button
                    type="button"
                    className={cn(
                      "audit-timeline-item audit-timeline-row",
                      selected && "audit-timeline-item-selected"
                    )}
                    aria-pressed={selected}
                    onClick={() => onSelect?.(event.id)}
                  >
                    <span className="audit-timeline-index" aria-hidden="true">{index}</span>
                    <span
                      className={cn(
                        "audit-timeline-severity inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10px] font-semibold uppercase",
                        severityBadge[event.severity]
                      )}
                    >
                      {severityLabel[event.severity]}
                    </span>
                    <div className="audit-timeline-content min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{event.action}</p>
                      <p className="text-xs text-muted-foreground">
                        <span>{event.actor}</span>
                        <span className="mx-1">·</span>
                        <span>{event.kind}</span>
                        <span className="mx-1">·</span>
                        <span>{event.timeLabel}</span>
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {canExpand ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="audit-timeline-expand mt-3 inline-flex h-7 items-center gap-1 rounded-md px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
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
