import { useEffect } from "react";
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
    <div aria-labelledby="archive-debug-parameter-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="confirm-dialog delete-parameter-dialog">
        <h2 id="archive-debug-parameter-title">
          归档参数 <code>{parameterName}</code>
        </h2>
        <p>归档后该参数将从运行时下发清单中隐藏，但不会删除历史记录。</p>
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
      </div>
    </div>
  );
}
