import type { DurableQueue } from "../jobs/queuePort";

export type NotificationQueuePayload = {
  organizationId: string;
  outboxId: string;
};

export type NotificationQueue = Pick<DurableQueue<NotificationQueuePayload>, "enqueue">;

export async function enqueueNotificationOutbox(
  queue: NotificationQueue | undefined,
  payload: NotificationQueuePayload
) {
  if (!queue) return null;

  return queue.enqueue({
    name: "deliver-notification",
    payload,
    idempotencyKey: `notification-outbox:${payload.outboxId}`
  });
}
