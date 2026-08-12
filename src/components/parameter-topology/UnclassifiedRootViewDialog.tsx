import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";

export type UnclassifiedRootViewDialogProps = {
  parameterCount: number;
  hasQueue: boolean;
  onOpenQueue?: () => void;
  onClose: () => void;
};

/**
 * Read-only explanation for the org「未分类」fallback bucket.
 * Real classification work lives in the compatible queue, not on this system row.
 */
export function UnclassifiedRootViewDialog({
  parameterCount,
  hasQueue,
  onOpenQueue,
  onClose
}: UnclassifiedRootViewDialogProps) {
  return (
    <ModalDialog
      open
      onDismiss={onClose}
      className="submission-dialog param-admin-module-edit-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">系统兜底</span>
              <h2 id={titleId}>未分类</h2>
              <p>组织级兜底桶，不可改名、移动或删除。参数在没有 instance / compatible 归属时会落在这里。</p>
            </div>
            <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="param-admin-module-edit-body">
            <p>
              当前直接挂有 <strong>{parameterCount}</strong> 个参数。其中总线 / 脚手架类节点不会进入归类队列；待归类的
              compatible 请在「未分类队列」中处理。
            </p>
          </div>

          <div className="dialog-actions">
            {hasQueue && onOpenQueue ? (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  onOpenQueue();
                  onClose();
                }}
              >
                打开未分类队列
              </button>
            ) : null}
            <button type="button" className="button ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
