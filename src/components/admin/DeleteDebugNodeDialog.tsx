import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export type DeleteDebugNodeDialogProps = {
  open: boolean;
  nodeName: string;
  loading: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteDebugNodeDialog({
  open,
  nodeName,
  loading,
  error,
  onConfirm,
  onCancel
}: DeleteDebugNodeDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title={`永久删除节点 ${nodeName}`}
      description={
        <>
          <p>
            此操作不可恢复，并会同时删除该节点的 HDC / ADB 路径绑定。已有调试历史记录的节点无法删除，请改用禁用。
          </p>
          {error ? (
            <p className="governance-confirm-dialog__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
      confirmLabel="删除节点"
      tone="danger"
      pending={loading}
      pendingLabel="删除中…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
