import type { Queryable } from "../../shared/database/client";
import type {
  ChangeRequestDto,
  ParameterSubmissionItemDto,
  ParameterSubmissionRoundDto,
  ParameterWorkflowAssigneesDto
} from "./types";
import type { BackendRoleId } from "../auth/types";
import {
  getMostAdvancedActiveParameterStatus,
  type ParameterReviewDecision,
  type ParameterRiskLevel,
  type ParameterSubmissionRoundStatus
} from "./status";
import type { ParameterChangeRequestStatus } from "../parameter-kernel/workflowStatus";
import { buildChangeRequestImpact } from "./impact";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "../parameter-kernel/legacyParameterIdentityNames";
import { presentProvisionalSurfaceDescription } from "../parameter-specs/provisionalSurfacePresentation";
import type { BindingWriteLockFields, EnablementWriteLockFields, ParameterChangeAction } from "../parameter-drafts/types";
import { addCondition, dateTimeToIso } from "../../shared/database/sqlUtil";
import { resolveParameterValueKind } from "./repositoryShared";
import {
  PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL,
  PINNED_OR_RANKED_SPEC_VERSION_FROM_INSERTED_BINDING_LATERAL
} from "./specVersionSelection";

const RETAINED_SUBMITTER_SQL = "coalesce(users.name, '已注销用户')";

export async function findOpenEnablementChangeRequest(
  db: Queryable,
  query: { organizationId: string; projectId: string; logicalNodeId: string }
): Promise<{ id: string; status: ParameterChangeRequestStatus } | null> {
  const result = await db.query<{ id: string; status: ParameterChangeRequestStatus }>(
    `
    select id, status
    from parameter_change_requests
    where organization_id = $1
      and project_id = $2
      and logical_node_id = $3
      and edit_subject_kind = 'node-enablement'
      and status not in ('merged', 'rejected', 'withdrawn')
    limit 1
    `,
    [query.organizationId, query.projectId, query.logicalNodeId]
  );
  return result.rows[0] ?? null;
}

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
  parameter_definition_id?: string;
  edit_subject_kind?: string | null;
  logical_node_id?: string | null;
  base_version?: number | string;
  module: string;
  module_description?: string | null;
  parameter_description?: string | null;
  title: string;
  current_value: string;
  target_value: string;
  action?: ParameterChangeAction;
  candidate_config_revision_id?: string | null;
  submitter: string;
  submitter_user_id?: string | null;
  status: ParameterChangeRequestStatus;
  risk: ParameterRiskLevel;
  created_at: string | Date;
  updated_at: string | Date;
  assigned_to: string | null;
  assigned_to_user_id?: string | null;
  workflow_hardware_committer_user_id?: string | null;
  workflow_software_committer_user_id?: string | null;
  workflow_software_user_id?: string | null;
  reviewer_note: string | null;
  reject_reason: string | null;
  fast_track: boolean;
  value_kind?: string | null;
  config_format?: string;
  source_file_name?: string | null;
  source_node_path?: string | null;
};

/** Prefer binding leaf module name; fall back to spec-key prefix. */
const CR_MODULE_NAME_SEMANTIC_EXPR = `
      coalesce(
        nullif(trim(binding_pm.name), ''),
        nullif(split_part(ps.specification_key, '/', 1), ''),
        ''
      )`;
const CR_MODULE_NAME_SEMANTIC_SQL = `${CR_MODULE_NAME_SEMANTIC_EXPR} as module`;

/**
 * Prefer category/ancestor module intro over instance boilerplate
 * (e.g. "sc8562@6E DTS 实例模块。").
 */
const CR_MODULE_DESCRIPTION_FROM_BINDING_EXPR = `
      coalesce(
        (
          select nullif(trim(ancestor.description), '')
          from parameter_modules ancestor
          where binding_pm.path is not null
            and ancestor.id = any(string_to_array(binding_pm.path, '/'))
            and ancestor.id is distinct from binding_pm.id
            and coalesce(ancestor.description, '') !~ 'DTS 实例模块'
          order by ancestor.depth desc
          limit 1
        ),
        nullif(trim(binding_pm.description), '')
      )`;
const CR_MODULE_DESCRIPTION_FROM_BINDING_SQL = `${CR_MODULE_DESCRIPTION_FROM_BINDING_EXPR} as module_description`;

const CR_MODULE_JOINS_SEMANTIC_SQL = `
    left join project_parameter_bindings b on b.id = pcr.project_parameter_binding_id
    left join parameter_modules binding_pm on binding_pm.id = b.module_id`;

function semanticSourceFileNameSql(tableAlias: string): string {
  return `(
    select f.file_name
    from project_parameter_file_versions pfv
    inner join project_parameter_files f on f.id = pfv.file_id
    where pfv.id = ${tableAlias}.source_file_version_id
  )`;
}

/** `node/prop` so `findBoundNode` can strip the property and match `dts_nodes.node_path`. */
const SEMANTIC_SOURCE_NODE_PATH_SQL = `
      case
        when nullif(trim(both '/' from coalesce(lnr.node_locator, '')), '') is null then null
        when nullif(trim(coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))), '') is null
          then trim(both '/' from lnr.node_locator)
        else trim(both '/' from lnr.node_locator) || '/' || coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))
      end`;

const SEMANTIC_LNR_FROM_BINDING_SQL = `
    left join lateral (
      select lnr.node_locator, lnr.name
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = coalesce(b.logical_node_id, pcr.logical_node_id)
      order by
        case
          when pcr.base_config_revision_id is not null
            and lnr.config_revision_id = pcr.base_config_revision_id then 0
          else 1
        end,
        lnr.config_revision_id desc
      limit 1
    ) lnr on true`;

/** Legacy: prefer binding leaf name, else definition module label. */
const CR_MODULE_NAME_LEGACY_SQL = `
      coalesce(nullif(trim(binding_pm.name), ''), pd.module) as module`;

const CR_MODULE_DESCRIPTION_LEGACY_SQL = `
      coalesce(
        nullif(trim(def_pm.description), ''),
        (
          select nullif(trim(ancestor.description), '')
          from parameter_modules ancestor
          where binding_pm.path is not null
            and ancestor.id = any(string_to_array(binding_pm.path, '/'))
            and ancestor.id is distinct from binding_pm.id
            and coalesce(ancestor.description, '') !~ 'DTS 实例模块'
          order by ancestor.depth desc
          limit 1
        ),
        nullif(trim(binding_pm.description), '')
      ) as module_description`;

const CR_MODULE_JOINS_LEGACY_SQL = `
    left join project_parameter_bindings b on b.id = pcr.project_parameter_binding_id
    left join parameter_modules binding_pm on binding_pm.id = b.module_id
    left join parameter_modules def_pm on def_pm.id = pd.parameter_module_id`;

const CR_PARAMETER_DESCRIPTION_SEMANTIC_EXPR = `nullif(trim(psv.description), '')`;
const CR_PARAMETER_DESCRIPTION_SEMANTIC_SQL = `${CR_PARAMETER_DESCRIPTION_SEMANTIC_EXPR} as parameter_description`;

const CR_PARAMETER_DESCRIPTION_LEGACY_SQL = `
      nullif(trim(pd.description), '') as parameter_description`;

type WorkflowAssigneesRow = {
  submission_round_id: string;
  workflow_hardware_committer_user_id: string | null;
  workflow_software_committer_user_id: string | null;
  workflow_software_user_id: string | null;
};

export type ReviewDecisionDto = {
  id: string;
  requestId: string;
  reviewerUserId?: string;
  decision: ParameterReviewDecision;
  fromStatus: ParameterChangeRequestStatus;
  toStatus: ParameterChangeRequestStatus;
  note?: string;
  createdAt: string;
};

type ReviewDecisionRow = {
  id: string;
  request_id: string;
  reviewer_user_id: string | null;
  decision: ParameterReviewDecision;
  from_status: ParameterChangeRequestStatus;
  to_status: ParameterChangeRequestStatus;
  note: string | null;
  created_at: string | Date;
};

