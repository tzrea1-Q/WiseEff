import { ArrowLeft, ArrowRight, CircleX, ExternalLink, Filter, Link2 } from "lucide-react";
import { useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { AuditEventDetailPanel } from "./AuditEventDetailPanel";
import { AuditRelatedTimeline } from "./AuditRelatedTimeline";
import type { AuditEventView } from "@/domain/audit/types";

export type AuditEventDetailDialogProps = {
  event: AuditEventView;
  relatedEvents: AuditEventView[];
  relatedLoading?: boolean;
  relatedLoadingMore?: boolean;
  relatedError?: string | null;
  relatedHasMore?: boolean;
  onRetryRelated?: () => void;
  onLoadMoreRelated?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  eventUrl?: string;
  targetUrl?: string;
  onClose: () => void;
  onSelectRelated?: (eventId: string) => void;
  onFilterTrace?: (traceId: string) => void;
};

export function AuditEventDetailDialog({
  event,
  relatedEvents,
  relatedLoading = false,
  relatedLoadingMore = false,
  relatedError,
  relatedHasMore = false,
  onRetryRelated,
  onLoadMoreRelated,
  onPrevious,
  onNext,
  eventUrl,
  targetUrl,
  onClose,
  onSelectRelated,
  onFilterTrace
}: AuditEventDetailDialogProps) {
  const [copyStatus, setCopyStatus] = useState<{ eventId: string; message: string; failed: boolean } | null>(null);
  const copyEventLink = async () => {
    const url = new URL(eventUrl ?? window.location.href, window.location.origin);
    url.searchParams.set("eventId", event.id);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopyStatus({ eventId: event.id, message: "事件链接已复制", failed: false });
    } catch {
      setCopyStatus({ eventId: event.id, message: "复制失败，请从浏览器地址栏复制事件链接。", failed: true });
    }
  };
  return (
    <ModalDialog
      open
      onDismiss={onClose}
      className="submission-dialog audit-event-detail-dialog modal-card--lg"
    >
      {({ titleId }) => (
        <>
          <div className="submission-dialog-head audit-event-detail-dialog-head">
            <div className="audit-event-detail-dialog-head-text">
              <span className="eyebrow">审计事件详情</span>
              <h2 id={titleId}>操作证据与变更摘要</h2>
            </div>
            <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="audit-event-detail-dialog-body">
            <AuditEventDetailPanel key={event.id} event={event} />
            {event.traceId ? <AuditRelatedTimeline
              events={relatedEvents}
              activeEventId={event.id}
              loading={relatedLoading}
              loadingMore={relatedLoadingMore}
              error={relatedError}
              hasMore={relatedHasMore}
              onRetry={onRetryRelated}
              onLoadMore={onLoadMoreRelated}
              onSelect={onSelectRelated}
            /> : null}
            {copyStatus?.eventId === event.id ? <p className="audit-copy-status" role={copyStatus.failed ? "alert" : "status"}>{copyStatus.message}</p> : null}
          </div>

          <div className="dialog-actions audit-event-detail-dialog-actions">
            {onPrevious || onNext ? <div className="audit-event-paging" aria-label="连续浏览审计事件">
              <button type="button" className="button subtle" onClick={onPrevious} disabled={!onPrevious}><ArrowLeft size={16} aria-hidden="true" />上一条</button>
              <button type="button" className="button subtle" onClick={onNext} disabled={!onNext}>下一条<ArrowRight size={16} aria-hidden="true" /></button>
            </div> : null}
            <button type="button" className="button subtle" onClick={() => { void copyEventLink(); }}><Link2 size={16} aria-hidden="true" />复制链接</button>
            {targetUrl ? <a className="button subtle" href={targetUrl}><ExternalLink size={16} aria-hidden="true" />查看业务对象</a> : null}
            {event.traceId && onFilterTrace ? (
              <button
                type="button"
                className="button subtle"
                onClick={() => {
                  onFilterTrace(event.traceId!);
                }}
              >
                <Filter size={16} aria-hidden="true" />
                查看完整链路
              </button>
            ) : null}
            <button type="button" className="button subtle" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
