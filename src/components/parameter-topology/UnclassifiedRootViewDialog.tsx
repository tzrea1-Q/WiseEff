import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";

export type UnclassifiedRootViewDialogProps = {
  parameterCount: number;
  onClose: () => void;
};

export function UnclassifiedRootViewDialog({
  parameterCount,
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
              当前直接挂有 <strong>{parameterCount}</strong> 个参数。此处仅展示兜底归属，不提供旧 compatible 归类。
              规范主体的登记与放置由规范模块面板管理。
            </p>
          </div>

          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
