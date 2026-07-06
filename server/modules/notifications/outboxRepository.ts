import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import {
  buildNotificationOutboxIdempotencyKey,
  type NotificationOutboxPayload,
  type NotificationOutboxRecord,
  type NotificationOutboxStats,
  type NotificationOutboxStatus
} from "./outboxTypes";

type OutboxRow = {
  id: string;
  organization_id: string;
  idempotency_key: string;
  payload: NotificationOutboxPayload;
  status: NotificationOutboxStatus;
  attempts: number;
  error_message: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  dead_lettered_at: string | null;
};

function toRecord(row: OutboxRow): NotificationOutboxRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.error_message ?? undefined,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at ?? undefined,
    deadLetteredAt: row.dead_lettered_at ?? undefined
  };
}

export async function insertNotificationOutboxEntry(
  db: Queryable,
  input: { id: string; payload: NotificationOutboxPayload }
): Promise<string | null> {
  const idempotencyKey = buildNotificationOutboxIdempotencyKey(input.payload);
  const result = await db.query<{ id: string }>(
    `
    insert into notification_outbox (
      id, organization_id, idempotency_key, payload, status
    )
    values ($1, $2, $3, $4::jsonb, 'pending')
    on conflict (idempotency_key) do nothing
    returning id
    `,
    [input.id, input.payload.organizationId, idempotencyKey, serializePostgresJsonb(input.payload)]
  );

  return result.rows[0]?.id ?? null;
}

export async function claimNextNotificationOutboxEntry(
  db: Queryable,
  input: { leaseOwner?: string; leaseTtlMs?: number } = {}
): Promise<NotificationOutboxRecord | null> {
  const leaseOwner = input.leaseOwner ?? "wiseeff-notification-worker";
  const leaseTtlMs = input.leaseTtlMs ?? 60_000;
  const result = await db.query<OutboxRow>(
    `
    update notification_outbox
    set status = 'processing',
      lease_owner = $1,
      lease_expires_at = now() + ($2 * interval '1 millisecond'),
      attempts = attempts + 1,
      error_message = null,
      updated_at = now()
    where id = (
      select id
      from notification_outbox
      where status in ('pending', 'retry')
        and (next_attempt_at is null or next_attempt_at <= now())
      order by created_at asc, id asc
      for update skip locked
      limit 1
    )
    returning
      id, organization_id, idempotency_key, payload, status, attempts, error_message,
      next_attempt_at, created_at, updated_at, delivered_at, dead_lettered_at
    `,
    [leaseOwner, leaseTtlMs]
  );

  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function claimNotificationOutboxEntryById(
  db: Queryable,
  input: { outboxId: string; leaseOwner?: string; leaseTtlMs?: number }
): Promise<NotificationOutboxRecord | null> {
  const leaseOwner = input.leaseOwner ?? "wiseeff-notification-worker";
  const leaseTtlMs = input.leaseTtlMs ?? 60_000;
  const result = await db.query<OutboxRow>(
    `
    update notification_outbox
    set status = 'processing',
      lease_owner = $2,
      lease_expires_at = now() + ($3 * interval '1 millisecond'),
      attempts = attempts + 1,
      error_message = null,
      updated_at = now()
    where id = (
      select id
      from notification_outbox
      where id = $1
        and status in ('pending', 'retry')
        and (next_attempt_at is null or next_attempt_at <= now())
      for update skip locked
      limit 1
    )
    returning
      id, organization_id, idempotency_key, payload, status, attempts, error_message,
      next_attempt_at, created_at, updated_at, delivered_at, dead_lettered_at
    `,
    [input.outboxId, leaseOwner, leaseTtlMs]
  );

  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function markNotificationOutboxDelivered(db: Queryable, outboxId: string) {
  await db.query(
    `
    update notification_outbox
    set status = 'delivered',
      delivered_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      error_message = null,
      updated_at = now()
    where id = $1
    `,
    [outboxId]
  );
}

export async function markNotificationOutboxRetry(
  db: Queryable,
  input: { outboxId: string; error: string; nextAttemptAt: string; reason: string }
) {
  await db.query(
    `
    update notification_outbox
    set status = 'retry',
      error_message = $2,
      next_attempt_at = $3::timestamptz,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
    where id = $1
    `,
    [input.outboxId, `${input.error} ${input.reason}`.trim(), input.nextAttemptAt]
  );
}

export async function markNotificationOutboxDeadLettered(
  db: Queryable,
  input: { outboxId: string; error: string; reason: string }
) {
  await db.query(
    `
    update notification_outbox
    set status = 'dead_lettered',
      error_message = $2,
      dead_lettered_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
    where id = $1
    `,
    [input.outboxId, `${input.error} ${input.reason}`.trim()]
  );
}

export async function getNotificationOutboxStats(db: Queryable): Promise<NotificationOutboxStats> {
  const result = await db.query<{
    queued: number | string;
    processing: number | string;
    dead_lettered: number | string;
    oldest_queued_at: string | null;
  }>(
    `
    select
      count(*) filter (where status in ('pending', 'retry')) as queued,
      count(*) filter (where status = 'processing') as processing,
      count(*) filter (where status = 'dead_lettered') as dead_lettered,
      min(created_at) filter (where status in ('pending', 'retry')) as oldest_queued_at
    from notification_outbox
    `
  );
  const row = result.rows[0] ?? { queued: 0, processing: 0, dead_lettered: 0, oldest_queued_at: null };

  return {
    queued: Number(row.queued),
    processing: Number(row.processing),
    deadLettered: Number(row.dead_lettered),
    oldestQueuedAt: row.oldest_queued_at
  };
}
