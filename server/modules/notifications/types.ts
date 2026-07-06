export type NotificationSeverity = "info" | "success" | "warning" | "danger";

export type NotifyUsersInput = {
  organizationId: string;
  recipientUserIds: string[];
  category: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  actionUrl?: string;
  sourceKind?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

export type CreateNotificationInput = NotifyUsersInput & {
  id: string;
  recipientUserId: string;
};
