import type { AuditEventView } from "@/domain/audit/types";
import { cn } from "@/lib/utils";

export type AuditRelatedTimelineProps = {
  events: AuditEventView[];
  activeEventId?: string | null;
  loading?: boolean;
  onSelect?: (eventId: string) => void;
  className?: string;
};

export function AuditRelatedTimeline({
  events,
  activeEventId,
  loading = false,
  onSelect,
  className
}: AuditRelatedTimelineProps) {
  if (loading) {
    return <p className={cn("audit-related-empty", className)}>正在加载同一 trace 的关联事件…</p>;
  }

  if (events.length <= 1) {
    return null;
  }

  return (
    <section className={cn("audit-related-timeline", className)} aria-label="Trace 关联事件">
      <header>
        <h4>同一 Trace 链路</h4>
        <span>{events.length} 条</span>
      </header>
      <ul>
        {events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className={cn("audit-related-item", activeEventId === event.id && "audit-related-item-active")}
              onClick={() => onSelect?.(event.id)}
            >
              <span>{event.kind}</span>
              <strong>{event.action}</strong>
              <span>{event.timeLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
