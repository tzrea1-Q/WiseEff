import { useEffect } from "react";
import { useNotificationInbox } from "@/application/notifications/useNotificationInbox";
import type { NotificationItem } from "@/domain/notifications/types";
import { createNotificationsClient, type NotificationsClient } from "@/infrastructure/http/notificationsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { NotificationBell } from "./NotificationBell";
import { NotificationPanel } from "./NotificationPanel";

type TopBarNotificationsProps = {
  mockNotificationsClient?: NotificationsClient;
  onNavigate: (path: string) => void;
};

function InboxTopBarNotifications({
  client,
  onNavigate
}: {
  client: NotificationsClient;
  onNavigate: (path: string) => void;
}) {
  const inbox = useNotificationInbox(client);

  useEffect(() => {
    if (!inbox.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        inbox.setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inbox.open, inbox.setOpen]);

  const handleOpenItem = (item: NotificationItem) => {
    void inbox.markRead(item.id);
    if (item.actionUrl) {
      onNavigate(item.actionUrl);
    }
    inbox.setOpen(false);
  };

  return (
    <NotificationBell
      unreadCount={inbox.unreadCount}
      open={inbox.open}
      onOpenChange={inbox.setOpen}
      panel={
        <NotificationPanel
          items={inbox.items}
          loading={inbox.loading}
          error={inbox.error}
          onClose={() => inbox.setOpen(false)}
          onRetry={() => void inbox.refreshItems()}
          onMarkAllRead={() => void inbox.markAllRead()}
          onOpenItem={handleOpenItem}
        />
      }
    />
  );
}

export function TopBarNotifications({ mockNotificationsClient, onNavigate }: TopBarNotificationsProps) {
  if (wiseEffRuntimeMode === "api") {
    return <InboxTopBarNotifications client={createNotificationsClient()} onNavigate={onNavigate} />;
  }

  if (mockNotificationsClient) {
    return <InboxTopBarNotifications client={mockNotificationsClient} onNavigate={onNavigate} />;
  }

  return null;
}
