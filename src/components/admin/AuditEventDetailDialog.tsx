import { CircleX, Filter } from "lucide-react";
import { useEffect } from "react";
import { AuditEventDetailPanel } from "./AuditEventDetailPanel";
import { AuditRelatedTimeline } from "./AuditRelatedTimeline";
import type { AuditEventView } from "@/domain/audit/types";

export type AuditEventDetailDialogProps = {
  event: AuditEventView;
  relatedEvents: AuditEventView[];
  relatedLoading?: boolean;
  onClose: () => void;
  onSelectRelated?: (eventId: string) => void;
  onFilterTrace?: (traceId: string) => void;
};

export function AuditEventDetailDialog({
  event,
  relatedEvents,
  relatedLoading = false,
  onClose,
  onSelectRelated,
  onFilterTrace
}: AuditEventDetailDialogProps) {
  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="审计事件详情">
      <div className="submission-dialog audit-event-detail-dialog">
        <div className="submission-dialog-head audit-event-detail-dialog-head">
          <div className="audit-event-detail-dialog-head-text">
            <span className="eyebrow">审计事件详情</span>
            <h2 id="audit-event-detail-title">操作证据与变更摘要</h2>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="audit-event-detail-dialog-body">
          <AuditEventDetailPanel event={event} />
          <AuditRelatedTimeline
            events={relatedEvents}
            activeEventId={event.id}
            loading={relatedLoading}
            onSelect={onSelectRelated}
          />
        </div>

        <div className="dialog-actions audit-event-detail-dialog-actions">
          {event.traceId && onFilterTrace ? (
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                onFilterTrace(event.traceId!);
                onClose();
              }}
            >
              <Filter size={16} aria-hidden="true" />
              按 Trace 筛选列表
            </button>
          ) : null}
          <button type="button" className="button primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
