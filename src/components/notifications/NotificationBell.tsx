import { MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type NotificationBellProps = {
  unreadCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ReactNode;
};

export function NotificationBell({ unreadCount, open, onOpenChange, panel }: NotificationBellProps) {
  const showBadge = unreadCount > 0;

  return (
    <div className="topbar-notification">
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={showBadge ? `通知，${unreadCount} 条未读` : "通知"}
        className="icon-button topbar-notification__trigger"
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onOpenChange(!open)}
      >
        <MessageSquareText size={18} />
        {showBadge ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </Button>
      {open ? panel : null}
    </div>
  );
}
