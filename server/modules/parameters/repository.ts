import type { Queryable } from "../../shared/database/client";
import type {
  ChangeRequestDto,
  ParameterDraftDto,
  ParameterHistoryEntryDto,
  ParameterRecordDto,
  ParameterSubmissionItemDto,
  ParameterSubmissionRoundDto,
  ProjectDto,
  ProjectModuleDto
} from "./types";
import type { ParameterChangeRequestStatus, ParameterRiskLevel, ParameterSubmissionRoundStatus } from "./status";

type ProjectRow = {
  id: string;
  name: string;
  code: string;
};

type ProjectModuleRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
};

type ParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  recommended_value: string;
  updated_at: string | Date;
};

export type ProjectParameterForUpdate = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  currentValue: string;
  recommendedValue: string;
  valueVersion: number;
};

type ProjectParameterForUpdateRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  recommended_value: string;
  value_version: number | string;
};

type ParameterHistoryRow = {
  version: number | string;
  value: string;
  changed_at: string | Date;
  changed_by: string | null;
  request_id: string | null;
};

type DraftRow = {
  id: string;
  project_id: string;
  project_parameter_value_id: string;
  target_value: string;
  reason: string;
  updated_at: string | Date;
};

type SubmissionRoundRow = {
  id: string;
  project_id: string;
  project_name: string;
  submitter: string;
  status: ParameterSubmissionRoundStatus;
  summary: string;
  created_at: string | Date;
};

type ChangeRequestRow = {
  id: string;
  submission_round_id: string | null;
  project_id: string;
  project_parameter_value_id: string;
  module: string;
  title: string;
  current_value: string;
  target_value: string;
  submitter: string;
  status: ParameterChangeRequestStatus;
  risk: ParameterRiskLevel;
  created_at: string | Date;
  updated_at: string | Date;
  assigned_to: string | null;
  reviewer_note: string | null;
  reject_reason: string | null;
  fast_track: boolean;
};

type SubmissionItemRow = {
  change_request_id: string;
  project_parameter_value_id: string;
  name: string;
  module: string;
  current_value: string;
  target_value: string;
  unit: string;
  risk: ParameterRiskLevel;
  reason: string;
};

export type ListParametersQuery = {
  organizationId: string;
  projectId?: string;
  module?: string;
  risk?: ParameterRiskLevel | ParameterRiskLevel[];
  q?: string;
  limit?: number;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code
  };
}

function toProjectModuleDto(row: ProjectModuleRow): ProjectModuleDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order
  };
}

function toParameterDto(row: ParameterRow, history: ParameterHistoryEntryDto[] = []): ParameterRecordDto {
  const updatedAt = dateTimeToIso(row.updated_at);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    module: row.module,
    projectId: row.project_id,
    currentValue: row.current_value,
    recommendedValue: row.recommended_value,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    updatedAt,
    updatedAtTs: updatedAt,
    history
  };
}

function toHistoryDto(row: ParameterHistoryRow): ParameterHistoryEntryDto {
  return {
    version: String(row.version),
    value: row.value,
    changedAt: dateTimeToIso(row.changed_at),
    changedBy: row.changed_by ?? "",
    requestId: row.request_id ?? undefined
  };
}

function toDraftDto(row: DraftRow): ParameterDraftDto {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterId: row.project_parameter_value_id,
    targetValue: row.target_value,
    reason: row.reason,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toProjectParameterForUpdate(row: ProjectParameterForUpdateRow): ProjectParameterForUpdate {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    unit: row.unit,
    risk: row.risk,
    currentValue: row.current_value,
    recommendedValue: row.recommended_value,
    valueVersion: Number(row.value_version)
  };
}

function toSubmissionItemDto(row: SubmissionItemRow): ParameterSubmissionItemDto {
  return {
    requestId: row.change_request_id,
    parameterId: row.project_parameter_value_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value,
    targetValue: row.target_value,
    unit: row.unit,
    risk: row.risk,
    reason: row.reason
  };
}

function toSubmissionRoundDto(row: SubmissionRoundRow, items: ParameterSubmissionItemDto[] = []): ParameterSubmissionRoundDto {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    submitter: row.submitter,
    createdAt: dateTimeToIso(row.created_at),
    status: row.status,
    summary: row.summary,
    items
  };
}

