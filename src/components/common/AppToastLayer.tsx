import { useEffect } from "react";
import { useToast, type ToastTone } from "@/components/common/toast/ToastProvider";

/**
 * Word-level tone inference for reducer notifications: the queue carries plain
 * strings (dozens of ADD_NOTIFICATION call sites), so the bridge classifies
 * failure vocabulary as danger and completion vocabulary as success.
 */
export function inferNotificationTone(message: string): ToastTone {
  if (/失败|无法|错误|拒绝|超时|不可用|异常/.test(message)) {
    return "danger";
  }
  if (/^已|成功|完成/.test(message)) {
    return "success";
  }
  return "info";
}

/**
 * Bridge from the reducer notification queue (`state.notifications`, pushed by
 * ADD_NOTIFICATION in both runtime modes) into the design-system ToastProvider,
 * so there is exactly one toast renderer. Each queue entry is drained into a
 * toast (with inferred tone) and immediately consumed via DISMISS_NOTIFICATION;
 * display timing, hover-pause, and manual close are owned by ToastCard.
 */
export function AppToastLayer({
  notifications,
  onDismiss
}: {
  notifications: readonly string[];
  onDismiss: () => void;
}) {
  const { toast } = useToast();
  const message = notifications.length > 0 ? notifications[0] : null;

  useEffect(() => {
    if (message === null) {
      return;
    }
    toast({ tone: inferNotificationTone(message), message });
    // Consume the queue entry right away; the effect re-runs on the new array
    // reference, so back-to-back identical messages each get their own toast.
    onDismiss();
  }, [message, notifications, onDismiss, toast]);

  return null;
}
