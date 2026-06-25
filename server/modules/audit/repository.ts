import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import type { CreateAuditEventInput } from "./types";
import type { AuditEventListItemDto, ListAuditEventsQuery, ListAuditEventsResult } from "./listTypes";

type AuditEventRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "agent" | "system";
  actor_name: string | null;
  app: string;
  kind: string;
  action: string;
  severity: "High" | "Medium" | "Low";
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string;
  created_at: string;
};

function toListItem(row: AuditEventRow): AuditEventListItemDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    actorName: row.actor_name,
    app: row.app,
    kind: row.kind,
    action: row.action,
    severity: row.severity,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    traceId: row.trace_id,
    createdAt: row.created_at
  };
}

export async function createAuditEvent(db: Queryable, input: CreateAuditEventInput) {
  await db.query(
    `
    insert into audit_events (
      id, organization_id, project_id, actor_user_id, actor_type, app, kind,
      action, severity, target_type, target_id, metadata, trace_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.actorType,
      input.app,
      input.kind,
      input.action,
      input.severity,
      input.targetType,
      input.targetId,
      serializePostgresJsonb(input.metadata ?? {}),
      input.traceId
    ]
  );
}

export async function listAuditEvents(db: Queryable, query: ListAuditEventsQuery): Promise<ListAuditEventsResult> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const values: unknown[] = [query.organizationId];
  const conditions = ["ae.organization_id = $1"];

  if (query.projectId) {
    values.push(query.projectId);
    conditions.push(`ae.project_id = $${values.length}`);
  }

  if (query.apps && query.apps.length > 0) {
    values.push(query.apps);
    conditions.push(`ae.app = any($${values.length}::text[])`);
  } else if (query.app) {
    values.push(query.app);
    conditions.push(`ae.app = $${values.length}`);
  }

  if (query.kind) {
    values.push(query.kind);
    conditions.push(`ae.kind = $${values.length}`);
  }

  if (query.severity) {
    values.push(query.severity);
    conditions.push(`ae.severity = $${values.length}`);
  }

  if (query.actorUserId) {
    values.push(query.actorUserId);
    conditions.push(`ae.actor_user_id = $${values.length}`);
  }

  if (query.targetType) {
    values.push(query.targetType);
    conditions.push(`ae.target_type = $${values.length}`);
  }

  if (query.targetId) {
    values.push(query.targetId);
    conditions.push(`ae.target_id = $${values.length}`);
  }

  if (query.traceId) {
    values.push(query.traceId);
    conditions.push(`ae.trace_id = $${values.length}`);
  }

  if (query.from) {
    values.push(query.from);
    conditions.push(`ae.created_at >= $${values.length}::timestamptz`);
  }

  if (query.to) {
    values.push(query.to);
    conditions.push(`ae.created_at <= $${values.length}::timestamptz`);
  }

  if (query.cursor) {
    values.push(query.cursor);
    conditions.push(`ae.created_at < $${values.length}::timestamptz`);
  }

  values.push(limit + 1);
  const limitParam = `$${values.length}`;

  const result = await db.query<AuditEventRow>(
    `
    select
      ae.id,
      ae.organization_id,
      ae.project_id,
      ae.actor_user_id,
      ae.actor_type,
      u.name as actor_name,
      ae.app,
      ae.kind,
      ae.action,
      ae.severity,
      ae.target_type,
      ae.target_id,
      ae.metadata,
      ae.trace_id,
      ae.created_at
    from audit_events ae
    left join users u on u.id = ae.actor_user_id
    where ${conditions.join(" and ")}
    order by ae.created_at desc, ae.id desc
    limit ${limitParam}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = rows.map(toListItem);

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt : null
  };
}
