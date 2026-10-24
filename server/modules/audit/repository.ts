import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import { ApiError } from "../../shared/http/errors";
import { AUDIT_ACTION_LABELS, AUDIT_KIND_LABELS } from "../../shared/audit/auditLabels";
import { AUDIT_APP_LABELS, getAuditAppLabel } from "../../shared/audit/auditApps";
import type { CreateAuditEventInput } from "./types";
import type { AuditEventListItemDto, AuditReadSeverity, AuditValueState, ListAuditEventsQuery, ListAuditEventsResult } from "./listTypes";

const cursorTimestampSchema = z.string().datetime({ offset: true });
const cursorSchema = z.tuple([cursorTimestampSchema, z.string().min(1).max(200)]);

function parseCursor(cursor: string): { timestamp: string; id?: string } {
  // Existing clients may still send a timestamp-only cursor.
  if (cursorTimestampSchema.safeParse(cursor).success) return { timestamp: cursor };
  try {
    const [timestamp, id] = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return { timestamp, id };
  } catch { /* Invalid cursors are client errors, not PostgreSQL errors. */ }
  throw new ApiError("VALIDATION_FAILED", "Invalid audit cursor.");
}

type AuditEventRow = {
  id: string;
  organization_id: string | null;
  project_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "agent" | "system" | "integration";
  actor_name: string | null;
  historical_attribution?: AuditEventListItemDto["historicalAttribution"];
  app: string;
  kind: string;
  action: string;
  severity: AuditReadSeverity;
  project_name: string | null;
  project_code: string | null;
  target_name: string | null;
  appended_value_id: string | null;
  appended_value: unknown;
  appended_value_state: AuditValueState | null;
  cursor_timestamp: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string;
  created_at: string | Date;
};

function toListItem(row: AuditEventRow): AuditEventListItemDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    ...(row.project_name ? { projectName: row.project_name } : {}),
    ...(row.project_code ? { projectCode: row.project_code } : {}),
    ...(row.target_name ? { targetName: row.target_name } : {}),
    ...(row.appended_value_id ? { evidence: { newValue: row.appended_value, newValueState: row.appended_value_state ?? undefined, sourceLabel: "不可变参数值记录" } } : {}),
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    actorName: row.actor_name,
    ...(row.historical_attribution ? { historicalAttribution: row.historical_attribution } : {}),
    app: row.app,
    kind: row.kind,
    action: row.action,
    severity: row.severity,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    traceId: row.trace_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

/**
 * @deprecated Direct audit writes cannot prove they share the domain write's
 * transaction (ADR-0027). Use `withAuditedWrite` (or `writeAuditEventInTx` with an
 * `AuditTx` obtained via `asAuditTx` inside your transaction) from `./auditedWrite`.
 * Remaining legacy call sites are pinned by `auditRatchet.test.ts` and migrate batch
 * by batch; this function is removed when that ratchet reaches zero.
 */
