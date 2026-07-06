import type { Queryable } from "../../shared/database/client";
import type { NotificationOutboxStats } from "./outboxTypes";
import { getNotificationOutboxStats } from "./outboxRepository";

export type NotificationOutboxHealth = NotificationOutboxStats & {
  ok: boolean;
  status: "ready" | "degraded" | "failed";
  oldestQueuedAgeMs: number | null;
  message?: string;
};

export function buildNotificationOutboxHealth(
  input: NotificationOutboxStats & { now?: Date }
): NotificationOutboxHealth {
  const now = input.now ?? new Date();
  const oldestQueuedAgeMs = input.oldestQueuedAt
    ? Math.max(0, now.getTime() - new Date(input.oldestQueuedAt).getTime())
    : null;

  if (input.deadLettered > 0) {
    return {
      ...input,
      ok: false,
      status: "degraded",
      oldestQueuedAgeMs,
      message: `${input.deadLettered} notification outbox entr(ies) are dead-lettered.`
    };
  }

  return {
    ...input,
    ok: true,
    status: "ready",
    oldestQueuedAgeMs
  };
}

export async function checkNotificationOutboxHealth(db?: Queryable): Promise<NotificationOutboxHealth> {
  if (!db) {
    return {
      queued: 0,
      processing: 0,
      deadLettered: 0,
      oldestQueuedAt: null,
      ok: false,
      status: "failed",
      oldestQueuedAgeMs: null,
      message: "DATABASE_URL is not configured for notification outbox health."
    };
  }

  try {
    return buildNotificationOutboxHealth(await getNotificationOutboxStats(db));
  } catch (error) {
    return {
      queued: 0,
      processing: 0,
      deadLettered: 0,
      oldestQueuedAt: null,
      ok: false,
      status: "failed",
      oldestQueuedAgeMs: null,
      message: error instanceof Error ? error.message : "Notification outbox health check failed."
    };
  }
}