function waitingHoursSince(value: string | Date) {
  const createdAt = new Date(dateTimeToIso(value)).getTime();
  if (Number.isNaN(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / (60 * 60 * 1000)));
}

function toChangeRequestDto(row: ChangeRequestRow): ChangeRequestDto {
  const createdAt = dateTimeToIso(row.created_at);
  const updatedAt = dateTimeToIso(row.updated_at);
  const summary = `${row.title} changes from ${row.current_value} to ${row.target_value}.`;

  return {
    id: row.id,
    submissionRoundId: row.submission_round_id ?? undefined,
    projectId: row.project_id,
    parameterId: row.project_parameter_value_id,
    module: row.module,
    title: row.title,
    currentValue: row.current_value,
    targetValue: row.target_value,
    submitter: row.submitter,
    createdAt,
    createdAtTs: createdAt,
    updatedAt,
    status: row.status,
    aiSummary: summary,
    rejectReason: row.reject_reason ?? undefined,
    waitingHours: waitingHoursSince(row.created_at),
    aiSuggestion: {
      recommendation: row.risk === "High" ? "needs-review" : "advance",
      confidence: row.risk === "Low" ? "high" : "mid",
      summary,
      reasons: [`Risk level: ${row.risk}`, `Module: ${row.module}`],
      similarRequests: []
    },
    impact: [
      {
        kind: "parameter",
        name: row.title,
        note: `Changes ${row.module} parameter from ${row.current_value} to ${row.target_value}.`,
        risk: row.risk
      },
      {
        kind: "module",
        name: row.module,
        note: `${row.risk} risk module review recommended.`,
        risk: row.risk
      }
    ],
    assignedTo: row.assigned_to ?? undefined,
    fastTrack: row.fast_track,
    reviewerNote: row.reviewer_note ?? undefined
  };
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

export async function listProjects(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
    order by name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectDto);
}

export async function listProjectModules(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectModuleRow>(
    `
    select id, project_id, name, sort_order
    from project_modules
    where organization_id = $1
      and project_id = $2
    order by sort_order asc, name asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toProjectModuleDto);
}

export async function listParameters(db: Queryable, query: ListParametersQuery) {
  const values: unknown[] = [query.organizationId];
  const where = ["ppv.organization_id = $1", "pd.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `ppv.project_id = ${placeholder}`, query.projectId);
  }

  if (query.module) {
    addCondition(where, values, (placeholder) => `pd.module = ${placeholder}`, query.module);
  }

  if (query.risk) {
    const risks = Array.isArray(query.risk) ? query.risk : [query.risk];
    addCondition(where, values, (placeholder) => `pd.risk = any(${placeholder}::text[])`, risks);
  }

  if (query.q) {
    const term = `%${query.q}%`;
    addCondition(
      where,
      values,
      (placeholder) => `(pd.name ilike ${placeholder} or pd.description ilike ${placeholder} or pd.explanation ilike ${placeholder})`,
      term
    );
  }

  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  values.push(limit);

  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ${where.join("\n      and ")}
    order by ppv.updated_at desc, pd.name asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => toParameterDto(row));
}

export async function getParameterById(db: Queryable, query: { organizationId: string; parameterId: string }) {
  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    limit 1
    `,
    [query.organizationId, query.parameterId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const history = await listParameterHistory(db, query);
  return toParameterDto(row, history);
}

export async function listParameterHistory(db: Queryable, query: { organizationId: string; parameterId: string }) {
  const result = await db.query<ParameterHistoryRow>(
    `
    select
      phe.version,
      phe.value,
      phe.changed_at,
      users.name as changed_by,
      phe.request_id
    from parameter_history_entries phe
    inner join project_parameter_values ppv on ppv.id = phe.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = phe.parameter_definition_id
    left join users on users.id = phe.changed_by_user_id
    where phe.organization_id = $1
      and ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    order by phe.changed_at desc
    `,
    [query.organizationId, query.parameterId]
  );

  return result.rows.map(toHistoryDto);
}

export async function listDraftsForUser(
  db: Queryable,
  query: { organizationId: string; userId: string; projectId?: string }
) {
  const values: unknown[] = [query.organizationId, query.userId];
  const where = ["organization_id = $1", "user_id = $2"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, query.projectId);
  }

  const result = await db.query<DraftRow>(
    `
    select id, project_id, project_parameter_value_id, target_value, reason, updated_at
    from parameter_drafts
    where ${where.join("\n      and ")}
    order by updated_at desc
    `,
    values
  );

  return result.rows.map(toDraftDto);
}

export async function upsertDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    parameterId: string;
    userId: string;
    targetValue: string;
    reason: string;
  }
) {
  const result = await db.query<DraftRow>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id,
      target_value, reason
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (project_id, project_parameter_value_id, user_id)
    do update set
      target_value = excluded.target_value,
      reason = excluded.reason,
      updated_at = now()
    returning id, project_id, project_parameter_value_id, target_value, reason, updated_at
    `,
    [input.id, input.organizationId, input.projectId, input.parameterId, input.userId, input.targetValue, input.reason]
  );

  return toDraftDto(result.rows[0]);
}

export async function deleteDraft(
  db: Queryable,
  input: { organizationId: string; userId: string; draftId: string }
) {
  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and user_id = $2
      and id = $3
    `,
    [input.organizationId, input.userId, input.draftId]
  );
}

