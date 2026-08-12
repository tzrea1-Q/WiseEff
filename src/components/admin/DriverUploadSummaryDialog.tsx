import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import type { IngestDriverSummary } from "@/application/ports/ParameterFileRepository";

export type DriverUploadSummaryDialogProps = {
  fileName: string;
  summary: IngestDriverSummary;
  onClose: () => void;
  onOpenUnregisteredQueue?: () => void;
};

/**
 * One-shot post-upload report: registered vs newly observed unregistered compatibles.
 */
export function DriverUploadSummaryDialog({
  fileName,
  summary,
  onClose,
  onOpenUnregisteredQueue,
}: DriverUploadSummaryDialogProps) {
  const hasUnregistered = summary.newUnregisteredCount > 0;

  return (
    <ModalDialog
      open
      onDismiss={onClose}
      className="submission-dialog param-admin-module-edit-dialog driver-upload-summary-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">驱动登记</span>
              <h2 id={titleId}>上传对照摘要</h2>
              <p>
                已解析 <code>{fileName}</code> 中的 compatible，并与本组织已登记驱动对照（不做持久化报告）。
              </p>
            </div>
            <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="param-admin-module-edit-body driver-upload-summary-dialog__body">
            <dl className="driver-upload-summary-dialog__stats">
              <div>
                <dt>命中已登记</dt>
                <dd>
                  <strong>{summary.matchedRegisteredCount}</strong>
                  <span>个</span>
                </dd>
              </div>
              <div>
                <dt>新未登记</dt>
                <dd>
                  <strong className={hasUnregistered ? "is-warn" : undefined}>
                    {summary.newUnregisteredCount}
                  </strong>
                  <span>个</span>
                </dd>
              </div>
            </dl>

            {summary.matchedRegisteredCount === 0 && summary.newUnregisteredCount === 0 ? (
              <p className="muted">这份 DTS 没有可对照的非脚手架 compatible。</p>
            ) : null}

            {summary.matchedRegistered.length > 0 ? (
              <section aria-labelledby="driver-upload-matched-title">
                <h3 id="driver-upload-matched-title">已登记并命中</h3>
                <ul className="driver-upload-summary-dialog__list">
                  {summary.matchedRegistered.map((compatible) => (
                    <li key={compatible}>
                      <code>{compatible}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {summary.newUnregistered.length > 0 ? (
              <section aria-labelledby="driver-upload-unregistered-title">
                <h3 id="driver-upload-unregistered-title">新发现未登记</h3>
                <ul className="driver-upload-summary-dialog__list">
                  {summary.newUnregistered.map((compatible) => (
                    <li key={compatible}>
                      <code>{compatible}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="param-admin-module-edit-actions">
            {hasUnregistered && onOpenUnregisteredQueue ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  onOpenUnregisteredQueue();
                  onClose();
                }}
              >
                去处理未登记驱动
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