export type ChangeRequestMergeResult = {
  id: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  projectId: string;
  targetValue: string;
  action: ParameterChangeAction;
  baseVersion: number;
  newVersion: number;
  parameterSpecId?: string;
  projectParameterBindingId?: string;
  candidateConfigRevisionId?: string;
  logicalNodeId?: string;
};

type ChangeRequestMergeRow = {
  id: string;
  project_parameter_value_id: string;
  parameter_definition_id: string;
  project_id: string;
  target_value: string;
  action?: ParameterChangeAction;
  base_version: number | string;
  new_version: number | string;
  parameter_spec_id?: string | null;
  project_parameter_binding_id?: string | null;
  candidate_config_revision_id?: string | null;
  logical_node_id?: string | null;
};

type SubmissionItemRow = {
  change_request_id: string;
  project_parameter_value_id: string;
  name: string;
  module: string;
  current_value: string;
  target_value: string;
  action?: ParameterChangeAction;
  candidate_config_revision_id?: string | null;
  unit: string;
  risk: ParameterRiskLevel;
  reason: string;
  value_kind?: string | null;
  config_format?: string;
};

function toSubmissionItemDto(row: SubmissionItemRow): ParameterSubmissionItemDto {
  return {
    requestId: row.change_request_id,
    parameterId: row.project_parameter_value_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value,
    targetValue: row.target_value,
    action: row.action ?? "set",
    candidateConfigRevisionId: row.candidate_config_revision_id ?? undefined,
    unit: row.unit,
    risk: row.risk,
    reason: row.reason,
    valueKind: resolveParameterValueKind({
      value_kind: row.value_kind ?? null,
      config_format: row.config_format ?? ""
    })
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

function workflowAssigneesFromRow(row: {
  workflow_hardware_committer_user_id?: string | null;
  workflow_software_committer_user_id?: string | null;
  workflow_software_user_id?: string | null;
}): ParameterWorkflowAssigneesDto | undefined {
  if (
    !row.workflow_hardware_committer_user_id ||
    !row.workflow_software_committer_user_id ||
    !row.workflow_software_user_id
  ) {
    return undefined;
  }

  return {
    hardwareCommitterId: row.workflow_hardware_committer_user_id,
    softwareCommitterId: row.workflow_software_committer_user_id,
    softwareUserId: row.workflow_software_user_id
  };
}

function waitingHoursSince(value: string | Date) {
  const createdAt = new Date(dateTimeToIso(value)).getTime();
  if (Number.isNaN(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / (60 * 60 * 1000)));
}

function buildChangeRequestSummary(row: ChangeRequestRow): string {
  if (row.action === "delete") {
    return `${row.title} 将从目标配置中删除。`;
  }
  const valueKind = resolveParameterValueKind({
    value_kind: row.value_kind ?? null,
    config_format: row.config_format ?? ""
  });

  if (valueKind === "complex") {
    const lineCount = Math.max(
      row.current_value.split(/\r?\n/).filter((line) => line.trim()).length,
      row.target_value.split(/\r?\n/).filter((line) => line.trim()).length,
      1
    );
    const differenceLabel = row.current_value === row.target_value ? "当前与目标一致" : "当前与目标不同";
    return `${row.title} 为复杂配置（${lineCount} 行），${differenceLabel}。`;
  }

  return `${row.title} 从 ${row.current_value.trim()} 调整为 ${row.target_value.trim()}。`;
}

async function toChangeRequestDto(db: Queryable, row: ChangeRequestRow): Promise<ChangeRequestDto> {
  const createdAt = dateTimeToIso(row.created_at);
  const updatedAt = dateTimeToIso(row.updated_at);
  const summary = buildChangeRequestSummary(row);
  const parameterDescription = presentProvisionalSurfaceDescription(
    row.title,
    row.parameter_description
  );
  const impact = await buildChangeRequestImpact(db, {
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    title: row.title,
    module: row.module,
    currentValue: row.current_value,
    targetValue: row.target_value,
    risk: row.risk,
    sourceFileName: row.source_file_name,
    sourceNodePath: row.source_node_path
  });

  return {
    id: row.id,
    submissionRoundId: row.submission_round_id ?? undefined,
    projectId: row.project_id,
    ...(row.edit_subject_kind === "node-enablement"
      ? { editSubjectKind: "node-enablement" as const }
      : row.edit_subject_kind === "binding"
        ? { editSubjectKind: "binding" as const }
        : {}),
    ...(row.logical_node_id ? { logicalNodeId: row.logical_node_id } : {}),
    parameterId: row.project_parameter_value_id,
    baseVersion: row.base_version === undefined ? undefined : Number(row.base_version),
    module: row.module,
    ...(row.module_description?.trim()
      ? { moduleDescription: row.module_description.trim() }
      : {}),
    ...(parameterDescription ? { parameterDescription } : {}),
    title: row.title,
    currentValue: row.current_value,
    targetValue: row.target_value,
    action: row.action ?? "set",
    candidateConfigRevisionId: row.candidate_config_revision_id ?? undefined,
    submitter: row.submitter,
    submitterUserId: row.submitter_user_id ?? undefined,
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
    impact,
    assignedTo: row.assigned_to_user_id ?? row.assigned_to ?? undefined,
    workflowAssignees: workflowAssigneesFromRow(row),
    fastTrack: row.fast_track,
    reviewerNote: row.reviewer_note ?? undefined,
    valueKind: resolveParameterValueKind({
      value_kind: row.value_kind ?? null,
      config_format: row.config_format ?? ""
    })
  };
}

function toReviewDecisionDto(row: ReviewDecisionRow): ReviewDecisionDto {
  return {
    id: row.id,
    requestId: row.request_id,
    reviewerUserId: row.reviewer_user_id ?? undefined,
    decision: row.decision,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note ?? undefined,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toChangeRequestMergeResult(row: ChangeRequestMergeRow): ChangeRequestMergeResult {
  return {
    id: row.id,
    projectParameterValueId: row.project_parameter_value_id,
    parameterDefinitionId: row.parameter_definition_id,
    projectId: row.project_id,
    targetValue: row.target_value,
    action: row.action ?? "set",
    baseVersion: Number(row.base_version),
    newVersion: Number(row.new_version),
    ...(row.parameter_spec_id ? { parameterSpecId: row.parameter_spec_id } : {}),
    ...(row.project_parameter_binding_id
      ? { projectParameterBindingId: row.project_parameter_binding_id }
      : {}),
    ...(row.candidate_config_revision_id
      ? { candidateConfigRevisionId: row.candidate_config_revision_id }
      : {}),
    ...(row.logical_node_id ? { logicalNodeId: row.logical_node_id } : {})
  };
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
      ${RETAINED_SUBMITTER_SQL} as submitter,
      inserted.status,
      inserted.summary,
      inserted.created_at
    from inserted
    inner join projects on projects.id = inserted.project_id
    left join users on users.id = inserted.submitter_user_id
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
    action?: ParameterChangeAction;
    status: ParameterChangeRequestStatus;
    submitterUserId: string;
    assignedToUserId?: string;
    workflowAssignees?: Partial<ParameterWorkflowAssigneesDto>;
    parameterSpecId?: string;
    projectParameterBindingId?: string;
    candidateConfigRevisionId?: string;
    writeLock?: BindingWriteLockFields;
  }
) {
  if (parameterIdentityMode() === "semantic") {
    const bindingId = input.projectParameterBindingId ?? input.parameterId;
    const result = await db.query<ChangeRequestRow>(
      `
      with inserted as (
        insert into parameter_change_requests (
          id, organization_id, submission_round_id, project_id,
          base_version, current_value, target_value, status, submitter_user_id,
          assigned_to_user_id, workflow_hardware_committer_user_id, workflow_software_committer_user_id,
          workflow_software_user_id, parameter_spec_id, project_parameter_binding_id,
          candidate_config_revision_id,
          base_config_revision_id, binding_revision_id, property_occurrence_id,
          source_file_version_id, expected_checksum, occurrence_span, action
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23)
        returning *
      )
      select
        inserted.id,
        inserted.submission_round_id,
        inserted.project_id,
        coalesce(inserted.project_parameter_binding_id, '') as project_parameter_value_id,
        coalesce(split_part(ps.specification_key, '/', 1), '') as module,
        coalesce(split_part(ps.specification_key, '/', 2), ps.specification_key, '') as title,
        inserted.current_value,
        inserted.target_value,
        inserted.action,
        inserted.candidate_config_revision_id,
        ${RETAINED_SUBMITTER_SQL} as submitter,
        inserted.status,
        'Low' as risk,
        'legacy-text' as value_kind,
        'DTS' as config_format,
        inserted.created_at,
        inserted.updated_at,
        inserted.assigned_to_user_id,
        inserted.workflow_hardware_committer_user_id,
        inserted.workflow_software_committer_user_id,
        inserted.workflow_software_user_id,
        assignee.name as assigned_to,
        inserted.reviewer_note,
        inserted.reject_reason,
        inserted.fast_track,
        null::text as source_file_name,
        null::text as source_node_path
      from inserted
      left join parameter_specs ps on ps.id = inserted.parameter_spec_id
      left join users on users.id = inserted.submitter_user_id
      left join users assignee on assignee.id = inserted.assigned_to_user_id
      `,
      [
        input.id,
        input.organizationId,
        input.submissionRoundId,
        input.projectId,
        input.baseVersion,
        input.currentValue,
        input.targetValue,
        input.status,
        input.submitterUserId,
        input.assignedToUserId ?? null,
        input.workflowAssignees?.hardwareCommitterId ?? null,
        input.workflowAssignees?.softwareCommitterId ?? null,
        input.workflowAssignees?.softwareUserId ?? null,
        input.parameterSpecId ?? null,
        bindingId,
        input.candidateConfigRevisionId ?? null,
        input.writeLock?.baseConfigRevisionId ?? null,
        input.writeLock?.bindingRevisionId ?? null,
        input.writeLock?.propertyOccurrenceId ?? null,
        input.writeLock?.sourceFileVersionId ?? null,
        input.writeLock?.expectedChecksum ?? null,
        input.writeLock?.occurrenceSpan ? JSON.stringify(input.writeLock.occurrenceSpan) : null,
        input.action ?? "set"
      ]
    );
    return toChangeRequestDto(db, result.rows[0]);
  }

  const result = await db.query<ChangeRequestRow>(
    `
    with inserted as (
      insert into parameter_change_requests (
        id, organization_id, submission_round_id, project_id, project_parameter_value_id,
        parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id,
        assigned_to_user_id, workflow_hardware_committer_user_id, workflow_software_committer_user_id,
        workflow_software_user_id, parameter_spec_id, project_parameter_binding_id, action
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      inserted.action,
      inserted.candidate_config_revision_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      inserted.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      inserted.created_at,
      inserted.updated_at,
      inserted.assigned_to_user_id,
      inserted.workflow_hardware_committer_user_id,
      inserted.workflow_software_committer_user_id,
      inserted.workflow_software_user_id,
      assignee.name as assigned_to,
      inserted.reviewer_note,
      inserted.reject_reason,
      inserted.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from inserted
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = inserted.parameter_definition_id
    left join users on users.id = inserted.submitter_user_id
    left join users assignee on assignee.id = inserted.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = inserted.project_parameter_value_id
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
      input.submitterUserId,
      input.assignedToUserId ?? null,
      input.workflowAssignees?.hardwareCommitterId ?? null,
      input.workflowAssignees?.softwareCommitterId ?? null,
      input.workflowAssignees?.softwareUserId ?? null,
      input.parameterSpecId ?? null,
      input.projectParameterBindingId ?? null,
      input.action ?? "set"
    ]
  );

  return toChangeRequestDto(db, result.rows[0]);
}

export async function createEnablementChangeRequest(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    projectId: string;
    logicalNodeId: string;
    baseVersion: number;
    currentValue: string;
    targetValue: string;
    action?: ParameterChangeAction;
    status: ParameterChangeRequestStatus;
    submitterUserId: string;
    assignedToUserId?: string;
    workflowAssignees?: Partial<ParameterWorkflowAssigneesDto>;
    candidateConfigRevisionId?: string;
    writeLock?: EnablementWriteLockFields;
  }
) {
  const result = await db.query<ChangeRequestRow>(
    `
    with inserted as (
      insert into parameter_change_requests (
        id, organization_id, submission_round_id, project_id,
        base_version, current_value, target_value, status, submitter_user_id,
        assigned_to_user_id, workflow_hardware_committer_user_id, workflow_software_committer_user_id,
        workflow_software_user_id, parameter_spec_id, project_parameter_binding_id,
        candidate_config_revision_id,
        base_config_revision_id, binding_revision_id, property_occurrence_id,
        source_file_version_id, expected_checksum, occurrence_span, action,
        edit_subject_kind, logical_node_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null, null, $14, $15, null, $16, $17, $18, $19::jsonb, $20, 'node-enablement', $21)
      returning *
    )
    select
      inserted.id,
      inserted.submission_round_id,
      inserted.project_id,
      coalesce(inserted.logical_node_id, '') as project_parameter_value_id,
      coalesce(
        nullif(trim(both '/' from split_part(lnr.node_locator, '/', 2)), ''),
        nullif(trim(lnr.name), ''),
        '节点启用'
      ) as module,
      coalesce(nullif(trim(lnr.name), ''), 'status') as title,
      inserted.current_value,
      inserted.target_value,
      inserted.action,
      inserted.candidate_config_revision_id,
      inserted.edit_subject_kind,
      inserted.logical_node_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      inserted.status,
      'Low' as risk,
      'legacy-text' as value_kind,
      'DTS' as config_format,
      inserted.created_at,
      inserted.updated_at,
      inserted.assigned_to_user_id,
      inserted.workflow_hardware_committer_user_id,
      inserted.workflow_software_committer_user_id,
      inserted.workflow_software_user_id,
      assignee.name as assigned_to,
      inserted.reviewer_note,
      inserted.reject_reason,
      inserted.fast_track,
      null::text as source_file_name,
      null::text as source_node_path
    from inserted
    left join dts_logical_node_revisions lnr
      on lnr.logical_node_id = inserted.logical_node_id
     and lnr.config_revision_id = inserted.base_config_revision_id
    left join users on users.id = inserted.submitter_user_id
    left join users assignee on assignee.id = inserted.assigned_to_user_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.projectId,
      input.baseVersion,
      input.currentValue,
      input.targetValue,
      input.status,
      input.submitterUserId,
      input.assignedToUserId ?? null,
      input.workflowAssignees?.hardwareCommitterId ?? null,
      input.workflowAssignees?.softwareCommitterId ?? null,
      input.workflowAssignees?.softwareUserId ?? null,
      input.candidateConfigRevisionId ?? null,
      input.writeLock?.baseConfigRevisionId ?? null,
      input.writeLock?.propertyOccurrenceId ?? null,
      input.writeLock?.sourceFileVersionId ?? null,
      input.writeLock?.expectedChecksum ?? null,
      input.writeLock?.occurrenceSpan ? JSON.stringify(input.writeLock.occurrenceSpan) : null,
      input.action ?? "set",
      input.logicalNodeId
    ]
  );
  return toChangeRequestDto(db, result.rows[0]);
}

export async function hasEligibleWorkflowAssignee(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    roleId: BackendRoleId | readonly BackendRoleId[];
  }
) {
  const roleIds = Array.isArray(input.roleId) ? input.roleId : [input.roleId];
  const result = await db.query<{ id: string }>(
    `
    select users.id
    from users
    inner join user_role_bindings urb on urb.user_id = users.id
    where users.organization_id = $1
      and users.id = $2
      and users.is_active = true
      and urb.organization_id = $1
      and urb.project_id = $3
      and urb.role_id = any($4::text[])
    limit 1
    `,
    [input.organizationId, input.userId, input.projectId, roleIds]
  );

  return result.rows.length > 0;
}

export async function listEligibleWorkflowAssignees(
  db: Queryable,
  input: { organizationId: string; projectId: string },
) {
  const result = await db.query<{ id: string; name: string; role_id: string }>(
    `
    select distinct users.id, users.name, urb.role_id
    from users
    inner join user_role_bindings urb on urb.user_id = users.id
    where users.organization_id = $1
      and users.is_active = true
      and urb.organization_id = $1
      and urb.project_id = $2
      and urb.role_id in ('hardware-committer', 'software-committer', 'software-user')
    order by users.name asc, users.id asc, urb.role_id asc
    `,
    [input.organizationId, input.projectId],
  );
  const candidate = (row: { id: string; name: string }) => ({ id: row.id, name: row.name });

  return {
    hardwareCommitters: result.rows
      .filter((row) => row.role_id === "hardware-committer")
      .map(candidate),
    softwareCommitters: result.rows
      .filter((row) => row.role_id === "software-committer")
      .map(candidate),
    softwareUsers: result.rows
      .filter((row) => row.role_id === "software-user" || row.role_id === "software-committer")
      .map(candidate),
  };
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
    action?: ParameterChangeAction;
    reason: string;
    projectParameterBindingId?: string;
    candidateConfigRevisionId?: string;
  }
) {
  if (parameterIdentityMode() === "semantic") {
    const bindingId = input.projectParameterBindingId ?? input.parameterId;
    const result = await db.query<SubmissionItemRow>(
      `
      with inserted as (
        insert into parameter_submission_items (
          id, organization_id, submission_round_id, change_request_id,
          current_value, target_value, reason, project_parameter_binding_id,
          candidate_config_revision_id, action
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      )
      select
        inserted.change_request_id,
        coalesce(inserted.project_parameter_binding_id, '') as project_parameter_value_id,
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key, '') as name,
        split_part(ps.specification_key, '/', 1) as module,
        inserted.current_value,
        inserted.target_value,
        inserted.action,
        inserted.candidate_config_revision_id,
        coalesce(psv.value_shape->>'unit', '') as unit,
        'Low' as risk,
        coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
        'DTS' as config_format,
        inserted.reason
      from inserted
      left join project_parameter_bindings b on b.id = inserted.project_parameter_binding_id
      left join parameter_specs ps on ps.id = b.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      ${PINNED_OR_RANKED_SPEC_VERSION_FROM_INSERTED_BINDING_LATERAL}
      `,
      [
        input.id,
        input.organizationId,
        input.submissionRoundId,
        input.changeRequestId,
        input.currentValue,
        input.targetValue,
        input.reason,
        bindingId,
        input.candidateConfigRevisionId ?? null,
        input.action ?? "set"
      ]
    );
    return toSubmissionItemDto(result.rows[0]);
  }

  const result = await db.query<SubmissionItemRow>(
    `
    with inserted as (
      insert into parameter_submission_items (
        id, organization_id, submission_round_id, change_request_id, project_parameter_value_id,
        current_value, target_value, reason, project_parameter_binding_id, action
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
    )
    select
      inserted.change_request_id,
      inserted.project_parameter_value_id,
      pd.name,
      pd.module,
      inserted.current_value,
      inserted.target_value,
      inserted.action,
      pd.unit,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      inserted.reason
    from inserted
    inner join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = inserted.project_parameter_value_id
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.changeRequestId,
      input.parameterId,
      input.currentValue,
      input.targetValue,
      input.reason,
      input.projectParameterBindingId ?? null,
      input.action ?? "set"
    ]
  );

  return toSubmissionItemDto(result.rows[0]);
}

export async function createEnablementSubmissionItem(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    submissionRoundId: string;
    changeRequestId: string;
    logicalNodeId: string;
    currentValue: string;
    targetValue: string;
    action?: ParameterChangeAction;
    reason: string;
    candidateConfigRevisionId?: string;
  }
) {
  const result = await db.query<SubmissionItemRow>(
    `
    with inserted as (
      insert into parameter_submission_items (
        id, organization_id, submission_round_id, change_request_id,
        current_value, target_value, reason, project_parameter_binding_id,
        candidate_config_revision_id, action, edit_subject_kind, logical_node_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, null, $8, $9, 'node-enablement', $10)
      returning *
    )
    select
      inserted.change_request_id,
      coalesce(inserted.logical_node_id, '') as project_parameter_value_id,
      'status' as name,
      '节点启用' as module,
      inserted.current_value,
      inserted.target_value,
      inserted.action,
      inserted.candidate_config_revision_id,
      '' as unit,
      'Low' as risk,
      'legacy-text' as value_kind,
      'DTS' as config_format,
      inserted.reason
    from inserted
    `,
    [
      input.id,
      input.organizationId,
      input.submissionRoundId,
      input.changeRequestId,
      input.currentValue,
      input.targetValue,
      input.reason,
      input.candidateConfigRevisionId ?? null,
      input.action ?? "set",
      input.logicalNodeId
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
    select psr.id, psr.project_id, projects.name as project_name,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    left join users on users.id = psr.submitter_user_id
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
  const assigneesByRound = await listWorkflowAssigneesByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: rounds.map((round) => round.id)
  });

  return rounds.map((round) => ({
    ...round,
    workflowAssignees: assigneesByRound.get(round.id),
    items: itemsByRound.get(round.id) ?? []
  }));
}

export async function getSubmissionRoundById(
  db: Queryable,
  query: { organizationId: string; roundId: string }
) {
  const result = await db.query<SubmissionRoundRow>(
    `
    select psr.id, psr.project_id, projects.name as project_name,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    left join users on users.id = psr.submitter_user_id
    where psr.organization_id = $1
      and psr.id = $2
    `,
    [query.organizationId, query.roundId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const round = toSubmissionRoundDto(row);
  const itemsByRound = await listSubmissionItemsByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: [round.id]
  });
  const assigneesByRound = await listWorkflowAssigneesByRoundIds(db, {
    organizationId: query.organizationId,
    roundIds: [round.id]
  });

  return {
    ...round,
    workflowAssignees: assigneesByRound.get(round.id),
    items: itemsByRound.get(round.id) ?? []
  };
}

export async function getSubmissionRoundSubmitterUserId(
  db: Queryable,
  query: { organizationId: string; roundId: string }
) {
  const result = await db.query<{ submitter_user_id: string; status: ParameterSubmissionRoundStatus }>(
    `
    select submitter_user_id, status
    from parameter_submission_rounds
    where organization_id = $1
      and id = $2
    `,
    [query.organizationId, query.roundId]
  );

  return result.rows[0] ?? null;
}

export async function withdrawOpenChangeRequestsForRound(
  db: Queryable,
  input: { organizationId: string; roundId: string; note: string }
) {
  await db.query(
    `
    update parameter_change_requests
    set status = 'rejected',
      reject_reason = $3,
      assigned_to_user_id = null,
      updated_at = now()
    where organization_id = $1
      and submission_round_id = $2
      and status not in ('merged', 'rejected', 'withdrawn')
    `,
    [input.organizationId, input.roundId, input.note]
  );
}

export async function updateSubmissionRoundStatus(
  db: Queryable,
  input: {
    organizationId: string;
    roundId: string;
    status: ParameterSubmissionRoundStatus;
    summary?: string;
  }
) {
  await db.query(
    `
    update parameter_submission_rounds
    set status = $3,
      summary = coalesce($4, summary),
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.roundId, input.status, input.summary ?? null]
  );
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

  const semantic = parameterIdentityMode() === "semantic";
  const result = await db.query<ChangeRequestRow>(
    semantic
      ? `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      coalesce(pcr.project_parameter_binding_id, '') as project_parameter_value_id,
      pcr.base_version,
      ${CR_MODULE_NAME_SEMANTIC_SQL},
      ${CR_MODULE_DESCRIPTION_FROM_BINDING_SQL},
      ${CR_PARAMETER_DESCRIPTION_SEMANTIC_SQL},
      coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      pcr.submitter_user_id,
      pcr.status,
      'Low' as risk,
      coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
      'DTS' as config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ${semanticSourceFileNameSql("pcr")} as source_file_name,
      ${SEMANTIC_SOURCE_NODE_PATH_SQL} as source_node_path
    from parameter_change_requests pcr
    left join parameter_specs ps on ps.id = pcr.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    ${PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL}
    left join project_parameter_bindings b on b.id = pcr.project_parameter_binding_id
    left join parameter_modules binding_pm on binding_pm.id = b.module_id
    ${SEMANTIC_LNR_FROM_BINDING_SQL}
    left join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    where ${where.join("\n      and ")}
    order by pcr.updated_at desc
    `
      : `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.base_version,
      ${CR_MODULE_NAME_LEGACY_SQL},
      ${CR_MODULE_DESCRIPTION_LEGACY_SQL},
      ${CR_PARAMETER_DESCRIPTION_LEGACY_SQL},
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = pcr.parameter_definition_id
    left join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
    ${CR_MODULE_JOINS_LEGACY_SQL}
    where ${where.join("\n      and ")}
    order by pcr.updated_at desc
    `,
    values
  );

  const items: ChangeRequestDto[] = [];
  for (const row of result.rows) {
    items.push(await toChangeRequestDto(db, row));
  }
  return items;
}

