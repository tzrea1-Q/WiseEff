export type NotificationSeverity = "info" | "success" | "warning" | "danger";

export type NotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type NotificationListResponse = {
  items: NotificationItem[];
  nextCursor: string | null;
};

export type NotificationUnreadCountResponse = {
  count: number;
};

export type ListNotificationsParams = {
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
};
