import type { NotificationsGateway } from "@/application/ports/NotificationsGateway";
import type { NotificationItem, NotificationSeverity } from "@/domain/notifications/types";
import type { NotificationsClient } from "@/infrastructure/http/notificationsClient";
import type { MockRuntimeState } from "./mockState";

function unreadCount(items: NotificationItem[]) {
  return items.filter((item) => !item.readAt).length;
}

export function createMockNotificationItem(input: {
  title?: string;
  body: string;
  category?: string;
  severity?: NotificationSeverity;
  actionUrl?: string | null;
}): NotificationItem {
  return {
    id: `mock-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: input.category ?? "mock.notification",
    title: input.title ?? "系统通知",
    body: input.body,
    severity: input.severity ?? "info",
    actionUrl: input.actionUrl ?? null,
    readAt: null,
    createdAt: new Date().toISOString()
  };
}

export function pushMockNotification(runtime: MockRuntimeState, input: Parameters<typeof createMockNotificationItem>[0]) {
  const item = createMockNotificationItem(input);
  runtime.current = {
    ...runtime.current,
    notificationInbox: [item, ...runtime.current.notificationInbox]
  };
  return item;
}

export function prependMockNotificationMessage(inbox: NotificationItem[], message: string): NotificationItem[] {
  return [createMockNotificationItem({ body: message }), ...inbox];
}

export function createStateBackedNotificationsClient(input: {
  getInbox: () => NotificationItem[];
  setInbox: (items: NotificationItem[]) => void;
}): NotificationsClient {
  return {
    async listNotifications(params = {}) {
      const items = input.getInbox();
      const filtered = params.unreadOnly ? items.filter((item) => !item.readAt) : items;
      const limit = params.limit ?? filtered.length;
      return {
        items: filtered.slice(0, limit),
        nextCursor: null
      };
    },
    async getUnreadCount() {
      return { count: unreadCount(input.getInbox()) };
    },
    async markRead(notificationId) {
      const items = input.getInbox().map((item) =>
        item.id === notificationId ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item
      );
      const updated = items.find((item) => item.id === notificationId);
      if (!updated) {
        throw new Error("Notification was not found.");
      }
      input.setInbox(items);
      return updated;
    },
    async markAllRead() {
      const now = new Date().toISOString();
      const previous = input.getInbox();
      const items = previous.map((item) => ({ ...item, readAt: item.readAt ?? now }));
      input.setInbox(items);
      return { updated: items.filter((item, index) => item.readAt !== previous[index]?.readAt).length };
    }
  };
}

export function createMockNotificationsGateway(runtime: MockRuntimeState): NotificationsGateway {
  return {
    async listNotifications(params = {}) {
      const items = runtime.current.notificationInbox;
      const filtered = params.unreadOnly ? items.filter((item) => !item.readAt) : items;
      const limit = params.limit ?? filtered.length;
      return {
        items: filtered.slice(0, limit),
        nextCursor: null
      };
    },
    async getUnreadCount() {
      return { count: unreadCount(runtime.current.notificationInbox) };
    },
    async markRead(notificationId) {
      const items = runtime.current.notificationInbox.map((item) =>
        item.id === notificationId ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item
      );
      const updated = items.find((item) => item.id === notificationId);
      if (!updated) {
        throw new Error("Notification was not found.");
      }
      runtime.current = { ...runtime.current, notificationInbox: items };
      return updated;
    },
    async markAllRead() {
      const now = new Date().toISOString();
      const items = runtime.current.notificationInbox.map((item) => ({ ...item, readAt: item.readAt ?? now }));
      const updated = items.filter((item, index) => item.readAt !== runtime.current.notificationInbox[index]?.readAt).length;
      runtime.current = { ...runtime.current, notificationInbox: items };
      return { updated };
    }
  };
}
