import type { Queryable } from "../../shared/database/client";
import type {
  CandidateBlocker,
  CandidateDiagnostic,
  CandidateImpact,
  CandidateStatus,
  InsertParameterFileCandidateInput,
  ParameterFileFormat,
  ParsedIndex,
  ProjectParameterFileCandidateDto,
  UpdateParameterFileCandidateParseResultInput
} from "./types";

type CandidateRow = {
  id: string;
  organization_id: string;
  project_id: string;
  file_id: string | null;
  file_name: string;
  format: ParameterFileFormat;
  status: CandidateStatus;
  base_version_id: string | null;
  storage_key: string | null;
  checksum: string | null;
  size_bytes: number | string | null;
  parsed_index: ParsedIndex;
  diagnostics: CandidateDiagnostic[] | null;
  impact: CandidateImpact | null;
  blockers: CandidateBlocker[] | null;
  created_by_user_id: string | null;
  initiator_type: "user" | "agent" | "system";
  initiator_system_kind: "service" | "job" | null;
  initiator_system_name: string | null;
  initiator_session_id: string | null;
  initiator_tool_call_id: string | null;
  initiator_approval_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  abandoned_at: string | Date | null;
  abandoned_by_user_id: string | null;
  activated_at: string | Date | null;
  activated_by_user_id: string | null;
  activated_version_id: string | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toCandidateDto(row: CandidateRow): ProjectParameterFileCandidateDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    fileId: row.file_id ?? undefined,
    fileName: row.file_name,
    format: row.format,
    status: row.status,
    baseVersionId: row.base_version_id ?? undefined,
    storageKey: row.storage_key ?? undefined,
    checksum: row.checksum ?? undefined,
    sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
    parsedIndex: row.parsed_index ?? {},
    diagnostics: row.diagnostics ?? [],
    impact: row.impact ?? {},
    blockers: row.blockers ?? [],
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    createdByUserId: row.created_by_user_id ?? undefined,
    ...(row.initiator_type && row.initiator_type !== "user"
      ? {
          initiatorType: row.initiator_type,
          initiatorSystemKind: row.initiator_system_kind ?? undefined,
          initiatorSystemName: row.initiator_system_name ?? undefined,
          initiatorSessionId: row.initiator_session_id ?? undefined,
          initiatorToolCallId: row.initiator_tool_call_id ?? undefined,
          initiatorApprovalId: row.initiator_approval_id ?? undefined,
        }
      : {}),
    abandonedAt: row.abandoned_at ? dateTimeToIso(row.abandoned_at) : undefined,
    abandonedByUserId: row.abandoned_by_user_id ?? undefined,
    activatedAt: row.activated_at ? dateTimeToIso(row.activated_at) : undefined,
    activatedByUserId: row.activated_by_user_id ?? undefined,
    activatedVersionId: row.activated_version_id ?? undefined
  };
}

const candidateSelect = `
  id, organization_id, project_id, file_id, file_name, format, status,
  base_version_id, storage_key, checksum, size_bytes, parsed_index,
  diagnostics, impact, blockers, created_by_user_id,
  initiator_type, initiator_system_kind, initiator_system_name,
  initiator_session_id, initiator_tool_call_id, initiator_approval_id,
  created_at, updated_at,
  abandoned_at, abandoned_by_user_id, activated_at, activated_by_user_id, activated_version_id
`;

