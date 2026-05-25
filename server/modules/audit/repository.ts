import type { Queryable } from "../../shared/database/client";
import type { AuditEventDto, CreateAuditEventInput } from "./types";

type AuditEventRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "agent" | "system";
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

function toDto(row: AuditEventRow): AuditEventDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
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
      JSON.stringify(input.metadata),
      input.traceId
    ]
  );
}

export async function listAuditEvents(db: Queryable, query: { organizationId: string; projectId?: string }) {
  const result = await db.query<AuditEventRow>(
    `
    select *
    from audit_events
    where organization_id = $1
      and ($2::text is null or project_id = $2)
    order by created_at desc
    limit 100
    `,
    [query.organizationId, query.projectId ?? null]
  );

  return result.rows.map(toDto);
}