export async function findOpenChangeRequest(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<ChangeRequestRow>(
      `
      select
        pcr.id,
        pcr.submission_round_id,
        pcr.project_id,
        coalesce(pcr.project_parameter_binding_id, '') as project_parameter_value_id,
        pcr.base_version,
        ${CR_MODULE_NAME_SEMANTIC_SQL},
        ${CR_MODULE_DESCRIPTION_FROM_BINDING_SQL},
        ${CR_PARAMETER_DESCRIPTION_SEMANTIC_SQL},
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as title,
        pcr.current_value,
        pcr.target_value,
        pcr.action,
        pcr.candidate_config_revision_id,
        ${RETAINED_SUBMITTER_SQL} as submitter,
        pcr.submitter_user_id,
        pcr.status,
        'Low' as risk,
        coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
        'DTS' as config_format,
        pcr.created_at,
        pcr.updated_at,
        pcr.assigned_to_user_id,
        pcr.workflow_hardware_committer_user_id,
        pcr.workflow_software_committer_user_id,
        pcr.workflow_software_user_id,
        assignee.name as assigned_to,
        pcr.reviewer_note,
        pcr.reject_reason,
        pcr.fast_track,
        ${semanticSourceFileNameSql("pcr")} as source_file_name,
        ${SEMANTIC_SOURCE_NODE_PATH_SQL} as source_node_path
      from parameter_change_requests pcr
      left join parameter_specs ps on ps.id = pcr.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      ${PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL}
      ${CR_MODULE_JOINS_SEMANTIC_SQL}
      ${SEMANTIC_LNR_FROM_BINDING_SQL}
      left join users on users.id = pcr.submitter_user_id
      left join users assignee on assignee.id = pcr.assigned_to_user_id
      where pcr.organization_id = $1
        and pcr.project_id = $2
        and pcr.project_parameter_binding_id = $3
        and pcr.status not in ('merged', 'rejected', 'withdrawn')
      limit 1
      `,
      [query.organizationId, query.projectId, query.parameterId]
    );
    return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
  }

  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.base_version,
      ${CR_MODULE_NAME_LEGACY_SQL},
      ${CR_MODULE_DESCRIPTION_LEGACY_SQL},
      ${CR_PARAMETER_DESCRIPTION_LEGACY_SQL},
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = pcr.parameter_definition_id
    left join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
    ${CR_MODULE_JOINS_LEGACY_SQL}
    where pcr.organization_id = $1
      and pcr.project_id = $2
      and pcr.project_parameter_value_id = $3
      and pcr.status not in ('merged', 'rejected', 'withdrawn')
    limit 1
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

