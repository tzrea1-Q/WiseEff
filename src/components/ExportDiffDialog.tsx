import { useEffect } from "react";

export type ExportDiff = {
  added: number;
  updated: number;
  deleted: number;
  affectedParameters: { name: string; kind: "added" | "updated" | "deleted" }[];
};

export function ExportDiffDialog({
  open,
  diff,
  onConfirm,
  onCancel
}: {
  open: boolean;
  diff: ExportDiff;
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
    <div aria-labelledby="export-diff-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="confirm-dialog export-diff-dialog">
        <h2 id="export-diff-title">导出 JSON 快照</h2>
        <p>将导出的快照包含以下变更（相对上次导出）：</p>
        <ul className="export-diff-summary">
          <li>新增参数：{diff.added} 项</li>
          <li>更新（元数据 / 取值）：{diff.updated} 项</li>
          <li>删除：{diff.deleted} 项</li>
        </ul>
        {diff.affectedParameters.length > 0 ? (
          <div className="export-diff-scroll">
            {diff.affectedParameters.map((parameter) => (
              <div className={`export-diff-row kind-${parameter.kind}`} key={`${parameter.kind}-${parameter.name}`}>
                <span aria-hidden="true" className="kind-mark">
                  {parameter.kind === "added" ? "+" : parameter.kind === "updated" ? "±" : "-"}
                </span>
                <code>{parameter.name}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="export-diff-empty">当前没有相对上次导出的差异。</p>
        )}
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm}>
            确认导出
          </button>
        </div>
      </div>
    </div>
  );
}