export async function deleteDraftForParameter(
  db: Queryable,
  input: { organizationId: string; userId: string; projectId: string; parameterId: string }
) {
  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and user_id = $2
      and project_id = $3
      and project_parameter_value_id = $4
    `,
    [input.organizationId, input.userId, input.projectId, input.parameterId]
  );
}

export async function createSubmissionRound(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    submitterUserId: string;
    status: ParameterSubmissionRoundStatus;
    summary: string;
  }
) {
  const result = await db.query<SubmissionRoundRow>(
    `
    with inserted as (
      insert into parameter_submission_rounds (
        id, organization_id, project_id, submitter_user_id, status, summary
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id, project_id, submitter_user_id, status, summary, created_at
    )
    select
      inserted.id,
      inserted.project_id,
      projects.name as project_name,
      users.name as submitter,
      inserted.status,
      inserted.summary,
      inserted.created_at
    from inserted
    inner join projects on projects.id = inserted.project_id
    inner join users on users.id = inserted.submitter_user_id
    `,
    [input.id, input.organizationId, input.projectId, input.submitterUserId, input.status, input.summary]
  );

  return toSubmissionRoundDto(result.rows[0]);
}

export async function createChangeRequest(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    projectId: string;
    parameterId: string;
    parameterDefinitionId: string;
    baseVersion: number;
    currentValue: string;
    targetValue: string;
    status: ParameterChangeRequestStatus;
    submitterUserId: string;
  }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    with inserted as (
      insert into parameter_change_requests (
        id, organization_id, submission_round_id, project_id, project_parameter_value_id,
        parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning *
    )
    select
      inserted.id,
      inserted.submission_round_id,
      inserted.project_id,
      inserted.project_parameter_value_id,
      pd.module,
      pd.name as title,
      inserted.current_value,
      inserted.target_value,
      users.name as submitter,
      inserted.status,
      pd.risk,
      inserted.created_at,
      inserted.updated_at,
      assignee.name as assigned_to,
      inserted.reviewer_note,
      inserted.reject_reason,
      inserted.fast_track
    from inserted
    inner join parameter_definitions pd on pd.id = inserted.parameter_definition_id
    inner join users on users.id = inserted.submitter_user_id
    left join users assignee on assignee.id = inserted.assigned_to_user_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.projectId,
      input.parameterId,
      input.parameterDefinitionId,
      input.baseVersion,
      input.currentValue,
      input.targetValue,
      input.status,
      input.submitterUserId
    ]
  );

  return toChangeRequestDto(result.rows[0]);
}

export async function createSubmissionItem(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    changeRequestId: string;
    parameterId: string;
    currentValue: string;
    targetValue: string;
    reason: string;
  }
) {
  const result = await db.query<SubmissionItemRow>(
    `
    with inserted as (
      insert into parameter_submission_items (
        id, organization_id, submission_round_id, change_request_id, project_parameter_value_id,
        current_value, target_value, reason
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    )
    select
      inserted.change_request_id,
      inserted.project_parameter_value_id,
      pd.name,
      pd.module,
      inserted.current_value,
      inserted.target_value,
      pd.unit,
      pd.risk,
      inserted.reason
    from inserted
    inner join project_parameter_values ppv on ppv.id = inserted.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.changeRequestId,
      input.parameterId,
      input.currentValue,
      input.targetValue,
      input.reason
    ]
  );

  return toSubmissionItemDto(result.rows[0]);
}