export async function getChangeRequestById(
  db: Queryable,
  query: { organizationId: string; requestId: string }
) {
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<ChangeRequestRow>(
      `
      select
        pcr.id,
        pcr.submission_round_id,
        pcr.project_id,
        coalesce(pcr.project_parameter_binding_id, pcr.logical_node_id, '') as project_parameter_value_id,
        null::text as parameter_definition_id,
        pcr.edit_subject_kind,
        pcr.logical_node_id,
        pcr.base_version,
        case
          when pcr.edit_subject_kind = 'node-enablement' then coalesce(
            nullif(trim(both '/' from split_part(lnr.node_locator, '/', 2)), ''),
            nullif(trim(lnr.name), ''),
            '节点启用'
          )
          else ${CR_MODULE_NAME_SEMANTIC_EXPR}
        end as module,
        ${CR_MODULE_DESCRIPTION_FROM_BINDING_SQL},
        case
          when pcr.edit_subject_kind = 'node-enablement' then null::text
          else ${CR_PARAMETER_DESCRIPTION_SEMANTIC_EXPR}
        end as parameter_description,
        case
          when pcr.edit_subject_kind = 'node-enablement' then coalesce(nullif(trim(lnr.name), ''), 'status')
          else coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key)
        end as title,
        pcr.current_value,
        pcr.target_value,
        pcr.action,
        pcr.candidate_config_revision_id,
        ${RETAINED_SUBMITTER_SQL} as submitter,
        pcr.submitter_user_id,
        pcr.status,
        'Low' as risk,
        coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
        'DTS' as config_format,
        pcr.created_at,
        pcr.updated_at,
        pcr.assigned_to_user_id,
        pcr.workflow_hardware_committer_user_id,
        pcr.workflow_software_committer_user_id,
        pcr.workflow_software_user_id,
        assignee.name as assigned_to,
        pcr.reviewer_note,
        pcr.reject_reason,
        pcr.fast_track,
        ${semanticSourceFileNameSql("pcr")} as source_file_name,
        ${SEMANTIC_SOURCE_NODE_PATH_SQL} as source_node_path
      from parameter_change_requests pcr
      left join parameter_specs ps on ps.id = pcr.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      ${CR_MODULE_JOINS_SEMANTIC_SQL}
      ${SEMANTIC_LNR_FROM_BINDING_SQL}
      ${PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL}
      left join users on users.id = pcr.submitter_user_id
      left join users assignee on assignee.id = pcr.assigned_to_user_id
      where pcr.organization_id = $1
        and pcr.id = $2
      for update of pcr
      `,
      [query.organizationId, query.requestId]
    );
    return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
  }

  const result = await db.query<ChangeRequestRow>(
    `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      pcr.project_parameter_value_id,
      pcr.parameter_definition_id,
      pcr.base_version,
      ${CR_MODULE_NAME_LEGACY_SQL},
      ${CR_MODULE_DESCRIPTION_LEGACY_SQL},
      ${CR_PARAMETER_DESCRIPTION_LEGACY_SQL},
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      ${RETAINED_SUBMITTER_SQL} as submitter,
      pcr.submitter_user_id,
      pcr.status,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      pcr.created_at,
      pcr.updated_at,
      pcr.assigned_to_user_id,
      pcr.workflow_hardware_committer_user_id,
      pcr.workflow_software_committer_user_id,
      pcr.workflow_software_user_id,
      assignee.name as assigned_to,
      pcr.reviewer_note,
      pcr.reject_reason,
      pcr.fast_track,
      ppv.source_file_name,
      ppv.source_node_path
    from parameter_change_requests pcr
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = pcr.parameter_definition_id
    left join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
    ${CR_MODULE_JOINS_LEGACY_SQL}
    where pcr.organization_id = $1
      and pcr.id = $2
    for update of pcr
    `,
    [query.organizationId, query.requestId]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

export async function listReviewDecisions(
  db: Queryable,
  query: { organizationId: string; requestId: string }
) {
  const result = await db.query<ReviewDecisionRow>(
    `
    select id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    from parameter_review_decisions
    where organization_id = $1
      and request_id = $2
    order by created_at asc, id asc
    `,
    [query.organizationId, query.requestId]
  );

  return result.rows.map(toReviewDecisionDto);
}

export async function listReviewDecisionsForRequestIds(
  db: Queryable,
  query: { organizationId: string; requestIds: string[] }
) {
  if (query.requestIds.length === 0) {
    return [] as ReviewDecisionDto[];
  }

  const result = await db.query<ReviewDecisionRow>(
    `
    select id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    from parameter_review_decisions
    where organization_id = $1
      and request_id = any($2::text[])
    order by created_at asc, id asc
    `,
    [query.organizationId, query.requestIds]
  );

  return result.rows.map(toReviewDecisionDto);
}

export async function listChangeRequestWorkflowStateByIds(
  db: Queryable,
  query: { organizationId: string; requestIds: string[] }
) {
  if (query.requestIds.length === 0) {
    return [] as Array<{ id: string; status: ParameterChangeRequestStatus; assignedTo?: string }>;
  }

  const result = await db.query<{
    id: string;
    status: ParameterChangeRequestStatus;
    assigned_to_user_id: string | null;
  }>(
    `
    select id, status, assigned_to_user_id
    from parameter_change_requests
    where organization_id = $1
      and id = any($2::text[])
    `,
    [query.organizationId, query.requestIds]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    assignedTo: row.assigned_to_user_id ?? undefined
  }));
}

