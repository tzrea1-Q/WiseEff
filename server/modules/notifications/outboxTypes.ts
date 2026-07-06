import type { NotificationSeverity } from "./types";

export const notificationOutboxStatuses = ["pending", "processing", "delivered", "retry", "dead_lettered"] as const;

export type NotificationOutboxStatus = (typeof notificationOutboxStatuses)[number];

export type NotificationOutboxPayload = {
  organizationId: string;
  recipientUserId: string;
  category: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  actionUrl?: string;
  sourceKind?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

export type NotificationOutboxRecord = {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  payload: NotificationOutboxPayload;
  status: NotificationOutboxStatus;
  attempts: number;
  errorMessage?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
};

export type NotificationOutboxStats = {
  queued: number;
  processing: number;
  deadLettered: number;
  oldestQueuedAt: string | null;
};

export function buildNotificationOutboxIdempotencyKey(payload: NotificationOutboxPayload) {
  return [
    payload.organizationId,
    payload.recipientUserId,
    payload.sourceKind ?? "",
    payload.sourceId ?? "",
    payload.category
  ].join(":");
}
