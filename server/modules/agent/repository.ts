import type { Queryable } from "../../shared/database/client";
import type {
  AgentApprovalDto,
  AgentApprovalStatus,
  AgentCitation,
  AgentContext,
  AgentMessageDto,
  AgentToolCallDto,
  AgentToolName,
  AgentToolResult,
  AgentToolStatus
} from "./types";

type AgentSessionRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  actor_user_id: string;
  page_key: string;
  role_id: string | null;
  context: unknown;
  status: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type AgentMessageRow = {
  id: string;
  role: AgentMessageDto["role"];
  content: string;
  citations: unknown;
  confidence: number | string | null;
  created_at: string | Date;
};

type AgentToolCallRow = {
  id: string;
  session_id?: string;
  organization_id?: string;
  project_id?: string | null;
  name: AgentToolName;
  label: string;
  payload: unknown;
  requires_approval: boolean;
  status: AgentToolStatus;
  result: unknown | null;
  error_message: string | null;
  audit_event_id: string | null;
  approval_id?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type AgentApprovalRow = {
  id: string;
  session_id?: string;
  organization_id?: string;
  project_id?: string | null;
  tool_call_id: string;
  title: string;
  message: string;
  status: AgentApprovalStatus;
  requested_at: string | Date;
  decided_at: string | Date | null;
  decided_by_user_id: string | null;
  decision_reason: string | null;
};

type AgentRunTraceProvider = "deterministic";

export type CreateAgentRunTraceInput = {
  id: string;
  sessionId: string;
  messageId: string;
  organizationId: string;
  provider: AgentRunTraceProvider;
  model: string;
  promptVersion: string;
  inputSummary: string;
  outputSummary: string;
  toolCallIds: string[];
  traceId: string;
};

export type AgentToolCallRecord = AgentToolCallDto & {
  sessionId: string;
  organizationId: string;
  projectId?: string;
};

export type AgentApprovalRecord = AgentApprovalDto & {
  sessionId: string;
  organizationId: string;
  projectId?: string;
};

export type AgentSessionRecord = {
  id: string;
  organizationId: string;
  projectId?: string;
  actorUserId: string;
  pageKey: string;
  roleId?: string;
  context: AgentContext;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentSessionInput = {
  id: string;
  organizationId: string;
  projectId?: string;
  actorUserId: string;
  pageKey: string;
  roleId?: string;
  context: AgentContext;
  title: string;
};

export type AppendAgentMessageInput = {
  id: string;
  sessionId: string;
  organizationId: string;
  role: AgentMessageDto["role"];
  content: string;
  citations?: AgentCitation[];
  confidence?: number;
};

export type CreateAgentToolCallInput = {
  id: string;
  sessionId: string;
  organizationId: string;
  projectId?: string;
  name: AgentToolName;
  label: string;
  payload?: Record<string, unknown>;
  requiresApproval: boolean;
  status: AgentToolStatus;
};

export type UpdateAgentToolCallInput = {
  status?: AgentToolStatus;
  result?: AgentToolResult;
  errorMessage?: string;
  auditEventId?: string;
};

export type CreateAgentApprovalInput = {
  id: string;
  sessionId: string;
  toolCallId: string;
  organizationId: string;
  projectId?: string;
  status: AgentApprovalStatus;
  title: string;
  message: string;
  requestedByUserId: string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? parseJsonString(value) : value;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function jsonArray<T>(value: unknown): T[] {
  const parsed = typeof value === "string" ? parseJsonString(value) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function toAgentContext(value: unknown): AgentContext {
  const context = jsonObject(value);
  return {
    path: typeof context.path === "string" ? context.path : "",
    pageKey: typeof context.pageKey === "string" ? context.pageKey : "",
    projectId: typeof context.projectId === "string" ? context.projectId : undefined,
    roleId: typeof context.roleId === "string" ? context.roleId : undefined
  };
}

function toAgentSessionRecord(row: AgentSessionRow): AgentSessionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id ?? undefined,
    actorUserId: row.actor_user_id,
    pageKey: row.page_key,
    roleId: row.role_id ?? undefined,
    context: toAgentContext(row.context),
    status: row.status,
    title: row.title,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toAgentMessageDto(row: AgentMessageRow): AgentMessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: jsonArray<AgentCitation>(row.citations),
    confidence: row.confidence === null ? undefined : Number(row.confidence),
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toAgentToolCallDto(row: AgentToolCallRow): AgentToolCallDto {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    payload: jsonObject(row.payload),
    requiresApproval: row.requires_approval,
    status: row.status,
    result: row.result === null ? undefined : (jsonObject(row.result) as AgentToolResult),
    error: row.error_message ?? undefined,
    approvalId: row.approval_id ?? undefined,
    auditEventId: row.audit_event_id ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    completedAt: ["succeeded", "failed", "rejected"].includes(row.status) ? dateTimeToIso(row.updated_at) : undefined
  };
}

function toAgentToolCallRecord(row: AgentToolCallRow): AgentToolCallRecord {
  return {
    ...toAgentToolCallDto(row),
    sessionId: String(row.session_id ?? ""),
    organizationId: String(row.organization_id ?? ""),
    projectId: row.project_id ?? undefined
  };
}

function toAgentApprovalDto(row: AgentApprovalRow): AgentApprovalDto {
  return {
    id: row.id,
    toolCallId: row.tool_call_id,
    title: row.title,
    message: row.message,
    status: row.status,
    createdAt: dateTimeToIso(row.requested_at),
    decidedAt: row.decided_at ? dateTimeToIso(row.decided_at) : undefined,
    decidedByUserId: row.decided_by_user_id ?? undefined,
    reason: row.decision_reason ?? undefined
  };
}

function toAgentApprovalRecord(row: AgentApprovalRow): AgentApprovalRecord {
  return {
    ...toAgentApprovalDto(row),
    sessionId: String(row.session_id ?? ""),
    organizationId: String(row.organization_id ?? ""),
    projectId: row.project_id ?? undefined
  };
}

export async function createAgentSession(db: Queryable, input: CreateAgentSessionInput): Promise<void> {
  await db.query(
    `
    insert into agent_sessions (
      id, organization_id, project_id, actor_user_id, page_key, role_id, context, title
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `,
    [
      input.id,
      input.organizationId,
      input.projectId ?? null,
      input.actorUserId,
      input.pageKey,
      input.roleId ?? null,
      JSON.stringify(input.context),
      input.title
    ]
  );
}

export async function getAgentSession(
  db: Queryable,
  organizationId: string,
  sessionId: string
): Promise<AgentSessionRecord | null> {
  const result = await db.query<AgentSessionRow>(
    `
    select id, organization_id, project_id, actor_user_id, page_key, role_id, context, status, title, created_at, updated_at
    from agent_sessions
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [organizationId, sessionId]
  );

  return result.rows[0] ? toAgentSessionRecord(result.rows[0]) : null;
}

export async function appendAgentMessage(db: Queryable, input: AppendAgentMessageInput): Promise<void> {
  await db.query(
    `
    insert into agent_messages (
      id, session_id, organization_id, role, content, citations, confidence
    )
    values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [
      input.id,
      input.sessionId,
      input.organizationId,
      input.role,
      input.content,
      JSON.stringify(input.citations ?? []),
      input.confidence ?? null
    ]
  );
}

export async function listAgentMessages(
  db: Queryable,
  organizationId: string,
  sessionId: string
): Promise<AgentMessageDto[]> {
  const result = await db.query<AgentMessageRow>(
    `
    select id, role, content, citations, confidence, created_at
    from agent_messages
    where organization_id = $1
      and session_id = $2
    order by created_at asc, id asc
    `,
    [organizationId, sessionId]
  );

  return result.rows.map(toAgentMessageDto);
}

export async function createAgentRunTrace(db: Queryable, input: CreateAgentRunTraceInput): Promise<void> {
  await db.query(
    `
    insert into agent_run_traces (
      id, session_id, message_id, organization_id, provider, model, prompt_version,
      input_summary, output_summary, tool_call_ids, trace_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      input.id,
      input.sessionId,
      input.messageId,
      input.organizationId,
      input.provider,
      input.model,
      input.promptVersion,
      input.inputSummary,
      input.outputSummary,
      input.toolCallIds,
      input.traceId
    ]
  );
}

export async function createAgentToolCall(db: Queryable, input: CreateAgentToolCallInput): Promise<void> {
  await db.query(
    `
    insert into agent_tool_calls (
      id, session_id, organization_id, project_id, name, label, payload, requires_approval, status
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    `,
    [
      input.id,
      input.sessionId,
      input.organizationId,
      input.projectId ?? null,
      input.name,
      input.label,
      JSON.stringify(input.payload ?? {}),
      input.requiresApproval,
      input.status
    ]
  );
}

export async function updateAgentToolCall(
  db: Queryable,
  organizationId: string,
  toolCallId: string,
  input: UpdateAgentToolCallInput
): Promise<boolean> {
  const result = await db.query(
    `
    update agent_tool_calls
    set status = coalesce($3, status),
      result = coalesce($4::jsonb, result),
      error_message = coalesce($5, error_message),
      audit_event_id = coalesce($6, audit_event_id),
      updated_at = now()
    where organization_id = $1
      and id = $2
      and (
        $3 is null
        or status = $3
        or status not in ('succeeded', 'failed', 'rejected')
      )
    `,
    [
      organizationId,
      toolCallId,
      input.status ?? null,
      input.result === undefined ? null : JSON.stringify(input.result),
      input.errorMessage ?? null,
      input.auditEventId ?? null
    ]
  );

  return result.rowCount === 1;
}

export async function listAgentToolCalls(
  db: Queryable,
  organizationId: string,
  sessionId: string
): Promise<AgentToolCallDto[]> {
  const result = await db.query<AgentToolCallRow>(
    `
    select
      agent_tool_calls.id, agent_tool_calls.name, agent_tool_calls.label, agent_tool_calls.payload,
      agent_tool_calls.requires_approval, agent_tool_calls.status, agent_tool_calls.result,
      agent_tool_calls.error_message, agent_tool_calls.audit_event_id, approvals.id as approval_id,
      agent_tool_calls.created_at, agent_tool_calls.updated_at
    from agent_tool_calls
    left join agent_approvals approvals on approvals.tool_call_id = agent_tool_calls.id
    where organization_id = $1
      and session_id = $2
    order by agent_tool_calls.created_at asc, agent_tool_calls.id asc
    `,
    [organizationId, sessionId]
  );

  return result.rows.map(toAgentToolCallDto);
}

export async function getAgentToolCall(
  db: Queryable,
  organizationId: string,
  toolCallId: string
): Promise<AgentToolCallRecord | null> {
  const result = await db.query<AgentToolCallRow>(
    `
    select
      tc.id, tc.session_id, tc.organization_id, tc.project_id, tc.name, tc.label, tc.payload,
      tc.requires_approval, tc.status, tc.result, tc.error_message, tc.audit_event_id,
      approvals.id as approval_id, tc.created_at, tc.updated_at
    from agent_tool_calls tc
    left join agent_approvals approvals on approvals.tool_call_id = tc.id
    where tc.organization_id = $1
      and tc.id = $2
    limit 1
    `,
    [organizationId, toolCallId]
  );

  return result.rows[0] ? toAgentToolCallRecord(result.rows[0]) : null;
}

export async function createAgentApproval(db: Queryable, input: CreateAgentApprovalInput): Promise<void> {
  await db.query(
    `
    insert into agent_approvals (
      id, session_id, tool_call_id, organization_id, project_id, status, title, message, requested_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.id,
      input.sessionId,
      input.toolCallId,
      input.organizationId,
      input.projectId ?? null,
      input.status,
      input.title,
      input.message,
      input.requestedByUserId
    ]
  );
}

export async function markAgentApprovalApproved(
  db: Queryable,
  organizationId: string,
  approvalId: string,
  decidedByUserId: string
): Promise<boolean> {
  const result = await db.query(
    `
    update agent_approvals
    set status = 'approved',
      decided_by_user_id = $3,
      decision_reason = null,
      decided_at = now()
    where organization_id = $1
      and id = $2
      and status = 'pending'
    `,
    [organizationId, approvalId, decidedByUserId]
  );

  return result.rowCount === 1;
}

export async function markAgentApprovalRejected(
  db: Queryable,
  organizationId: string,
  approvalId: string,
  decidedByUserId: string,
  reason: string
): Promise<boolean> {
  const result = await db.query(
    `
    update agent_approvals
    set status = 'rejected',
      decided_by_user_id = $3,
      decision_reason = $4,
      decided_at = now()
    where organization_id = $1
      and id = $2
      and status = 'pending'
    `,
    [organizationId, approvalId, decidedByUserId, reason]
  );

  return result.rowCount === 1;
}

export async function listAgentApprovals(
  db: Queryable,
  organizationId: string,
  sessionId: string
): Promise<AgentApprovalDto[]> {
  const result = await db.query<AgentApprovalRow>(
    `
    select id, tool_call_id, title, message, status, requested_at, decided_at, decided_by_user_id, decision_reason
    from agent_approvals
    where organization_id = $1
      and session_id = $2
    order by requested_at desc, id asc
    `,
    [organizationId, sessionId]
  );

  return result.rows.map(toAgentApprovalDto);
}

export async function getAgentApproval(
  db: Queryable,
  organizationId: string,
  approvalId: string
): Promise<AgentApprovalRecord | null> {
  const result = await db.query<AgentApprovalRow>(
    `
    select
      id, session_id, tool_call_id, organization_id, project_id, title, message, status,
      requested_at, decided_at, decided_by_user_id, decision_reason
    from agent_approvals
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [organizationId, approvalId]
  );

  return result.rows[0] ? toAgentApprovalRecord(result.rows[0]) : null;
}