export async function listUserNamesByIds(
  db: Queryable,
  query: { organizationId: string; userIds: string[] }
) {
  if (query.userIds.length === 0) {
    return new Map<string, string>();
  }

  const result = await db.query<{ id: string; name: string }>(
    `
    select id, name
    from users
    where organization_id = $1
      and id = any($2::text[])
    `,
    [query.organizationId, query.userIds]
  );

  return new Map(result.rows.map((row) => [row.id, row.name]));
}

export async function insertReviewDecision(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    requestId: string;
    reviewerUserId: string;
    decision: ParameterReviewDecision;
    fromStatus: ParameterChangeRequestStatus;
    toStatus: ParameterChangeRequestStatus;
    note?: string;
  }
) {
  const result = await db.query<ReviewDecisionRow>(
    `
    insert into parameter_review_decisions (
      id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, note
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning id, request_id, reviewer_user_id, decision, from_status, to_status, note, created_at
    `,
    [
      input.id,
      input.organizationId,
      input.requestId,
      input.reviewerUserId,
      input.decision,
      input.fromStatus,
      input.toStatus,
      input.note ?? null
    ]
  );

  return toReviewDecisionDto(result.rows[0]);
}

export async function updateChangeRequestStatus(
  db: Queryable,
  input: {
    organizationId: string;
    requestId: string;
    status: ParameterChangeRequestStatus;
    note?: string;
  }
) {
  const rejectReason = input.status === "rejected" ? input.note ?? null : null;
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<ChangeRequestRow>(
      `
      update parameter_change_requests
      set status = $3,
        reviewer_note = $4,
        reject_reason = coalesce($5, reject_reason),
        assigned_to_user_id = case
          when $3 in ('submitted', 'hardware_review') then coalesce(workflow_hardware_committer_user_id, assigned_to_user_id)
          when $3 = 'software_review' then coalesce(workflow_software_committer_user_id, assigned_to_user_id)
          when $3 = 'software_merge' then coalesce(workflow_software_user_id, assigned_to_user_id)
          when $3 in ('merged', 'rejected') then null
          else assigned_to_user_id
        end,
        updated_at = now()
      where organization_id = $1
        and id = $2
      returning
        id,
        submission_round_id,
        project_id,
        coalesce(project_parameter_binding_id, '') as project_parameter_value_id,
        null::text as parameter_definition_id,
        base_version,
        coalesce(
          (select split_part(specification_key, '/', 1) from parameter_specs where id = parameter_change_requests.parameter_spec_id),
          ''
        ) as module,
        coalesce(
          (select split_part(specification_key, '/', 2) from parameter_specs where id = parameter_change_requests.parameter_spec_id),
          ''
        ) as title,
        current_value,
        target_value,
        action,
        candidate_config_revision_id,
        (select name from users where id = parameter_change_requests.submitter_user_id) as submitter,
        status,
        'Low' as risk,
        'legacy-text' as value_kind,
        'DTS' as config_format,
        created_at,
        updated_at,
        assigned_to_user_id,
        workflow_hardware_committer_user_id,
        workflow_software_committer_user_id,
        workflow_software_user_id,
        (select name from users where id = parameter_change_requests.assigned_to_user_id) as assigned_to,
        reviewer_note,
        reject_reason,
        fast_track,
        null::text as source_file_name,
        null::text as source_node_path
      `,
      [input.organizationId, input.requestId, input.status, input.note ?? null, rejectReason]
    );
    return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
  }

  const result = await db.query<ChangeRequestRow>(
    `
    update parameter_change_requests
    set status = $3,
      reviewer_note = $4,
      reject_reason = coalesce($5, reject_reason),
      assigned_to_user_id = case
        when $3 in ('submitted', 'hardware_review') then coalesce(workflow_hardware_committer_user_id, assigned_to_user_id)
        when $3 = 'software_review' then coalesce(workflow_software_committer_user_id, assigned_to_user_id)
        when $3 = 'software_merge' then coalesce(workflow_software_user_id, assigned_to_user_id)
        when $3 in ('merged', 'rejected') then null
        else assigned_to_user_id
      end,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning
      id,
      submission_round_id,
      project_id,
      project_parameter_value_id,
      parameter_definition_id,
      base_version,
      (select module from ${LEGACY_IDENTITY_SQL.definitionsTable} where id = parameter_change_requests.parameter_definition_id) as module,
      (select name from ${LEGACY_IDENTITY_SQL.definitionsTable} where id = parameter_change_requests.parameter_definition_id) as title,
      current_value,
      target_value,
      action,
      (select name from users where id = parameter_change_requests.submitter_user_id) as submitter,
      status,
      (select risk from ${LEGACY_IDENTITY_SQL.definitionsTable} where id = parameter_change_requests.parameter_definition_id) as risk,
      (select value_kind from ${LEGACY_IDENTITY_SQL.definitionsTable} where id = parameter_change_requests.parameter_definition_id) as value_kind,
      (select config_format from ${LEGACY_IDENTITY_SQL.definitionsTable} where id = parameter_change_requests.parameter_definition_id) as config_format,
      created_at,
      updated_at,
      assigned_to_user_id,
      workflow_hardware_committer_user_id,
      workflow_software_committer_user_id,
      workflow_software_user_id,
      (select name from users where id = parameter_change_requests.assigned_to_user_id) as assigned_to,
      reviewer_note,
      reject_reason,
      fast_track,
      (select source_file_name from ${LEGACY_IDENTITY_SQL.valuesTable} where id = parameter_change_requests.project_parameter_value_id) as source_file_name,
      (select source_node_path from ${LEGACY_IDENTITY_SQL.valuesTable} where id = parameter_change_requests.project_parameter_value_id) as source_node_path
    `,
    [input.organizationId, input.requestId, input.status, input.note ?? null, rejectReason]
  );

  return result.rows[0] ? toChangeRequestDto(db, result.rows[0]) : null;
}

