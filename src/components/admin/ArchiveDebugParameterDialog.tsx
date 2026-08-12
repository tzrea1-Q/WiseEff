import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";

export type ArchiveDebugParameterDialogProps = {
  open: boolean;
  parameterName: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ArchiveDebugParameterDialog({
  open,
  parameterName,
  loading,
  onConfirm,
  onCancel
}: ArchiveDebugParameterDialogProps) {
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
            归档参数 <code>{parameterName}</code>
          </h2>
          <p id={descriptionId}>归档后该参数将从运行时下发清单中隐藏，但不会删除历史记录。</p>
          <ul className="del-consequences">
            <li>参数定义和路径绑定会被保留，可随时恢复。</li>
            <li>操作会记录到审计日志，便于追踪归档人和时间。</li>
          </ul>
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={onConfirm}
              disabled={loading}
            >
              归档
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
