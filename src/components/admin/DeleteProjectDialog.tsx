import { ModalDialog } from "@/components/common/ModalDialog";

export function DeleteProjectDialog({
  open,
  projectName,
  projectCode,
  parameterCount = 0,
  moduleCount = 0,
  loading = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  projectName: string;
  projectCode: string;
  parameterCount?: number;
  moduleCount?: number;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog
      open={open}
      onDismiss={loading ? undefined : onCancel}
      className="confirm-dialog delete-project-dialog"
      backdropClassName="param-admin-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <h2 id={titleId}>
            删除项目 <strong>{projectName}</strong>
          </h2>
          <p id={descriptionId}>
            确认删除项目 <code>{projectCode}</code>？此操作不可撤销，将移除项目基础信息
            {parameterCount > 0 ? `及其 ${parameterCount} 个参数值` : ""}
            {moduleCount > 0 ? `和 ${moduleCount} 个模块` : ""}。
            共享参数库中的参数定义会保留。
          </p>
          <div className="dialog-actions">
            <button className="button subtle" type="button" disabled={loading} onClick={onCancel}>
              取消
            </button>
            <button className="button danger" type="button" disabled={loading} onClick={onConfirm}>
              {loading ? "删除中…" : "确认删除"}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