export async function listSubmissionRounds(
  db: Queryable,
  query: { organizationId: string; projectId?: string; status?: ParameterSubmissionRoundStatus[] }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["psr.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `psr.project_id = ${placeholder}`, query.projectId);
  }

  if (query.status?.length) {
    addCondition(where, values, (placeholder) => `psr.status = any(${placeholder}::text[])`, query.status);
  }

  const result = await db.query<SubmissionRoundRow>(
    `
    select psr.id, psr.project_id, projects.name as project_name, users.name as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    inner join users on users.id = psr.submitter_user_id
    where ${where.join("\n      and ")}
    order by psr.created_at desc
    `,
    values
  );

  const rounds = result.rows.map((row) => toSubmissionRoundDto(row));
  if (rounds.length === 0) return rounds;

  const itemsByRound = await listSubmissionItemsByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: rounds.map((round) => round.id)
  });

  return rounds.map((round) => ({ ...round, items: itemsByRound.get(round.id) ?? [] }));
}
export async function listChangeRequests(
  db: Queryable,
  query: { organizationId: string; projectId?: string; status?: ParameterChangeRequestStatus[]; assignedTo?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["pcr.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `pcr.project_id = ${placeholder}`, query.projectId);
  }

  if (query.status?.length) {
    addCondition(where, values, (placeholder) => `pcr.status = any(${placeholder}::text[])`, query.status);
  }

  if (query.assignedTo) {
    addCondition(where, values, (placeholder) => `pcr.assigned_to_user_id = ${placeholder}`, query.assignedTo);
  }

  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      users.name as submitter,
      pcr.status,
      pd.risk,
      pcr.created_at,
      pcr.updated_at,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track
    from parameter_change_requests pcr
    inner join parameter_definitions pd on pd.id = pcr.parameter_definition_id
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    where ${where.join("\n      and ")}
    order by pcr.updated_at desc
    `,
    values
  );

  return result.rows.map(toChangeRequestDto);
}

export async function findOpenChangeRequest(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      users.name as submitter,
      pcr.status,
      pd.risk,
      pcr.created_at,
      pcr.updated_at,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track
    from parameter_change_requests pcr
    inner join parameter_definitions pd on pd.id = pcr.parameter_definition_id
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    where pcr.organization_id = $1
      and pcr.project_id = $2
      and pcr.project_parameter_value_id = $3
      and pcr.status not in ('merged', 'rejected', 'withdrawn')
    limit 1
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toChangeRequestDto(result.rows[0]) : null;
}

export async function getProjectParameterForUpdate(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  const result = await db.query<ProjectParameterForUpdateRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.value_version
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.id = $3
    for update
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toProjectParameterForUpdate(result.rows[0]) : null;
}

async function listSubmissionItemsByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const result = await db.query<SubmissionItemRow & { submission_round_id: string }>(
    `
    select
      psi.submission_round_id,
      psi.change_request_id,
      psi.project_parameter_value_id,
      pd.name,
      pd.module,
      psi.current_value,
      psi.target_value,
      pd.unit,
      pd.risk,
      psi.reason
    from parameter_submission_items psi
    inner join project_parameter_values ppv on ppv.id = psi.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where psi.organization_id = $1
      and psi.submission_round_id = any($2::text[])
    order by psi.id asc
    `,
    [query.organizationId, query.roundIds]
  );

  const byRound = new Map<string, ParameterSubmissionItemDto[]>();
  for (const row of result.rows) {
    const items = byRound.get(row.submission_round_id) ?? [];
    items.push(toSubmissionItemDto(row));
    byRound.set(row.submission_round_id, items);
  }

  return byRound;
}