async function mergeEnablementChangeRequest(
  db: Queryable,
  input: {
    historyId: string;
    organizationId: string;
    requestId: string;
    expectedVersion?: number;
    actorUserId: string;
  }
) {
  const result = await db.query<ChangeRequestMergeRow>(
    `
    with request_to_merge as (
      select
        id,
        organization_id,
        project_id,
        logical_node_id,
        candidate_config_revision_id,
        base_config_revision_id,
        property_occurrence_id,
        source_file_version_id,
        expected_checksum,
        occurrence_span,
        base_version,
        target_value,
        action
      from parameter_change_requests
      where organization_id = $1
        and id = $2
        and status = 'software_merge'
        and edit_subject_kind = 'node-enablement'
        and logical_node_id is not null
        and project_parameter_binding_id is null
      for update
    ),
    candidate_lock as materialized (
      select
        request_to_merge.*,
        base_lnr.node_locator as base_node_locator
      from request_to_merge
      inner join dts_config_revisions base_candidate
        on base_candidate.id = request_to_merge.base_config_revision_id
       and base_candidate.organization_id = request_to_merge.organization_id
       and base_candidate.project_id = request_to_merge.project_id
      inner join dts_config_revisions candidate
        on candidate.id = request_to_merge.candidate_config_revision_id
       and candidate.organization_id = request_to_merge.organization_id
       and candidate.project_id = request_to_merge.project_id
       and candidate.config_set_id = base_candidate.config_set_id
       and candidate.status = 'pending_approval'
      inner join dts_logical_node_revisions base_lnr
        on base_lnr.logical_node_id = request_to_merge.logical_node_id
       and base_lnr.config_revision_id = request_to_merge.base_config_revision_id
      for update of candidate
    ),
    locked_status_effects as materialized (
      select candidate_effect.id, candidate_effect.effect_kind, candidate_occurrence.raw_text
      from dts_logical_node_revisions candidate_lnr
      inner join dts_occurrence_effects candidate_effect
        on candidate_effect.logical_node_revision_id = candidate_lnr.id
       and candidate_effect.config_revision_id = candidate_lnr.config_revision_id
       and candidate_effect.property_name = 'status'
      inner join candidate_lock
        on candidate_lnr.node_locator = candidate_lock.base_node_locator
       and candidate_lnr.config_revision_id = candidate_lock.candidate_config_revision_id
      left join dts_property_occurrences candidate_occurrence
        on candidate_occurrence.id = candidate_effect.property_occurrence_id
      for update of candidate_lnr, candidate_effect
    ),
    locked_set_proof as materialized (
      select locked_status_effects.id
      from candidate_lock
      inner join locked_status_effects
        on locked_status_effects.effect_kind in ('set', 'override')
       and locked_status_effects.raw_text = candidate_lock.target_value
      where candidate_lock.action = 'set'
      for update of locked_status_effects
    ),
    locked_delete_proof as materialized (
      select locked_status_effects.id
      from candidate_lock
      inner join locked_status_effects
        on locked_status_effects.effect_kind = 'delete'
      where candidate_lock.action = 'delete'
        and not exists (
          select 1
          from locked_status_effects active
          where active.effect_kind in ('set', 'override')
        )
      for update of locked_status_effects
    ),
    locked_request as (
      select candidate_lock.*
      from candidate_lock
      where candidate_lock.base_config_revision_id is not null
        and candidate_lock.source_file_version_id is not null
        and candidate_lock.expected_checksum is not null
        and (
          (candidate_lock.action = 'set' and exists (select 1 from locked_set_proof))
          or (candidate_lock.action = 'delete' and exists (select 1 from locked_delete_proof))
        )
    ),
    file_lock as (
      select locked_request.*
      from locked_request
      inner join project_parameter_file_versions pfv
        on pfv.id = locked_request.source_file_version_id
       and pfv.checksum = locked_request.expected_checksum
    ),
    occurrence_lock as (
      select file_lock.*
      from file_lock
      where file_lock.property_occurrence_id is null
         or exists (
           select 1
           from dts_property_occurrences po
           where po.id = file_lock.property_occurrence_id
             and po.file_version_id = file_lock.source_file_version_id
             and (
               file_lock.occurrence_span is null
               or (
                 po.start_offset = (file_lock.occurrence_span->>'start')::int
                 and po.end_offset = (file_lock.occurrence_span->>'end')::int
               )
             )
         )
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id,
        version, value, changed_by_user_id, request_id,
        logical_node_id
      )
      select
        $3,
        $1,
        occurrence_lock.project_id,
        coalesce($4, occurrence_lock.base_version) + 1,
        occurrence_lock.target_value,
        $5,
        occurrence_lock.id,
        occurrence_lock.logical_node_id
      from occurrence_lock
      returning id
    )
    select
      occurrence_lock.id,
      occurrence_lock.logical_node_id as project_parameter_value_id,
      null::text as parameter_definition_id,
      null::text as parameter_spec_id,
      null::text as project_parameter_binding_id,
      occurrence_lock.candidate_config_revision_id,
      occurrence_lock.project_id,
      occurrence_lock.target_value,
      occurrence_lock.action,
      occurrence_lock.base_version,
      coalesce($4, occurrence_lock.base_version) + 1 as new_version,
      occurrence_lock.logical_node_id
    from occurrence_lock
    inner join inserted_history on true
    `,
    [
      input.organizationId,
      input.requestId,
      input.historyId,
      input.expectedVersion ?? null,
      input.actorUserId
    ]
  );
  const merged = result.rows[0];
  if (!merged) return null;
  return toChangeRequestMergeResult(merged);
}

