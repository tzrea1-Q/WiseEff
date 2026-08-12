import { useEffect } from "react";
import { X } from "lucide-react";

export const APP_TOAST_AUTO_DISMISS_MS = 4000;

/**
 * Global toast layer for the reducer notification queue. Mounted once in the
 * AppShell for both runtime modes so ADD_NOTIFICATION feedback is visible on
 * every route, including API mode where these messages used to be dropped.
 */
export function AppToastLayer({
  notifications,
  onDismiss
}: {
  notifications: readonly string[];
  onDismiss: () => void;
}) {
  const message = notifications.length > 0 ? notifications[0] : null;

  useEffect(() => {
    if (message === null) {
      return;
    }
    const timer = window.setTimeout(onDismiss, APP_TOAST_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
    // Re-arm the timer whenever the queue changes so a newly dispatched
    // notification always gets its full display window.
  }, [message, notifications, onDismiss]);

  return (
    <div role="status" aria-live="polite" data-testid="app-toast-layer">
      {message !== null ? (
        <div className="logs-feedback-toast app-toast" data-testid="app-toast">
          <span className="app-toast__message">{message}</span>
          <button
            className="app-toast__close"
            type="button"
            aria-label="关闭提示"
            onClick={onDismiss}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
