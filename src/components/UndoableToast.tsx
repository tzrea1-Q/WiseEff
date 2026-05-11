import { useEffect } from "react";

export function UndoableToast({
  message,
  timeout,
  onUndo,
  onExpire
}: {
  message: string;
  timeout: number;
  onUndo: () => void;
  onExpire: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onExpire, timeout);
    return () => window.clearTimeout(timer);
  }, [onExpire, timeout]);

  return (
    <div aria-live="polite" className="undo-toast" role="status">
      <div className="undo-toast-body">
        <span>{message}</span>
        <button className="undo-toast-action" type="button" onClick={onUndo}>
          撤销
        </button>
      </div>
      <div className="undo-toast-progress" style={{ animationDuration: `${timeout}ms` }} />
    </div>
  );
}
