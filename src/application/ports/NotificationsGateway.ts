import type {
  ListNotificationsParams,
  NotificationItem,
  NotificationListResponse,
  NotificationUnreadCountResponse
} from "@/domain/notifications/types";

export interface NotificationsGateway {
  listNotifications(params?: ListNotificationsParams): Promise<NotificationListResponse>;
  getUnreadCount(): Promise<NotificationUnreadCountResponse>;
  markRead(notificationId: string): Promise<NotificationItem>;
  markAllRead(): Promise<{ updated: number }>;
}
