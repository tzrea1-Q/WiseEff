import { useEffect, useState } from "react";
import { useNotificationInbox } from "@/application/notifications/useNotificationInbox";
import type { NotificationItem } from "@/domain/notifications/types";
import { createNotificationsClient } from "@/infrastructure/http/notificationsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { NotificationBell } from "./NotificationBell";
import { NotificationPanel } from "./NotificationPanel";

type TopBarNotificationsProps = {
  mockNotifications?: string[];
  onNavigate: (path: string) => void;
};

function mockItemsFromStrings(messages: string[]): NotificationItem[] {
  return messages.map((message, index) => ({
    id: `mock-notif-${index}`,
    category: "mock.notification",
    title: "系统通知",
    body: message,
    severity: "info",
    actionUrl: null,
    readAt: null,
    createdAt: new Date(Date.now() - index * 60_000).toISOString()
  }));
}

function MockTopBarNotifications({ mockNotifications }: { mockNotifications: string[] }) {
  const [open, setOpen] = useState(false);
  const mockItems = mockItemsFromStrings(mockNotifications);

  return (
    <NotificationBell
      unreadCount={mockItems.length}
      open={open}
      onOpenChange={setOpen}
      panel={
        <NotificationPanel
          items={mockItems}
          loading={false}
          error=""
          onClose={() => setOpen(false)}
          onRetry={() => undefined}
          onMarkAllRead={() => setOpen(false)}
          onOpenItem={() => setOpen(false)}
        />
      }
    />
  );
}

function ApiTopBarNotifications({ onNavigate }: { onNavigate: (path: string) => void }) {
  const inbox = useNotificationInbox(createNotificationsClient());

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

export function TopBarNotifications({ mockNotifications = [], onNavigate }: TopBarNotificationsProps) {
  if (wiseEffRuntimeMode === "api") {
    return <ApiTopBarNotifications onNavigate={onNavigate} />;
  }

  return <MockTopBarNotifications mockNotifications={mockNotifications} />;
}