export async function insertParameterFileCandidate(
  db: Queryable,
  input: InsertParameterFileCandidateInput
): Promise<ProjectParameterFileCandidateDto> {
  const result = await db.query<CandidateRow>(
    `
    insert into project_parameter_file_candidates (
      id, organization_id, project_id, file_id, file_name, format, status,
      base_version_id, storage_key, checksum, size_bytes, parsed_index,
      diagnostics, impact, blockers, created_by_user_id,
      initiator_type, initiator_system_kind, initiator_system_name,
      initiator_session_id, initiator_tool_call_id, initiator_approval_id
    )
    values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12::jsonb,
      $13::jsonb, $14::jsonb, $15::jsonb, $16,
      $17, $18, $19, $20, $21, $22
    )
    returning ${candidateSelect}
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.fileId ?? null,
      input.fileName,
      input.format,
      input.status,
      input.baseVersionId ?? null,
      input.storageKey ?? null,
      input.checksum ?? null,
      input.sizeBytes ?? null,
      JSON.stringify(input.parsedIndex ?? {}),
      JSON.stringify(input.diagnostics ?? []),
      JSON.stringify(input.impact ?? {}),
      JSON.stringify(input.blockers ?? []),
      input.attribution ? input.attribution.userId : input.createdByUserId ?? null,
      input.attribution?.initiatorType ?? "user",
      input.attribution?.systemKind ?? null,
      input.attribution?.systemName ?? null,
      input.attribution?.sessionId ?? null,
      input.attribution?.toolCallId ?? null,
      input.attribution?.approvalId ?? null
    ]
  );

  return toCandidateDto(result.rows[0]);
}

export async function getParameterFileCandidateById(
  db: Queryable,
  query: { organizationId: string; projectId: string; candidateId: string }
): Promise<ProjectParameterFileCandidateDto | null> {
  const result = await db.query<CandidateRow>(
    `
    select ${candidateSelect}
    from project_parameter_file_candidates
    where id = $1
      and organization_id = $2
      and project_id = $3
    limit 1
    `,
    [query.candidateId, query.organizationId, query.projectId]
  );
  const row = result.rows[0];
  return row ? toCandidateDto(row) : null;
}

export async function listParameterFileCandidates(
  db: Queryable,
  query: { organizationId: string; projectId: string; fileId?: string; includeAbandoned?: boolean }
): Promise<ProjectParameterFileCandidateDto[]> {
  const params: unknown[] = [query.organizationId, query.projectId];
  let sql = `
    select ${candidateSelect}
    from project_parameter_file_candidates
    where organization_id = $1
      and project_id = $2
  `;
  if (query.fileId) {
    params.push(query.fileId);
    sql += ` and file_id = $${params.length}`;
  }
  if (!query.includeAbandoned) {
    sql += ` and status <> 'abandoned'`;
  }
  sql += ` order by created_at desc, id desc`;

  const result = await db.query<CandidateRow>(sql, params);
  return result.rows.map(toCandidateDto);
}

export async function updateParameterFileCandidateParseResult(
  db: Queryable,
  input: UpdateParameterFileCandidateParseResultInput & { baseVersionId?: string | null; fileId?: string }
): Promise<ProjectParameterFileCandidateDto | null> {
  const result = await db.query<CandidateRow>(
    `
    update project_parameter_file_candidates
    set status = $2,
        storage_key = coalesce($3, storage_key),
        checksum = coalesce($4, checksum),
        size_bytes = coalesce($5, size_bytes),
        parsed_index = coalesce($6::jsonb, parsed_index),
        diagnostics = coalesce($7::jsonb, diagnostics),
        impact = coalesce($8::jsonb, impact),
        blockers = coalesce($9::jsonb, blockers),
        base_version_id = coalesce($10, base_version_id),
        file_id = coalesce($11, file_id),
        updated_at = now()
    where id = $1
    returning ${candidateSelect}
    `,
    [
      input.candidateId,
      input.status,
      input.storageKey ?? null,
      input.checksum ?? null,
      input.sizeBytes ?? null,
      input.parsedIndex == null ? null : JSON.stringify(input.parsedIndex),
      input.diagnostics == null ? null : JSON.stringify(input.diagnostics),
      input.impact == null ? null : JSON.stringify(input.impact),
      input.blockers == null ? null : JSON.stringify(input.blockers),
      input.baseVersionId === undefined ? null : input.baseVersionId,
      input.fileId ?? null
    ]
  );
  const row = result.rows[0];
  return row ? toCandidateDto(row) : null;
}

export async function abandonParameterFileCandidate(
  db: Queryable,
  input: { candidateId: string; abandonedByUserId: string }
): Promise<ProjectParameterFileCandidateDto | null> {
  const result = await db.query<CandidateRow>(
    `
    update project_parameter_file_candidates
    set status = 'abandoned',
        abandoned_at = now(),
        abandoned_by_user_id = $2,
        updated_at = now()
    where id = $1
      and status in ('ready', 'blocked', 'failed', 'stale')
    returning ${candidateSelect}
    `,
    [input.candidateId, input.abandonedByUserId]
  );
  const row = result.rows[0];
  return row ? toCandidateDto(row) : null;
}

export async function markParameterFileCandidateStale(
  db: Queryable,
  input: { candidateId: string }
): Promise<ProjectParameterFileCandidateDto | null> {
  const result = await db.query<CandidateRow>(
    `
    update project_parameter_file_candidates
    set status = 'stale',
        updated_at = now()
    where id = $1
      and status = 'ready'
    returning ${candidateSelect}
    `,
    [input.candidateId]
  );
  const row = result.rows[0];
  return row ? toCandidateDto(row) : null;
}

export async function markParameterFileCandidateActive(
  db: Queryable,
  input: {
    candidateId: string;
    activatedByUserId: string;
    activatedVersionId: string;
    fileId: string;
    baseVersionId?: string | null;
  }
): Promise<ProjectParameterFileCandidateDto | null> {
  const result = await db.query<CandidateRow>(
    `
    update project_parameter_file_candidates
    set status = 'active',
        file_id = $2,
        base_version_id = coalesce($3, base_version_id),
        activated_at = now(),
        activated_by_user_id = $4,
        activated_version_id = $5,
        updated_at = now()
    where id = $1
      and status = 'ready'
    returning ${candidateSelect}
    `,
    [
      input.candidateId,
      input.fileId,
      input.baseVersionId ?? null,
      input.activatedByUserId,
      input.activatedVersionId
    ]
  );
  const row = result.rows[0];
  return row ? toCandidateDto(row) : null;
}
