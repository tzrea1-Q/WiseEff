import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "./repository";
import type { ListNotificationsQuery } from "./listTypes";
import type { NotifyUsersInput } from "./types";
import { getNotificationDeliveryConfig } from "./delivery";
import { enqueueNotificationOutbox } from "./notificationQueue";
import { insertNotificationOutboxEntry } from "./outboxRepository";
import { deliverNotificationPayload } from "./outboxWorker";
import type { NotificationOutboxPayload } from "./outboxTypes";

function uniqueRecipientIds(recipientUserIds: string[]) {
  return [...new Set(recipientUserIds.map((id) => id.trim()).filter(Boolean))];
}

function toOutboxPayload(input: NotifyUsersInput, recipientUserId: string): NotificationOutboxPayload {
  return {
    organizationId: input.organizationId,
    recipientUserId,
    category: input.category,
    title: input.title,
    body: input.body,
    severity: input.severity,
    actionUrl: input.actionUrl,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    metadata: input.metadata
  };
}

export async function notifyUsers(db: Queryable, input: NotifyUsersInput) {
  const recipientUserIds = uniqueRecipientIds(input.recipientUserIds);
  if (recipientUserIds.length === 0) {
    return;
  }

  const delivery = getNotificationDeliveryConfig();

  for (const recipientUserId of recipientUserIds) {
    const outboxId = randomUUID();
    const payload = toOutboxPayload(input, recipientUserId);
    const insertedId = await insertNotificationOutboxEntry(db, { id: outboxId, payload });
    if (!insertedId) {
      continue;
    }

    if (delivery.mode === "sync") {
      await deliverNotificationPayload(db, { outboxId: insertedId, payload });
      continue;
    }

    await enqueueNotificationOutbox(delivery.queue, {
      organizationId: input.organizationId,
      outboxId: insertedId
    });
  }
}

export async function listUserNotifications(db: Queryable, query: ListNotificationsQuery) {
  return listNotifications(db, query);
}

export async function getUserUnreadNotificationCount(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string }
) {
  return getUnreadNotificationCount(db, input);
}

export async function markUserNotificationRead(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string; notificationId: string }
) {
  return markNotificationRead(db, input);
}

export async function markAllUserNotificationsRead(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string }
) {
  return markAllNotificationsRead(db, input);
}
