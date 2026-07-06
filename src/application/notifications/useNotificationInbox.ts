import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationItem } from "@/domain/notifications/types";
import {
  createNotificationsClient,
  type NotificationsClient
} from "@/infrastructure/http/notificationsClient";

const unreadPollIntervalMs = 60_000;

export function useNotificationInbox(client: NotificationsClient = createNotificationsClient()) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clientRef = useRef(client);
  clientRef.current = client;

  const refreshUnreadCount = useCallback(async () => {
    try {
      const result = await clientRef.current.getUnreadCount();
      setUnreadCount(result.count);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载通知");
    }
  }, []);

  const refreshItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await clientRef.current.listNotifications({ limit: 20 });
      setItems(result.items);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载通知");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
    const intervalId = window.setInterval(() => void refreshUnreadCount(), unreadPollIntervalMs);
    const handleFocus = () => void refreshUnreadCount();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!open) return;
    void refreshItems();
  }, [open, refreshItems]);

  const markRead = useCallback(async (notificationId: string) => {
    const previousItems = items;
    const previousUnread = unreadCount;
    setItems((current) =>
      current.map((item) => (item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item))
    );
    setUnreadCount((current) => Math.max(0, current - (previousItems.find((item) => item.id === notificationId && !item.readAt) ? 1 : 0)));

    try {
      await clientRef.current.markRead(notificationId);
      await refreshUnreadCount();
    } catch {
      setItems(previousItems);
      setUnreadCount(previousUnread);
    }
  }, [items, refreshUnreadCount, unreadCount]);

  const markAllRead = useCallback(async () => {
    const previousItems = items;
    const previousUnread = unreadCount;
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);

    try {
      await clientRef.current.markAllRead();
      await refreshUnreadCount();
    } catch {
      setItems(previousItems);
      setUnreadCount(previousUnread);
    }
  }, [items, refreshUnreadCount, unreadCount]);

  return useMemo(
    () => ({
      open,
      setOpen,
      unreadCount,
      items,
      loading,
      error,
      refreshItems,
      markRead,
      markAllRead
    }),
    [error, items, loading, markAllRead, markRead, open, refreshItems, unreadCount]
  );
}
