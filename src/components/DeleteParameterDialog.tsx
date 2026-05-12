import { useEffect } from "react";

export function DeleteParameterDialog({
  open,
  parameterName,
  usedByProjects,
  onConfirm,
  onCancel
}: {
  open: boolean;
  parameterName: string;
  usedByProjects: readonly string[];
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
    <div aria-labelledby="delete-parameter-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="confirm-dialog delete-parameter-dialog">
        <h2 id="delete-parameter-title">
          删除参数 <code>{parameterName}</code>
        </h2>
        {usedByProjects.length > 0 ? (
          <>
            <p>该参数被以下项目使用，删除会同步移除这些项目的取值：</p>
            <ul className="del-projects">
              {usedByProjects.map((project) => (
                <li key={project}>{project}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>此参数目前没有任何项目使用，是一个闲置参数。</p>
        )}
        <ul className="del-consequences">
          <li>所有项目的当前值会从配置草稿中移除。</li>
          <li>删除后 10 秒内可以通过 Toast 撤销。</li>
        </ul>
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
