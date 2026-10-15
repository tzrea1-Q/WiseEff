import type { AuditEventView } from "@/domain/audit/types";
import { cn } from "@/lib/utils";
import { presentAuditEvent } from "@/domain/audit/presentAuditEvent";

export type AuditRelatedTimelineProps = {
  events: AuditEventView[];
  activeEventId?: string | null;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onSelect?: (eventId: string) => void;
  className?: string;
};

export function AuditRelatedTimeline({
  events,
  activeEventId,
  loading = false,
  loadingMore = false,
  error,
  hasMore = false,
  onRetry,
  onLoadMore,
  onSelect,
  className
}: AuditRelatedTimelineProps) {
  const otherEvents = events.filter((event) => event.id !== activeEventId);
  return (
    <section className={cn("audit-related-timeline", className)} aria-label="关联事件" aria-busy={loading || loadingMore}>
      <header>
        <h4>关联事件</h4>
        {otherEvents.length > 0 ? <span>{hasMore ? "已加载其他" : "其他"} {otherEvents.length} 条</span> : null}
      </header>
      {loading && otherEvents.length === 0 ? <p className="audit-related-empty" role="status">正在加载同一操作链路的事件…</p> : null}
      {!loading && !error && otherEvents.length === 0 && !hasMore ? <p className="audit-related-empty">此操作链路没有其他事件。</p> : null}
      <ul>
        {otherEvents.map((event) => {
          const presentation = presentAuditEvent(event);
          return (
            <li key={event.id}>
              <button
                type="button"
                className="audit-related-item"
                onClick={() => onSelect?.(event.id)}
                disabled={!onSelect}
              >
                <strong>{presentation.actionLabel}</strong>
                <span>{event.timeLabel}</span>
                <span className="audit-related-item-description">{presentation.targetLabel} · {presentation.actor.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <div className="audit-related-feedback"><p className="audit-related-empty" role="alert">{error}</p>{onRetry ? <button type="button" className="button subtle" onClick={onRetry} disabled={loading || loadingMore}>重试加载</button> : null}</div> : null}
      {hasMore && onLoadMore ? <div className="audit-related-feedback"><button type="button" className="button subtle" onClick={onLoadMore} disabled={loading || loadingMore}>{loadingMore ? "正在加载…" : "加载更多关联事件"}</button></div> : null}
    </section>
  );
}
