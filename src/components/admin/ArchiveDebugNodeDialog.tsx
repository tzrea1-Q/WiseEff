import { ModalDialog } from "@/components/common/ModalDialog";

export type ArchiveDebugNodeDialogProps = {
  open: boolean;
  nodeName: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ArchiveDebugNodeDialog({ open, nodeName, loading, onConfirm, onCancel }: ArchiveDebugNodeDialogProps) {
  return (
    <ModalDialog
      open={open}
      onDismiss={loading ? undefined : onCancel}
      className="confirm-dialog delete-parameter-dialog modal-card--sm"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <h2 id={titleId}>
            禁用节点 <code>{nodeName}</code>
          </h2>
          <p id={descriptionId}>禁用后该节点将从运行时节点清单中隐藏，但不会删除历史记录。</p>
          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={onCancel} disabled={loading}>
              取消
            </button>
            <button type="button" className="button danger" onClick={onConfirm} disabled={loading}>
              禁用
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
