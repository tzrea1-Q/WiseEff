export type NotificationListItemDto = {
  id: string;
  category: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "danger";
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ListNotificationsQuery = {
  organizationId: string;
  recipientUserId: string;
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type ListNotificationsResult = {
  items: NotificationListItemDto[];
  nextCursor: string | null;
};

export type UnreadCountResult = {
  count: number;
};