export async function mergeChangeRequest(
  db: Queryable,
  input: {
    historyId: string;
    organizationId: string;
    requestId: string;
    expectedVersion?: number;
    actorUserId: string;
  }
) {
  if (parameterIdentityMode() === "semantic") {
    const subject = await db.query<{ edit_subject_kind: string }>(
      `
      select edit_subject_kind
      from parameter_change_requests
      where organization_id = $1 and id = $2
      limit 1
      `,
      [input.organizationId, input.requestId]
    );
    if (subject.rows[0]?.edit_subject_kind === "node-enablement") {
      return mergeEnablementChangeRequest(db, input);
    }

    const result = await db.query<ChangeRequestMergeRow>(
      `
      with request_to_merge as (
        select
          id,
          organization_id,
          project_id,
          project_parameter_binding_id,
          parameter_spec_id,
          candidate_config_revision_id,
          base_config_revision_id,
          binding_revision_id,
          property_occurrence_id,
          source_file_version_id,
          expected_checksum,
          occurrence_span,
          base_version,
          target_value,
          action
        from parameter_change_requests
        where organization_id = $1
          and id = $2
          and status = 'software_merge'
          and edit_subject_kind = 'binding'
          and project_parameter_binding_id is not null
        for update
      ),
      candidate_lock as materialized (
        select request_to_merge.*
        from request_to_merge
        inner join dts_config_revisions base_candidate
          on base_candidate.id = request_to_merge.base_config_revision_id
         and base_candidate.organization_id = request_to_merge.organization_id
         and base_candidate.project_id = request_to_merge.project_id
        inner join dts_config_revisions candidate
          on candidate.id = request_to_merge.candidate_config_revision_id
         and candidate.organization_id = request_to_merge.organization_id
         and candidate.project_id = request_to_merge.project_id
         and candidate.config_set_id = base_candidate.config_set_id
         and candidate.status = 'pending_approval'
        for update of candidate
      ),
      locked_set_proof as materialized (
        select candidate_bpr.id
        from candidate_lock
        inner join project_parameter_binding_revisions candidate_bpr
          on candidate_bpr.binding_id = candidate_lock.project_parameter_binding_id
         and candidate_bpr.config_revision_id = candidate_lock.candidate_config_revision_id
         and candidate_bpr.raw_value = candidate_lock.target_value
        where candidate_lock.action = 'set'
        for update of candidate_bpr
      ),
      locked_delete_proof as materialized (
        select candidate_effect.id
        from candidate_lock
        inner join project_parameter_bindings binding
          on binding.id = candidate_lock.project_parameter_binding_id
         and binding.organization_id = candidate_lock.organization_id
         and binding.project_id = candidate_lock.project_id
         and binding.parameter_spec_id = candidate_lock.parameter_spec_id
        inner join dts_logical_node_revisions candidate_lnr
          on candidate_lnr.logical_node_id = binding.logical_node_id
         and candidate_lnr.config_revision_id = candidate_lock.candidate_config_revision_id
        inner join dts_occurrence_effects candidate_effect
          on candidate_effect.logical_node_revision_id = candidate_lnr.id
         and candidate_effect.config_revision_id = candidate_lock.candidate_config_revision_id
         and candidate_effect.effect_kind = 'delete'
        inner join dts_property_specs candidate_property
          on candidate_property.parameter_spec_id = binding.parameter_spec_id
         and candidate_property.property_key = candidate_effect.property_name
        where candidate_lock.action = 'delete'
        for update of candidate_lnr, candidate_effect
      ),
      locked_request as (
        select candidate_lock.*
        from candidate_lock
        where candidate_lock.base_config_revision_id is not null
          and candidate_lock.binding_revision_id is not null
          and candidate_lock.source_file_version_id is not null
          and candidate_lock.expected_checksum is not null
          and (
            (candidate_lock.action = 'set' and exists (select 1 from locked_set_proof))
            or (
              candidate_lock.action = 'delete'
              and not exists (
                select 1
                from project_parameter_binding_revisions candidate_bpr
                where candidate_bpr.binding_id = candidate_lock.project_parameter_binding_id
                  and candidate_bpr.config_revision_id = candidate_lock.candidate_config_revision_id
              )
              and exists (select 1 from locked_delete_proof)
            )
          )
      ),
      binding_lock as (
        select
          locked_request.*,
          bpr.raw_value as prior_value
        from locked_request
        inner join project_parameter_binding_revisions bpr
          on bpr.id = locked_request.binding_revision_id
         and bpr.binding_id = locked_request.project_parameter_binding_id
         and bpr.config_revision_id = locked_request.base_config_revision_id
      ),
      file_lock as (
        select binding_lock.*
        from binding_lock
        inner join project_parameter_file_versions pfv
          on pfv.id = binding_lock.source_file_version_id
         and pfv.checksum = binding_lock.expected_checksum
      ),
      occurrence_lock as (
        select file_lock.*
        from file_lock
        where file_lock.property_occurrence_id is null
           or exists (
             select 1
             from dts_property_occurrences po
             where po.id = file_lock.property_occurrence_id
               and po.file_version_id = file_lock.source_file_version_id
               and (
                 file_lock.occurrence_span is null
                 or (
                   po.start_offset = (file_lock.occurrence_span->>'start')::int
                   and po.end_offset = (file_lock.occurrence_span->>'end')::int
                 )
               )
           )
      ),
      inserted_history as (
        insert into parameter_history_entries (
          id, organization_id, project_id,
          version, value, changed_by_user_id, request_id,
          parameter_spec_id, project_parameter_binding_id
        )
        select
          $3,
          $1,
          occurrence_lock.project_id,
          coalesce($4, occurrence_lock.base_version) + 1,
          occurrence_lock.target_value,
          $5,
          occurrence_lock.id,
          occurrence_lock.parameter_spec_id,
          occurrence_lock.project_parameter_binding_id
        from occurrence_lock
        returning id
      )
      select
        occurrence_lock.id,
        occurrence_lock.project_parameter_binding_id as project_parameter_value_id,
        null::text as parameter_definition_id,
        occurrence_lock.parameter_spec_id,
        occurrence_lock.project_parameter_binding_id,
        occurrence_lock.candidate_config_revision_id,
        occurrence_lock.project_id,
        occurrence_lock.target_value,
        occurrence_lock.action,
        occurrence_lock.base_version,
        coalesce($4, occurrence_lock.base_version) + 1 as new_version
      from occurrence_lock
      inner join inserted_history on true
      `,
      [
        input.organizationId,
        input.requestId,
        input.historyId,
        input.expectedVersion ?? null,
        input.actorUserId
      ]
    );
    const merged = result.rows[0];
    if (!merged) return null;
    return toChangeRequestMergeResult(merged);
  }

  const result = await db.query<ChangeRequestMergeRow>(
    `
    with request_to_merge as (
      select
        id,
        organization_id,
        project_id,
        project_parameter_value_id,
        parameter_definition_id,
        parameter_spec_id,
        project_parameter_binding_id,
        base_version,
        target_value,
        action
      from parameter_change_requests
      where organization_id = $1
        and id = $2
        and status = 'software_merge'
      for update
    ),
    updated_value as (
      update ${LEGACY_IDENTITY_SQL.valuesTable} ppv
      set current_value = request_to_merge.target_value,
        value_version = ppv.value_version + 1,
        updated_by_user_id = $4,
        updated_at = now()
      from request_to_merge
      where ppv.organization_id = $1
        and ppv.id = request_to_merge.project_parameter_value_id
        and ppv.value_version = coalesce($3, request_to_merge.base_version)
      returning
        request_to_merge.id,
        request_to_merge.project_parameter_value_id,
        request_to_merge.parameter_definition_id,
        request_to_merge.parameter_spec_id,
        request_to_merge.project_parameter_binding_id,
        request_to_merge.project_id,
        request_to_merge.target_value,
        request_to_merge.action,
        request_to_merge.base_version,
        ppv.value_version as new_version
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id,
        parameter_spec_id, project_parameter_binding_id
      )
      select
        $5,
        $1,
        project_id,
        parameter_definition_id,
        project_parameter_value_id,
        new_version,
        target_value,
        $4,
        id,
        parameter_spec_id,
        project_parameter_binding_id
      from updated_value
      returning id
    )
    select updated_value.*
    from updated_value
    inner join inserted_history on true
    `,
    [input.organizationId, input.requestId, input.expectedVersion ?? null, input.actorUserId, input.historyId]
  );

  const merged = result.rows[0];
  if (!merged) return null;

  return toChangeRequestMergeResult(merged);
}