export async function createAuditEvent(db: Queryable, input: CreateAuditEventInput) {
  if (input.organizationId === null) {
    throw new Error("Platform-scoped audit events must be written via writePlatformAuditEvent.");
  }

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

export async function writePlatformAuditEvent(
  db: Queryable,
  input: Omit<CreateAuditEventInput, "organizationId" | "id"> & {
    id?: string;
    affectedOrganizationIds: readonly string[];
  }
) {
  const traceId = input.traceId;
  const platformEventId = input.id ?? randomUUID();

  await db.query(
    `
    insert into audit_events (
      id, organization_id, project_id, actor_user_id, actor_type, app, kind,
      action, severity, target_type, target_id, metadata, trace_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    `,
    [
      platformEventId,
      null,
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
      traceId
    ]
  );

  for (const organizationId of input.affectedOrganizationIds) {
    await createAuditEvent(db, {
      ...input,
      id: randomUUID(),
      organizationId,
      traceId
    });
  }
}

export async function listAuditEvents(db: Queryable, query: ListAuditEventsQuery): Promise<ListAuditEventsResult> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const values: unknown[] = [query.organizationId];
  const platformPublicationScope = "(ae.organization_id is null and ae.kind = 'workflow-publication-updated')";
  const conditions = [query.includePlatformWorkflowPublication
    ? `(ae.organization_id = $1 or ${platformPublicationScope})`
    : "ae.organization_id = $1"];

  if (query.eventId) {
    values.push(query.eventId);
    conditions.push(`ae.id = $${values.length}`);
  }

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

  if (query.severities?.length) {
    values.push(query.severities);
    conditions.push(`ae.severity = any($${values.length}::text[])`);
  } else if (query.severity) {
    values.push(query.severity);
    conditions.push(`ae.severity = $${values.length}`);
  }

  if (query.actorUserId) {
    values.push(query.actorUserId);
    conditions.push(`ae.historical_attribution->'actors'->'actor_user_id'->>'id' = $${values.length}`);
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

  if (query.q && query.q.trim()) {
    const search = query.q.trim().toLocaleLowerCase();
    values.push(`%${query.q.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    const param = `$${values.length}`;
    values.push(Object.entries(AUDIT_ACTION_LABELS).filter(([, label]) => label.toLocaleLowerCase().includes(search)).map(([slug]) => slug));
    const actions = `$${values.length}`;
    values.push(Object.entries(AUDIT_KIND_LABELS).filter(([, label]) => label.toLocaleLowerCase().includes(search)).map(([slug]) => slug));
    const kinds = `$${values.length}`;
    values.push([
      ...(["系统", "System"].some((label) => label.toLocaleLowerCase().includes(search)) ? ["system"] : []),
      ...(["Agent", "小泽", getAuditAppLabel("agent")].some((label) => label.toLocaleLowerCase().includes(search)) ? ["agent"] : [])
    ]);
    const actors = `$${values.length}`;
    values.push(Object.keys(AUDIT_APP_LABELS).filter((app) => getAuditAppLabel(app).toLocaleLowerCase().includes(search)));
    const apps = `$${values.length}`;
    values.push(Object.keys(AUDIT_APP_LABELS));
    const knownApps = `$${values.length}`;
    values.push(getAuditAppLabel("").includes(search));
    const unknownApp = `$${values.length}`;
    conditions.push(
      `(ae.action ilike ${param} or ae.kind ilike ${param} or ae.app ilike ${param}
        or coalesce(ae.target_id, '') ilike ${param} or coalesce(ae.historical_attribution->'actors'->'actor_user_id'->>'name', '') ilike ${param}
        or coalesce(p.name, '') ilike ${param} or coalesce(p.code, '') ilike ${param}
        or coalesce(revision.content->>'displayName', definition.property_key, '') ilike ${param}
        or ae.action = any(${actions}::text[]) or ae.kind = any(${kinds}::text[]) or ae.actor_type = any(${actors}::text[])
        or ae.app = any(${apps}::text[]) or (${unknownApp}::boolean and not (ae.app = any(${knownApps}::text[]))))`
    );
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
    const cursor = parseCursor(query.cursor);
    values.push(cursor.timestamp);
    const timestamp = `$${values.length}::timestamptz`;
    if (cursor.id) {
      values.push(cursor.id);
      conditions.push(`(ae.created_at, ae.id) < (${timestamp}, $${values.length})`);
    } else {
      conditions.push(`ae.created_at < ${timestamp}`);
    }
  }

  values.push(limit + 1);
  const limitParam = `$${values.length}`;

  const result = await db.query<AuditEventRow>(
    `
    select
      ae.id,
      ae.organization_id,
      ae.project_id,
      p.name as project_name,
      p.code as project_code,
      coalesce(nullif(revision.content->>'displayName', ''), definition.property_key) as target_name,
      appended_value.id as appended_value_id,
      appended_value.value as appended_value,
      appended_value.value_state as appended_value_state,
      ae.actor_user_id,
      ae.actor_type,
      ae.historical_attribution->'actors'->'actor_user_id'->>'name' as actor_name,
      ae.historical_attribution,
      ae.app,
      ae.kind,
      ae.action,
      ae.severity,
      ae.target_type,
      ae.target_id,
      ae.metadata,
      ae.trace_id,
      ae.created_at,
      to_char(ae.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_timestamp
    from audit_events ae
    left join projects p on p.id = ae.project_id and p.organization_id = ae.organization_id
    left join public.project_parameter_value_change_requests request
      on request.id = case when ae.target_type = 'project-parameter-value-change-request' then ae.target_id end
     and request.organization_id = ae.organization_id and request.project_id = ae.project_id
    left join parameter_catalog.project_parameter_bindings binding
      on binding.id = coalesce(ae.metadata->>'bindingId', ae.metadata->>'targetBindingId', request.binding_id,
        case when ae.target_type = 'project-parameter-binding' then ae.target_id end)
     and binding.organization_id = ae.organization_id and binding.project_id = ae.project_id
    left join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
    left join parameter_catalog.project_parameter_values appended_value
      on ae.app = 'parameter-bindings' and ae.action = 'project-value-appended'
     and ae.actor_type = 'system' and ae.target_type = 'project-value'
     and appended_value.id = ae.target_id and appended_value.id = ae.metadata->>'valueId'
     and appended_value.binding_id = binding.id and appended_value.definition_id = binding.definition_id
     and appended_value.source_ref <> 'canonical-binding-identity'
    left join parameter_catalog.definition_revisions revision
      on revision.id = binding.effective_revision_id and revision.definition_id = binding.definition_id
    where ${conditions.join(" and ")}
    order by ae.created_at desc, ae.id desc
    limit ${limitParam}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = rows.map(toListItem);

  // Fetch event-linked history once for this page. Names above are current lookup
  // context; values below come only from immutable old/new history pins.
  if (items.length > 0) {
    const histories = await db.query<{
      audit_id: string; binding_id: string; target_name: string; old_value_id: string | null;
      new_value_id: string | null; previous_value: unknown; new_value: unknown; value_changed: boolean;
      previous_value_state: AuditValueState | null; new_value_state: AuditValueState | null;
    }>(`
      select ae.id as audit_id, binding.id as binding_id,
        coalesce(nullif(revision.content->>'displayName', ''), definition.property_key) as target_name,
        old_value.id as old_value_id, new_value.id as new_value_id,
        old_value.value as previous_value, new_value.value as new_value,
        old_value.value_state as previous_value_state, new_value.value_state as new_value_state,
        (old_value.id is distinct from new_value.id and
          (old_value.value is distinct from new_value.value or old_value.value_state is distinct from new_value.value_state)) as value_changed
      from audit_events ae
      join parameter_catalog.binding_history_events history on history.success_audit_ref = ae.id
      join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
        and binding.organization_id = ae.organization_id and binding.project_id = ae.project_id
      join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
      join parameter_catalog.definition_revisions revision on revision.id = history.new_effective_revision_id
        and revision.definition_id = binding.definition_id
      left join parameter_catalog.project_parameter_values old_value
        on old_value.id = history.old_current_value_id and old_value.binding_id = binding.id
        and old_value.definition_id = binding.definition_id and old_value.source_ref <> 'canonical-binding-identity'
      left join parameter_catalog.project_parameter_values new_value
        on new_value.id = history.new_current_value_id and new_value.binding_id = binding.id
        and new_value.definition_id = binding.definition_id and new_value.source_ref <> 'canonical-binding-identity'
      where ae.organization_id = $1 and ae.id = any($2::text[])
      order by binding.id, history.id`, [query.organizationId, items.map((item) => item.id)]);
    for (const item of items) {
      const eventHistories = histories.rows.filter((history) => history.audit_id === item.id);
      if (eventHistories.length === 0) continue;
      const evidence = eventHistories.filter((history) => history.value_changed);
      const unchangedCount = eventHistories.length - evidence.length;
      if (evidence.length > 1) item.targetName = `${evidence[0].target_name} 等 ${evidence.length} 个参数`;
      else if (evidence.length === 1) item.targetName ??= evidence[0].target_name;
      const previous = evidence.filter((history) => history.old_value_id !== null);
      const next = evidence.filter((history) => history.new_value_id !== null);
      item.evidence = {
        ...(previous.length ? {
          previousValue: evidence.length === 1 ? previous[0].previous_value : previous.map((history) => ({ target: history.target_name, value: history.previous_value, valueState: history.previous_value_state })),
          ...(evidence.length === 1 ? { previousValueState: previous[0].previous_value_state ?? undefined } : {})
        } : {}),
        ...(next.length ? {
          newValue: evidence.length === 1 ? next[0].new_value : next.map((history) => ({ target: history.target_name, value: history.new_value, valueState: history.new_value_state })),
          ...(evidence.length === 1 ? { newValueState: next[0].new_value_state ?? undefined } : {})
        } : {}),
        sourceLabel: evidence.length === 0
          ? `不可变参数变更历史 · ${unchangedCount} 项历史记录未改变参数值`
          : `不可变参数变更历史${unchangedCount ? ` · 另 ${unchangedCount} 项历史记录未改变参数值` : ""}`
      };
    }
  }

  return {
    items,
    nextCursor: hasMore && rows.length > 0
      ? Buffer.from(JSON.stringify([rows[rows.length - 1].cursor_timestamp, rows[rows.length - 1].id])).toString("base64url")
      : null
  };
}
