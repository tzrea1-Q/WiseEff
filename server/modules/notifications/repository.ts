import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import type { CreateNotificationInput } from "./types";
import type { ListNotificationsQuery, ListNotificationsResult, NotificationListItemDto, UnreadCountResult } from "./listTypes";

type NotificationRow = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  category: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "danger";
  action_url: string | null;
  source_kind: string | null;
  source_id: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function toListItem(row: NotificationRow): NotificationListItemDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    severity: row.severity,
    actionUrl: row.action_url,
    readAt: row.read_at,
    createdAt: row.created_at,
    metadata: row.metadata ?? {}
  };
}

export async function insertNotification(db: Queryable, input: CreateNotificationInput) {
  await db.query(
    `
    insert into user_notifications (
      id, organization_id, recipient_user_id, category, title, body, severity,
      action_url, source_kind, source_id, metadata
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    on conflict do nothing
    `,
    [
      input.id,
      input.organizationId,
      input.recipientUserId,
      input.category,
      input.title,
      input.body,
      input.severity ?? "info",
      input.actionUrl ?? null,
      input.sourceKind ?? null,
      input.sourceId ?? null,
      serializePostgresJsonb(input.metadata ?? {})
    ]
  );
}

export async function listNotifications(db: Queryable, query: ListNotificationsQuery): Promise<ListNotificationsResult> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const values: unknown[] = [query.organizationId, query.recipientUserId];
  const conditions = ["organization_id = $1", "recipient_user_id = $2"];

  if (query.unreadOnly) {
    conditions.push("read_at is null");
  }

  if (query.cursor) {
    values.push(query.cursor);
    conditions.push(`created_at < $${values.length}::timestamptz`);
  }

  values.push(limit + 1);
  const limitPlaceholder = `$${values.length}`;

  const result = await db.query<NotificationRow>(
    `
    select
      id, organization_id, recipient_user_id, category, title, body, severity,
      action_url, source_kind, source_id, metadata, read_at, created_at
    from user_notifications
    where ${conditions.join(" and ")}
    order by created_at desc
    limit ${limitPlaceholder}
    `,
    values
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toListItem);

  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.createdAt ?? null : null
  };
}

export async function getUnreadNotificationCount(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string }
): Promise<UnreadCountResult> {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from user_notifications
    where organization_id = $1
      and recipient_user_id = $2
      and read_at is null
    `,
    [input.organizationId, input.recipientUserId]
  );

  return { count: Number(result.rows[0]?.count ?? 0) };
}

export async function markNotificationRead(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string; notificationId: string }
) {
  const result = await db.query<NotificationRow>(
    `
    update user_notifications
    set read_at = coalesce(read_at, now())
    where id = $1
      and organization_id = $2
      and recipient_user_id = $3
    returning
      id, organization_id, recipient_user_id, category, title, body, severity,
      action_url, source_kind, source_id, metadata, read_at, created_at
    `,
    [input.notificationId, input.organizationId, input.recipientUserId]
  );

  return result.rows[0] ? toListItem(result.rows[0]) : null;
}

export async function markAllNotificationsRead(
  db: Queryable,
  input: { organizationId: string; recipientUserId: string }
) {
  const result = await db.query<{ count: string }>(
    `
    with updated as (
      update user_notifications
      set read_at = coalesce(read_at, now())
      where organization_id = $1
        and recipient_user_id = $2
        and read_at is null
      returning 1
    )
    select count(*)::text as count from updated
    `,
    [input.organizationId, input.recipientUserId]
  );

  return { updated: Number(result.rows[0]?.count ?? 0) };
}