export async function updateSubmissionRoundStatusFromRequests(
  db: Queryable,
  input: { organizationId: string; submissionRoundId: string }
) {
  const result = await db.query<{ status: ParameterChangeRequestStatus }>(
    `
    select status
    from parameter_change_requests
    where organization_id = $1
      and submission_round_id = $2
    `,
    [input.organizationId, input.submissionRoundId]
  );
  const status = getMostAdvancedActiveParameterStatus(result.rows.map((row) => row.status));

  await db.query(
    `
    update parameter_submission_rounds
    set status = $3,
      updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.submissionRoundId, status]
  );

  return status;
}

async function listSubmissionItemsByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const semantic = parameterIdentityMode() === "semantic";
  const result = await db.query<SubmissionItemRow & { submission_round_id: string }>(
    semantic
      ? `
    select
      psi.submission_round_id,
      psi.change_request_id,
      coalesce(psi.project_parameter_binding_id, pcr.project_parameter_binding_id) as project_parameter_value_id,
      coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as name,
      split_part(ps.specification_key, '/', 1) as module,
      psi.current_value,
      psi.target_value,
      psi.action,
      psi.candidate_config_revision_id,
      coalesce(psv.value_shape->>'unit', '') as unit,
      'Low' as risk,
      coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
      'DTS' as config_format,
      psi.reason
    from parameter_submission_items psi
    inner join parameter_change_requests pcr on pcr.id = psi.change_request_id
    inner join project_parameter_bindings b
      on b.id = coalesce(psi.project_parameter_binding_id, pcr.project_parameter_binding_id)
    inner join parameter_specs ps on ps.id = coalesce(pcr.parameter_spec_id, b.parameter_spec_id)
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    ${PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL}
    where psi.organization_id = $1
      and psi.submission_round_id = any($2::text[])
    order by psi.id asc
    `
      : `
    select
      psi.submission_round_id,
      psi.change_request_id,
      psi.project_parameter_value_id,
      pd.name,
      pd.module,
      psi.current_value,
      psi.target_value,
      psi.action,
      psi.candidate_config_revision_id,
      pd.unit,
      pd.risk,
      pd.value_kind,
      pd.config_format,
      psi.reason
    from parameter_submission_items psi
    inner join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = psi.project_parameter_value_id
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
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

async function listWorkflowAssigneesByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const result = await db.query<WorkflowAssigneesRow>(
    `
    select distinct on (submission_round_id)
      submission_round_id,
      workflow_hardware_committer_user_id,
      workflow_software_committer_user_id,
      workflow_software_user_id
    from parameter_change_requests
    where organization_id = $1
      and submission_round_id = any($2::text[])
      and workflow_hardware_committer_user_id is not null
      and workflow_software_committer_user_id is not null
      and workflow_software_user_id is not null
    order by submission_round_id, created_at asc, id asc
    `,
    [query.organizationId, query.roundIds]
  );

  const byRound = new Map<string, ParameterWorkflowAssigneesDto>();
  for (const row of result.rows) {
    const assignees = workflowAssigneesFromRow(row);
    if (assignees) {
      byRound.set(row.submission_round_id, assignees);
    }
  }

  return byRound;
}
