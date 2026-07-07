import { useEffect } from "react";

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
    <div aria-labelledby="delete-project-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="confirm-dialog delete-project-dialog">
        <h2 id="delete-project-title">
          删除项目 <strong>{projectName}</strong>
        </h2>
        <p>
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
      </div>
    </div>
  );
}
