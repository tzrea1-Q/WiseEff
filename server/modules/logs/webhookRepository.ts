import type { Queryable } from "../../shared/database/client";

/** One delivery ATTEMPT (P3b); a webhook send with retries produces several rows. */
export type LogWebhookDeliveryDto = {
  id: string;
  logDomainId: string;
  logRecordId?: string;
  runId?: string;
  kind: "result" | "test";
  attempt: number;
  status: "delivered" | "retrying" | "failed";
  httpStatus?: number;
  error?: string;
  createdAt: string;
};

type LogWebhookDeliveryRow = {
  id: string;
  log_domain_id: string;
  log_record_id: string | null;
  run_id: string | null;
  kind: "result" | "test";
  attempt: number;
  status: "delivered" | "retrying" | "failed";
  http_status: number | null;
  error: string | null;
  created_at: string | Date;
};

function toDto(row: LogWebhookDeliveryRow): LogWebhookDeliveryDto {
  return {
    id: row.id,
    logDomainId: row.log_domain_id,
    logRecordId: row.log_record_id ?? undefined,
    runId: row.run_id ?? undefined,
    kind: row.kind,
    attempt: row.attempt,
    status: row.status,
    httpStatus: row.http_status ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

export async function insertLogWebhookDelivery(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    logDomainId: string;
    logRecordId?: string;
    runId?: string;
    kind: "result" | "test";
    attempt: number;
    status: "delivered" | "retrying" | "failed";
    httpStatus?: number;
    error?: string;
  }
): Promise<void> {
  await db.query(
    `
    insert into log_webhook_deliveries (
      id, organization_id, log_domain_id, log_record_id, run_id, kind, attempt, status, http_status, error
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.id,
      input.organizationId,
      input.logDomainId,
      input.logRecordId ?? null,
      input.runId ?? null,
      input.kind,
      input.attempt,
      input.status,
      input.httpStatus ?? null,
      input.error ?? null
    ]
  );
}

export async function listRecentLogWebhookDeliveries(
  db: Queryable,
  query: { organizationId: string; domainId: string; limit?: number }
): Promise<LogWebhookDeliveryDto[]> {
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);
  const result = await db.query<LogWebhookDeliveryRow>(
    `
    select id, log_domain_id, log_record_id, run_id, kind, attempt, status, http_status, error, created_at
    from log_webhook_deliveries
    where organization_id = $1
      and log_domain_id = $2
    order by created_at desc, id desc
    limit $3
    `,
    [query.organizationId, query.domainId, limit]
  );

  return result.rows.map(toDto);
}
