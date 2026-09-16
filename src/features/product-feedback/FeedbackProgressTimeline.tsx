import type { ProductFeedbackProgressEvent } from "@/domain/productFeedback/types";
import {
  productFeedbackResolutionLabels,
  productFeedbackStatusLabels
} from "@/domain/productFeedback/types";
import { cn } from "@/lib/utils";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function FeedbackProgressTimeline({
  events,
  isAdmin = false,
  className
}: {
  events?: ProductFeedbackProgressEvent[] | null;
  isAdmin?: boolean;
  className?: string;
}) {
  if (!events || events.length === 0) {
    return (
      <p className={cn("rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground", className)}>
        暂无进展记录。
      </p>
    );
  }

  // Filter out internal-only events for non-admin users
  const visibleEvents = isAdmin
    ? events
    : events.filter(
        (event) =>
          event.kind === "submitted" ||
          event.kind === "status_changed" ||
          event.kind === "reopened" ||
          Boolean(event.publicMessage?.trim())
      );

  if (visibleEvents.length === 0) {
    return (
      <p className={cn("rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground", className)}>
        暂无公开进展。
      </p>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-lg border border-border bg-muted/20 p-3", className)}>
      {visibleEvents.map((event) => (
        <div key={event.id} className="border-l-2 border-primary/40 pl-3 py-1 text-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="font-medium text-foreground">
              {event.kind === "submitted" && "反馈已提交"}
              {event.kind === "status_changed" &&
                `状态变更：${event.fromStatus ? productFeedbackStatusLabels[event.fromStatus] : ""} → ${event.toStatus ? productFeedbackStatusLabels[event.toStatus] : ""}`}
              {event.kind === "reopened" && "重新打开反馈"}
              {event.kind === "progress" && "处理进展"}
              {event.kind === "legacy_note" && "处理备注"}
            </span>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>

          {event.resolutionCode && (
            <p className="text-muted-foreground">
              解决结论：<span className="font-medium text-foreground">{productFeedbackResolutionLabels[event.resolutionCode]}</span>
            </p>
          )}

          {event.publicMessage && (
            <div className="rounded bg-background/80 p-2 text-foreground">
              <span className="text-[10px] font-semibold text-primary uppercase mr-1">处理进展:</span>
              {event.publicMessage}
            </div>
          )}

          {isAdmin && event.internalMessage && (
            <div className="rounded bg-amber-500/10 p-2 text-amber-950 dark:text-amber-200">
              <span className="text-[10px] font-semibold text-amber-600 uppercase mr-1">内部备注:</span>
              {event.internalMessage}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
