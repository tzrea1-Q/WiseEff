import { useEffect } from "react";

export type ArchiveDebugNodeDialogProps = {
  open: boolean;
  nodeName: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ArchiveDebugNodeDialog({ open, nodeName, loading, onConfirm, onCancel }: ArchiveDebugNodeDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div aria-labelledby="archive-debug-node-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="confirm-dialog delete-parameter-dialog">
        <h2 id="archive-debug-node-title">
          禁用节点 <code>{nodeName}</code>
        </h2>
        <p>禁用后该节点将从运行时节点清单中隐藏，但不会删除历史记录。</p>
        <div className="dialog-actions">
          <button type="button" className="button subtle" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button type="button" className="button danger" onClick={onConfirm} disabled={loading}>
            禁用
          </button>
        </div>
      </div>
    </div>
  );
}
