import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";

export type PasteImportContentDialogProps = {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
};

export function PasteImportContentDialog({ open, initialValue, onClose, onConfirm }: PasteImportContentDialogProps) {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setDraft(initialValue);
    }
  }, [initialValue, open]);

  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      className="confirm-dialog parameter-import-paste-dialog"
      backdropClassName="parameter-import-paste-backdrop"
    >
      {({ titleId }) => (
        <>
          <div className="parameter-import-paste-dialog__header param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <h3 id={titleId}>粘贴导入内容</h3>
              <p>粘贴 JSON 数组、CSV 表头行或 DTS 片段，确认后返回向导继续解析。</p>
            </div>
            <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <label className="parameter-import-paste-dialog__field" htmlFor="parameter-import-paste-content">
            <span>导入内容</span>
            <textarea
              id="parameter-import-paste-content"
              rows={12}
              value={draft}
              placeholder="粘贴 JSON、CSV 或 DTS 片段内容"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!draft.trim()}
              onClick={() => onConfirm(draft)}
            >
              确认
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
