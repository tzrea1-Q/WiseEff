import { useId, useState } from "react";
import { Check, ChevronDown, LockKeyhole, MessageSquare, RotateCcw } from "lucide-react";
import type { ProductFeedbackAttachment, ProductFeedbackProgressEvent } from "@/domain/productFeedback/types";
import { FeedbackAttachments } from "./FeedbackAttachments";
import {
  productFeedbackResolutionLabels,
} from "@/domain/productFeedback/types";
import { cn } from "@/lib/utils";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import "./feedback-timeline.css";

export function FeedbackProgressTimeline({
  events,
  isAdmin = false,
  className,
  initialVisibleCount,
  attachments = [],
  getAttachmentObjectUrl
}: {
  events?: ProductFeedbackProgressEvent[] | null;
  isAdmin?: boolean;
  className?: string;
  initialVisibleCount?: number;
  attachments?: ProductFeedbackAttachment[];
  getAttachmentObjectUrl?: (feedbackId: string, attachmentId: string) => Promise<string>;
}) {
  const listId = useId();
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
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

  const hiddenCount = Math.max(0, visibleEvents.length - Math.max(1, initialVisibleCount ?? visibleEvents.length));
  const feedbackId = visibleEvents[0].feedbackId;
  const expanded = expandedFor === feedbackId;
  const shownEvents = (expanded ? [...visibleEvents] : visibleEvents.slice(hiddenCount)).reverse();
  return (
    <div className={cn("feedback-timeline-wrap", className)}>
    <ol id={listId} aria-label="反馈处理记录" className="feedback-timeline">
      {shownEvents.map((event) => (
        <li key={event.id} className="feedback-timeline__event">
          <div className="feedback-timeline__marker" aria-hidden="true">{event.kind === "reopened" ? <RotateCcw size={13} /> : event.kind === "submitted" || event.kind === "status_changed" ? <Check size={13} /> : event.internalMessage && !event.publicMessage ? <LockKeyhole size={13} /> : <MessageSquare size={13} />}</div>
          <div className="feedback-timeline__content">
          <div className="feedback-timeline__heading">
            <span className="font-medium text-foreground">
              {event.kind === "submitted" && "反馈已提交"}
              {event.kind === "status_changed" && (event.toStatus === "in_progress" ? "开始处理" : event.toStatus === "resolved" ? "已标记解决" : event.toStatus === "closed" ? "已关闭反馈" : "状态已更新")}
              {event.kind === "reopened" && "重新打开反馈"}
              {event.kind === "progress" && (event.author === "submitter" ? "提交人补充" : !event.publicMessage && event.internalMessage ? "内部备注" : "团队回复")}
              {event.kind === "legacy_note" && "历史内部备注"}
            </span>
            <time dateTime={event.createdAt} title={formatAbsolute(event.createdAt)}>{formatRelativeOrAbsolute(event.createdAt)}</time>
          </div>

          {event.resolutionCode && event.resolutionCode !== "completed" && (
            <p className="text-muted-foreground">
              {productFeedbackResolutionLabels[event.resolutionCode]}
            </p>
          )}

          {event.publicMessage && !(event.kind === "submitted" && event.publicMessage === "反馈已提交") && (
            <div className="feedback-timeline__message">
              {event.publicMessage}
            </div>
          )}

          {isAdmin && event.internalMessage && (
            <div className="feedback-timeline__message feedback-timeline__message--internal">
              <span className="feedback-timeline__private-label"><LockKeyhole size={12} />仅管理员可见</span>
              <p>{event.internalMessage}</p>
            </div>
          )}
          {getAttachmentObjectUrl && attachments.some((item) => item.messageId === event.id) ? <FeedbackAttachments feedbackId={event.feedbackId}
            attachments={attachments.filter((item) => item.messageId === event.id)} getAttachmentObjectUrl={getAttachmentObjectUrl} /> : null}
          </div>
        </li>
      ))}
    </ol>
      {hiddenCount > 0 && <button type="button" className="feedback-timeline__expand" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpandedFor(expanded ? null : feedbackId)}><ChevronDown size={14} />{expanded ? "收起较早记录" : `查看更早的 ${hiddenCount} 条记录`}</button>}
    </div>
  );
}
