import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import {
  getUnreadNotificationCount,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "./repository";
import type { ListNotificationsQuery } from "./listTypes";
import type { NotifyUsersInput } from "./types";

function uniqueRecipientIds(recipientUserIds: string[]) {
  return [...new Set(recipientUserIds.map((id) => id.trim()).filter(Boolean))];
}

export async function notifyUsers(db: Queryable, input: NotifyUsersInput) {
  const recipientUserIds = uniqueRecipientIds(input.recipientUserIds);
  if (recipientUserIds.length === 0) {
    return;
  }

  await Promise.all(
    recipientUserIds.map((recipientUserId) =>
      insertNotification(db, {
        id: randomUUID(),
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
      })
    )
  );
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
