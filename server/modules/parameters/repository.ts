import type { Queryable } from "../../shared/database/client";
import type {
  ChangeRequestDto,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportSummaryDto,
  ParameterHistoryEntryDto,
  ParameterRecordDto,
  ParameterSubmissionItemDto,
  ParameterSubmissionRoundDto,
  ParameterWorkflowAssigneesDto,
  ParameterChangeAction,
  ProjectAdminDetailDto,
  ProjectAdminSummaryDto,
  ProjectDto,
  ProjectModuleDto
} from "./types";
import {
  buildParameterModuleSubtreeFilter
} from "./parameterModuleRepository";

export {
  buildParameterModuleSubtreeFilter,
  countParameterModuleChildren,
  countParametersForModule,
  createParameterModule,
  deleteParameterModule,
  getParameterModuleById,
  getParameterModuleByName,
  listParameterModules,
  moveParameterModule,
  resolveParameterModulePathNames,
  updateParameterModule
} from "./parameterModuleRepository";
import type { BackendRoleId } from "../auth/types";
import {
  getMostAdvancedActiveParameterStatus,
  type ParameterChangeRequestStatus,
  type ParameterReviewDecision,
  type ParameterRiskLevel,
  type ParameterSubmissionRoundStatus
} from "./status";
import { buildChangeRequestImpact } from "./impact";
import { LEGACY_SQL } from "../parameter-topology/migration";
import {
  listSemanticParameters,
  mustUseSemanticParameterIdentity,
  upsertSemanticDraft
} from "./semanticParameterReads";
import { resetParameterIdentityCutoverCache } from "./cutoverAwareIdentity";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";
import { deletePreCutoverProjectParameterValues } from "./legacyParameterIdentityAdapter";
import type { BindingWriteLockFields } from "../parameter-topology/editService";

export type ParameterWriteLockRow = {
  base_config_revision_id: string | null;
  binding_revision_id: string | null;
  property_occurrence_id: string | null;
  source_file_version_id: string | null;
  expected_checksum: string | null;
  occurrence_span: { start: number; end: number } | null;
};

export function toWriteLockFields(row: ParameterWriteLockRow): BindingWriteLockFields | null {
  if (
    !row.base_config_revision_id ||
    !row.binding_revision_id ||
    !row.source_file_version_id ||
    !row.expected_checksum
  ) {
    return null;
  }
  return {
    baseConfigRevisionId: row.base_config_revision_id,
    bindingRevisionId: row.binding_revision_id,
    propertyOccurrenceId: row.property_occurrence_id,
    sourceFileVersionId: row.source_file_version_id,
    expectedChecksum: row.expected_checksum,
    occurrenceSpan: row.occurrence_span,
  };
}

export async function getDraftWriteLock(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    bindingId: string;
    userId: string;
  }
): Promise<BindingWriteLockFields | null> {
  const result = await db.query<ParameterWriteLockRow>(
    `
    select
      base_config_revision_id,
      binding_revision_id,
      property_occurrence_id,
      source_file_version_id,
      expected_checksum,
      occurrence_span
    from parameter_drafts
    where organization_id = $1
      and project_id = $2
      and project_parameter_binding_id = $3
      and user_id = $4
    limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId, input.userId]
  );
  const row = result.rows[0];
  return row ? toWriteLockFields(row) : null;
}

export type BindingDraftForSubmission = {
  id: string;
  projectId: string;
  bindingId: string;
  parameterSpecId: string;
  candidateConfigRevisionId: string | null;
  candidateStatus: string | null;
  candidateHasBindingRevision: boolean;
  candidateValueMatchesDraft: boolean;
  candidateDeleteTombstone: boolean;
  candidateActionProven: boolean;
  targetValue: string;
  action: ParameterChangeAction;
  reason: string;
  writeLock: BindingWriteLockFields | null;
  writeLockMatchesBinding: boolean;
};

export async function getBindingDraftForSubmission(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    draftId: string;
  }
): Promise<BindingDraftForSubmission | null> {
  const result = await db.query<
    ParameterWriteLockRow & {
      id: string;
      project_id: string;
      project_parameter_binding_id: string;
      parameter_spec_id: string;
      candidate_config_revision_id: string | null;
      candidate_status: string | null;
      candidate_has_binding_revision: boolean;
      candidate_value_matches_draft: boolean;
      candidate_delete_tombstone: boolean;
      candidate_action_proven: boolean;
      write_lock_matches_binding: boolean;
      target_value: string;
      action: ParameterChangeAction;
      reason: string;
    }
  >(
    `
    with locked_draft as materialized (
      select d.*, b.parameter_spec_id, b.logical_node_id
      from parameter_drafts d
      inner join project_parameter_bindings b
        on b.id = d.project_parameter_binding_id
       and b.organization_id = d.organization_id
       and b.project_id = d.project_id
      where d.organization_id = $1
        and d.project_id = $2
        and d.user_id = $3
        and d.id = $4
      limit 1
      for update of d
    ),
    locked_candidate as materialized (
      select candidate.id, candidate.status, candidate.config_set_id
      from dts_config_revisions candidate
      inner join locked_draft d
        on candidate.id = d.candidate_config_revision_id
       and candidate.organization_id = d.organization_id
       and candidate.project_id = d.project_id
      inner join dts_config_revisions base_candidate
        on base_candidate.id = d.base_config_revision_id
       and base_candidate.organization_id = d.organization_id
       and base_candidate.project_id = d.project_id
       and base_candidate.config_set_id = candidate.config_set_id
      for update of candidate
    ),
    locked_candidate_bindings as materialized (
      select candidate_bpr.id, candidate_bpr.raw_value
      from project_parameter_binding_revisions candidate_bpr
      inner join locked_draft d
        on candidate_bpr.binding_id = d.project_parameter_binding_id
       and candidate_bpr.config_revision_id = d.candidate_config_revision_id
      inner join locked_candidate candidate
        on candidate.id = candidate_bpr.config_revision_id
      for update of candidate_bpr
    ),
    locked_delete_effects as materialized (
      select candidate_effect.id
      from dts_logical_node_revisions candidate_lnr
      inner join dts_occurrence_effects candidate_effect
        on candidate_effect.logical_node_revision_id = candidate_lnr.id
       and candidate_effect.config_revision_id = candidate_lnr.config_revision_id
      inner join locked_draft d
        on candidate_lnr.logical_node_id = d.logical_node_id
       and candidate_lnr.config_revision_id = d.candidate_config_revision_id
      inner join locked_candidate candidate
        on candidate.id = candidate_lnr.config_revision_id
      inner join dts_property_specs candidate_property
        on candidate_property.parameter_spec_id = d.parameter_spec_id
       and candidate_effect.property_name = candidate_property.property_key
      where candidate_effect.effect_kind = 'delete'
      for update of candidate_lnr, candidate_effect
    )
    select
      d.id,
      d.project_id,
      d.project_parameter_binding_id,
      d.parameter_spec_id,
      d.candidate_config_revision_id,
      candidate.status as candidate_status,
      exists (
        select 1 from locked_candidate_bindings
      ) as candidate_has_binding_revision,
      exists (
        select 1 from locked_candidate_bindings candidate_bpr
        where candidate_bpr.raw_value = d.target_value
      ) as candidate_value_matches_draft,
      (
        not exists (select 1 from locked_candidate_bindings)
        and exists (select 1 from locked_delete_effects)
      ) as candidate_delete_tombstone,
      case d.action
        when 'set' then exists (
          select 1 from locked_candidate_bindings candidate_bpr
          where candidate_bpr.raw_value = d.target_value
        )
        when 'delete' then (
          not exists (select 1 from locked_candidate_bindings)
          and exists (select 1 from locked_delete_effects)
        )
        else false
      end as candidate_action_proven,
      exists (
        select 1
        from project_parameter_binding_revisions locked_bpr
        where locked_bpr.id = d.binding_revision_id
          and locked_bpr.binding_id = d.project_parameter_binding_id
          and locked_bpr.config_revision_id = d.base_config_revision_id
      ) as write_lock_matches_binding,
      d.target_value,
      d.action,
      d.reason,
      d.base_config_revision_id,
      d.binding_revision_id,
      d.property_occurrence_id,
      d.source_file_version_id,
      d.expected_checksum,
      d.occurrence_span
    from locked_draft d
    left join locked_candidate candidate on candidate.id = d.candidate_config_revision_id
    `,
    [input.organizationId, input.projectId, input.userId, input.draftId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    bindingId: row.project_parameter_binding_id,
    parameterSpecId: row.parameter_spec_id,
    candidateConfigRevisionId: row.candidate_config_revision_id,
    candidateStatus: row.candidate_status,
    candidateHasBindingRevision: row.candidate_has_binding_revision,
    candidateValueMatchesDraft: row.candidate_value_matches_draft,
    candidateDeleteTombstone: row.candidate_delete_tombstone,
    candidateActionProven: row.candidate_action_proven,
    targetValue: row.target_value,
    action: row.action,
    reason: row.reason,
    writeLock: toWriteLockFields(row),
    writeLockMatchesBinding: row.write_lock_matches_binding
  };
}

export async function promoteBindingDraftCandidateForReview(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    draftId: string;
    candidateConfigRevisionId: string;
  }
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `
    update dts_config_revisions candidate
    set status = 'pending_approval'
    from parameter_drafts draft
    inner join dts_config_revisions base_candidate
      on base_candidate.id = draft.base_config_revision_id
     and base_candidate.organization_id = draft.organization_id
     and base_candidate.project_id = draft.project_id
    where draft.id = $1
      and draft.organization_id = $2
      and draft.project_id = $3
      and draft.candidate_config_revision_id = $4
      and candidate.id = draft.candidate_config_revision_id
      and candidate.organization_id = draft.organization_id
      and candidate.project_id = draft.project_id
      and candidate.config_set_id = base_candidate.config_set_id
      and candidate.status = 'draft'
    returning candidate.id
    `,
    [input.draftId, input.organizationId, input.projectId, input.candidateConfigRevisionId]
  );
  return result.rows.length === 1;
}

export async function getChangeRequestWriteLock(
  db: Queryable,
  input: { organizationId: string; requestId: string }
): Promise<BindingWriteLockFields | null> {
  const result = await db.query<ParameterWriteLockRow>(
    `
    select
      base_config_revision_id,
      binding_revision_id,
      property_occurrence_id,
      source_file_version_id,
      expected_checksum,
      occurrence_span
    from parameter_change_requests
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.requestId]
  );
  const row = result.rows[0];
  return row ? toWriteLockFields(row) : null;
}

export { resetParameterIdentityCutoverCache };

export type ImportPreviewClassification = "added" | "updated" | "unchanged" | "conflict";

export type PersistedImportBatchItem = {
  id: string;
  name: string;
  module: string;
  risk: ParameterRiskLevel;
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
  classification: ImportPreviewClassification;
  definitionId?: string;
  projectParameterValueId?: string;
  riskFlag: boolean;
};

export type PersistedImportBatchDto = Omit<ParameterImportBatchDto, "items"> & {
  items: PersistedImportBatchItem[];
};

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status?: string;
  updated_at?: string | Date;
  module_count?: number | string;
  parameter_count?: number | string;
};

type ProjectModuleRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  parent_id?: string | null;
  path?: string | null;
  depth?: number | string | null;
  parameter_module_id?: string | null;
};

type ParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  value_kind?: string | null;
  module: string;
  parameter_module_id?: string | null;
  module_path?: string | null;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  initSuggestionText: string;
  source_file_name?: string | null;
  source_node_path?: string | null;
  updated_at: string | Date;
};

type ParameterDefinitionImportRow = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  project_parameter_value_id: string | null;
  current_value: string | null;
  initSuggestionText: string | null;
  value_version: number | string | null;
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
  sourceFileName?: string;
  sourceNodePath?: string;
};

export type ProjectParameterValueMatch = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  currentValue: string;
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
  initSuggestionText: string;
  value_version: number | string;
  source_file_name?: string | null;
  source_node_path?: string | null;
};

type ProjectParameterValueMatchRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  current_value: string;
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
  user_id?: string;
  target_value: string;
  action?: ParameterChangeAction;
  reason: string;
  origin?: "manual" | "file_sync";
  origin_file_version_id?: string | null;
  updated_at: string | Date;
  project_parameter_binding_id?: string | null;
  candidate_config_revision_id?: string | null;
};

export type ParameterDraftWithOrigin = {
  id: string;
  userId: string;
  projectId: string;
  projectParameterValueId: string;
  targetValue: string;
  action: ParameterChangeAction;
  origin: "manual" | "file_sync";
  originFileVersionId?: string;
  updatedAt: string;
};

type FileSyncConflictRow = {
  id: string;
  organization_id: string;
  project_id: string;
  project_parameter_value_id: string;
  parameter_definition_id: string;
  file_version_id: string;
  file_draft_id: string;
  ui_draft_id: string;
  file_value: string;
  ui_draft_value: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolved_by_user_id: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
};

export type FileSyncConflictRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  fileVersionId: string;
  fileDraftId: string;
  uiDraftId: string;
  fileValue: string;
  uiDraftValue: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
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
  parameter_definition_id?: string;
  base_version?: number | string;
  module: string;
  title: string;
  current_value: string;
  target_value: string;
  action?: ParameterChangeAction;
  candidate_config_revision_id?: string | null;
  submitter: string;
  submitter_user_id?: string;
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

type WorkflowAssigneesRow = {
  submission_round_id: string;
  workflow_hardware_committer_user_id: string | null;
  workflow_software_committer_user_id: string | null;
  workflow_software_user_id: string | null;
};

export type ReviewDecisionDto = {
  id: string;
  requestId: string;
  reviewerUserId: string;
  decision: ParameterReviewDecision;
  fromStatus: ParameterChangeRequestStatus;
  toStatus: ParameterChangeRequestStatus;
  note?: string;
  createdAt: string;
};

type ReviewDecisionRow = {
  id: string;
  request_id: string;
  reviewer_user_id: string;
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

type ImportBatchRow = {
  id: string;
  project_id: string;
  source_name: string;
  status: "previewed" | "applied";
  summary: ParameterImportSummaryDto;
  items: PersistedImportBatchItem[];
  created_at: string | Date;
  applied_at: string | Date | null;
};

type ImportApplyResultRow = {
  id: string;
  definition_id: string;
  project_parameter_value_id: string;
  new_version: number | string;
};

export type ParameterDefinitionImportCandidate = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: ParameterRiskLevel;
  projectParameterValueId?: string;
  currentValue?: string;
  recommendedValue?: string;
  valueVersion?: number;
};

export type ImportApplyResult = {
  id: string;
  definitionId: string;
  projectParameterValueId: string;
  newVersion: number;
};

export type ListParametersQuery = {
  organizationId: string;
  projectId?: string;
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: ParameterRiskLevel | ParameterRiskLevel[];
  q?: string;
  limit?: number;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function resolveParameterValueKind(row: { value_kind?: string | null; config_format: string }) {
  if (row.value_kind === "complex" || row.value_kind === "scalar") {
    return row.value_kind;
  }

  const format = row.config_format.trim();
  if (format.startsWith("DTS:") || format.toLowerCase().includes("string-list")) {
    return "complex";
  }

  return "scalar";
}

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code
  };
}

function toProjectAdminSummaryDto(row: ProjectRow): ProjectAdminSummaryDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status ?? "initialized",
    moduleCount: Number(row.module_count ?? 0),
    parameterCount: Number(row.parameter_count ?? 0),
    updatedAt: row.updated_at ? dateTimeToIso(row.updated_at) : new Date(0).toISOString()
  };
}

function toProjectModuleDto(row: ProjectModuleRow): ProjectModuleDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
    parentId: row.parent_id ?? null,
    path: row.path ?? undefined,
    depth: row.depth === null || row.depth === undefined ? undefined : Number(row.depth),
    parameterModuleId: row.parameter_module_id ?? null
  };
}

function parseModulePathNames(modulePath: string | null | undefined): string[] | undefined {
  if (!modulePath) {
    return undefined;
  }
  const trimmed = modulePath.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.split("/").filter(Boolean);
}

function normalizeParameterRisk(risk: string | null | undefined): ParameterRiskLevel {
  if (risk === "High" || risk === "Medium" || risk === "Low") return risk;
  return "Low";
}

function toParameterDto(row: ParameterRow, history: ParameterHistoryEntryDto[] = []): ParameterRecordDto {
  const updatedAt = dateTimeToIso(row.updated_at);
  const modulePath = parseModulePathNames(row.module_path);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    valueKind: resolveParameterValueKind(row),
    module: row.module,
    moduleId: row.parameter_module_id ?? undefined,
    modulePath,
    projectId: row.project_id,
    currentValue: row.current_value,
    recommendedValue: row.initSuggestionText,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    sourceFileName: row.source_file_name ?? undefined,
    sourceNodePath: row.source_node_path ?? undefined,
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
  const bindingId = row.project_parameter_binding_id ?? undefined;
  // Post-cutover: parameterId DTO field carries the semantic binding id.
  const parameterId = bindingId ?? row.project_parameter_value_id;
  return {
    id: row.id,
    projectId: row.project_id,
    parameterId,
    targetValue: row.target_value,
    action: row.action ?? "set",
    reason: row.reason,
    updatedAt: dateTimeToIso(row.updated_at),
    ...(bindingId ? { projectParameterBindingId: bindingId } : {}),
    ...(row.candidate_config_revision_id
      ? { candidateConfigRevisionId: row.candidate_config_revision_id }
      : {})
  };
}

function toDraftWithOrigin(row: DraftRow): ParameterDraftWithOrigin {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    targetValue: row.target_value,
    action: row.action ?? "set",
    origin: row.origin ?? "manual",
    originFileVersionId: row.origin_file_version_id ?? undefined,
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toFileSyncConflictRecord(row: FileSyncConflictRow): FileSyncConflictRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    parameterDefinitionId: row.parameter_definition_id,
    fileVersionId: row.file_version_id,
    fileDraftId: row.file_draft_id,
    uiDraftId: row.ui_draft_id,
    fileValue: row.file_value,
    uiDraftValue: row.ui_draft_value,
    status: row.status,
    resolvedByUserId: row.resolved_by_user_id ?? undefined,
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
    createdAt: dateTimeToIso(row.created_at)
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
    recommendedValue: row.initSuggestionText,
    valueVersion: Number(row.value_version),
    sourceFileName: row.source_file_name ?? undefined,
    sourceNodePath: row.source_node_path ?? undefined
  };
}

function toProjectParameterValueMatch(row: ProjectParameterValueMatchRow): ProjectParameterValueMatch {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value
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
    parameterId: row.project_parameter_value_id,
    baseVersion: row.base_version === undefined ? undefined : Number(row.base_version),
    module: row.module,
    title: row.title,
    currentValue: row.current_value,
    targetValue: row.target_value,
    action: row.action ?? "set",
    candidateConfigRevisionId: row.candidate_config_revision_id ?? undefined,
    submitter: row.submitter,
    submitterUserId: row.submitter_user_id,
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
    reviewerUserId: row.reviewer_user_id,
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
      : {})
  };
}

function toParameterDefinitionImportCandidate(row: ParameterDefinitionImportRow): ParameterDefinitionImportCandidate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    module: row.module,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    projectParameterValueId: row.project_parameter_value_id ?? undefined,
    currentValue: row.current_value ?? undefined,
    recommendedValue: row.initSuggestionText ?? undefined,
    valueVersion: row.value_version === null ? undefined : Number(row.value_version)
  };
}

function toImportBatchDto(row: ImportBatchRow): PersistedImportBatchDto {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceName: row.source_name,
    status: row.status,
    createdAt: dateTimeToIso(row.created_at),
    appliedAt: row.applied_at ? dateTimeToIso(row.applied_at) : undefined,
    summary: row.summary,
    items: row.items
  };
}

function toImportApplyResult(row: ImportApplyResultRow): ImportApplyResult {
  return {
    id: row.id,
    definitionId: row.definition_id,
    projectParameterValueId: row.project_parameter_value_id,
    newVersion: Number(row.new_version)
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

export async function getProjectById(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows[0] ? toProjectDto(result.rows[0]) : null;
}

export async function listProjectAdminSummaries(db: Queryable, query: { organizationId: string }) {
  const semantic = await mustUseSemanticParameterIdentity(db);
  const parameterCountSql = semantic
    ? `
      select project_id, count(*)::int as parameter_count
      from project_parameter_bindings
      where organization_id = $1
      group by project_id
    `
    : `
      select project_id, count(*)::int as parameter_count
      from ${LEGACY_IDENTITY_SQL.valuesTable}
      where organization_id = $1
      group by project_id
    `;

  const result = await db.query<ProjectRow>(
    `
    select
      p.id,
      p.name,
      p.code,
      p.status,
      p.updated_at,
      coalesce(module_counts.module_count, 0) as module_count,
      coalesce(param_counts.parameter_count, 0) as parameter_count
    from projects p
    left join (
      select project_id, count(*)::int as module_count
      from project_modules
      where organization_id = $1
      group by project_id
    ) module_counts on module_counts.project_id = p.id
    left join (
      ${parameterCountSql}
    ) param_counts on param_counts.project_id = p.id
    where p.organization_id = $1
    order by p.name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectAdminSummaryDto);
}

export async function getProjectAdminDetail(
  db: Queryable,
  query: { organizationId: string; projectId: string }
): Promise<ProjectAdminDetailDto | null> {
  const summaries = await listProjectAdminSummaries(db, { organizationId: query.organizationId });
  const summary = summaries.find((item) => item.id === query.projectId);
  if (!summary) {
    return null;
  }

  const modules = await listProjectModules(db, query);
  return { ...summary, modules };
}

export async function createProject(
  db: Queryable,
  input: { organizationId: string; id: string; name: string; code: string; status?: string }
) {
  const result = await db.query<ProjectRow>(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, $3, $4, $5)
    returning id, name, code, status, updated_at
    `,
    [input.id, input.organizationId, input.name, input.code, input.status ?? "initialized"]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create project.");
  }

  return toProjectAdminSummaryDto({ ...row, module_count: 0, parameter_count: 0 });
}

export async function updateProject(
  db: Queryable,
  input: { organizationId: string; projectId: string; name?: string; code?: string; status?: string }
) {
  const assignments: string[] = [];
  const values: unknown[] = [input.organizationId, input.projectId];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.code !== undefined) {
    values.push(input.code);
    assignments.push(`code = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (assignments.length === 0) {
    return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
  }

  assignments.push("updated_at = now()");

  const result = await db.query<ProjectRow>(
    `
    update projects
    set ${assignments.join(", ")}
    where organization_id = $1
      and id = $2
    returning id, name, code, status, updated_at
    `,
    values
  );

  if (!result.rows[0]) {
    return null;
  }

  return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
}

export async function deleteProject(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<{ deleted: boolean; reason?: "not_found" }> {
  const exists = await db.query<{ id: string }>(
    `
    select id
    from projects
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.projectId]
  );

  if (!exists.rows[0]) {
    return { deleted: false, reason: "not_found" };
  }

  const { organizationId, projectId } = input;

  await db.query(
    `
    delete from parameter_review_decisions
    where organization_id = $1
      and request_id in (
        select id
        from parameter_change_requests
        where organization_id = $1
          and project_id = $2
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_items
    where organization_id = $1
      and (
        change_request_id in (
          select id
          from parameter_change_requests
          where organization_id = $1
            and project_id = $2
        )
        or submission_round_id in (
          select id
          from parameter_submission_rounds
          where organization_id = $1
            and project_id = $2
        )
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_history_entries
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_change_requests
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_rounds
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_import_batches
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  // Post-cutover: clear semantic topology without querying renamed flat tables.
  // Pre-cutover: delete flat values via explicit transitional adapter only.
  if (!(await mustUseSemanticParameterIdentity(db))) {
    await deletePreCutoverProjectParameterValues(db, { organizationId, projectId });
  } else {
    await db.query(
      `
      update legacy_parameter_migration_evidence
      set project_parameter_binding_id = null,
          parameter_spec_id = null,
          parameter_spec_version_id = null
      where project_parameter_binding_id in (
        select id from project_parameter_bindings
        where organization_id = $1 and project_id = $2
      )
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      update node_operations
      set project_parameter_binding_id = null,
          parameter_spec_id = null
      where organization_id = $1
        and project_parameter_binding_id in (
          select id from project_parameter_bindings
          where organization_id = $1 and project_id = $2
        )
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      delete from project_parameter_bindings
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
    // Delete config revisions before files cascade from projects (member FKs).
    await db.query(
      `
      delete from dts_config_revisions
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      delete from dts_logical_nodes
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
  }

  await db.query(
    `
    delete from project_modules
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  const result = await db.query<{ id: string }>(
    `
    delete from projects
    where organization_id = $1
      and id = $2
    returning id
    `,
    [organizationId, projectId]
  );

  return result.rows[0] ? { deleted: true } : { deleted: false, reason: "not_found" };
}

export async function listProjectModules(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectModuleRow>(
    `
    select id, project_id, name, sort_order, parent_id, path, depth, parameter_module_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const rows = await listSemanticParameters(db, {
      organizationId: query.organizationId,
      projectId: query.projectId,
      module: query.module,
      q: query.q,
      limit
    });
    return rows.map((row) =>
      toParameterDto({
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        explanation: row.explanation,
        config_format: row.config_format,
        value_kind: row.value_kind,
        module: row.module,
        parameter_module_id: row.parameter_module_id,
        module_path: row.module_path,
        default_range: row.default_range,
        unit: row.unit,
        risk: normalizeParameterRisk(row.risk),
        current_value: row.current_value,
        initSuggestionText: row.initSuggestionText ?? "",
        source_file_name: row.source_file_name,
        source_node_path: row.source_node_path,
        updated_at: row.updated_at
      })
    );
  }

  const values: unknown[] = [query.organizationId];
  const where = ["ppv.organization_id = $1", "pd.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `ppv.project_id = ${placeholder}`, query.projectId);
  }

  if (query.module) {
    addCondition(where, values, (placeholder) => `pd.module = ${placeholder}`, query.module);
  }

  if (query.moduleId) {
    where.push(
      buildParameterModuleSubtreeFilter(values, query.moduleId, query.includeDescendants !== false)
    );
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
      pd.value_kind,
      pd.module,
      pd.parameter_module_id,
      (
        select string_agg(pm_seg.name, '/' order by pm_seg.depth)
        from parameter_modules pm_seg
        where pm_seg.organization_id = pd.organization_id
          and pm_seg.id = any(string_to_array(coalesce(pm.path, ''), '/'))
      ) as module_path,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    left join parameter_modules pm on pm.id = pd.parameter_module_id and pm.organization_id = pd.organization_id
    where ${where.join("\n      and ")}
    order by ppv.updated_at desc, pd.name asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => toParameterDto(row));
}

export async function getParameterById(db: Queryable, query: { organizationId: string; parameterId: string }) {
  if (await mustUseSemanticParameterIdentity(db)) {
    const rows = await listSemanticParameters(db, {
      organizationId: query.organizationId,
      limit: 500
    });
    const row = rows.find((candidate) => candidate.id === query.parameterId);
    if (!row) return null;
    const history = await listParameterHistory(db, query);
    return toParameterDto(
      {
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        explanation: row.explanation,
        config_format: row.config_format,
        value_kind: row.value_kind,
        module: row.module,
        parameter_module_id: row.parameter_module_id,
        module_path: row.module_path,
        default_range: row.default_range,
        unit: row.unit,
        risk: normalizeParameterRisk(row.risk),
        current_value: row.current_value,
        initSuggestionText: row.initSuggestionText ?? "",
        source_file_name: row.source_file_name,
        source_node_path: row.source_node_path,
        updated_at: row.updated_at
      },
      history
    );
  }

  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
    const result = await db.query<ParameterHistoryRow>(
      `
      select
        phe.version,
        phe.value,
        phe.changed_at,
        users.name as changed_by,
        phe.request_id
      from parameter_history_entries phe
      left join users on users.id = phe.changed_by_user_id
      where phe.organization_id = $1
        and phe.project_parameter_binding_id = $2
      order by phe.changed_at desc
      `,
      [query.organizationId, query.parameterId]
    );
    return result.rows.map(toHistoryDto);
  }

  const result = await db.query<ParameterHistoryRow>(
    `
    select
      phe.version,
      phe.value,
      phe.changed_at,
      users.name as changed_by,
      phe.request_id
    from parameter_history_entries phe
    inner join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = phe.project_parameter_value_id
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = phe.parameter_definition_id
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

  const semantic = await mustUseSemanticParameterIdentity(db);
  const result = await db.query<DraftRow>(
    semantic
      ? `
    select
      id,
      project_id,
      coalesce(project_parameter_binding_id, '') as project_parameter_value_id,
      target_value,
      action,
      reason,
      updated_at,
      project_parameter_binding_id,
      candidate_config_revision_id
    from parameter_drafts
    where ${where.join("\n      and ")}
    order by updated_at desc
    `
      : `
    select id, project_id, project_parameter_value_id, target_value, action, reason, updated_at, project_parameter_binding_id, candidate_config_revision_id
    from parameter_drafts
    where ${where.join("\n      and ")}
    order by updated_at desc
    `,
    values
  );

  return result.rows.map(toDraftDto);
}

export async function listDraftsForParameterValue(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  const semantic = await mustUseSemanticParameterIdentity(db);
  const result = await db.query<DraftRow>(
    semantic
      ? `
    select
      id,
      user_id,
      project_id,
      coalesce(project_parameter_binding_id, '') as project_parameter_value_id,
      target_value,
      action,
      origin,
      origin_file_version_id,
      updated_at,
      project_parameter_binding_id
    from parameter_drafts
    where project_parameter_binding_id = $1
    order by updated_at desc, id asc
    `
      : `
    select id, user_id, project_id, project_parameter_value_id, target_value, action, origin, origin_file_version_id, updated_at, project_parameter_binding_id
    from parameter_drafts
    where project_parameter_value_id = $1
    order by updated_at desc, id asc
    `,
    [query.projectParameterValueId]
  );

  return result.rows.map(toDraftWithOrigin);
}

export async function listOpenBindingDraftsForUser(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string },
): Promise<
  Array<{
    id: string;
    candidateConfigRevisionId: string | null;
    projectParameterBindingId: string | null;
    updatedAt: string;
  }>
> {
  const result = await db.query<{
    id: string;
    candidate_config_revision_id: string | null;
    project_parameter_binding_id: string | null;
    updated_at: Date | string;
  }>(
    `
    select id, candidate_config_revision_id, project_parameter_binding_id, updated_at
    from parameter_drafts
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and project_parameter_binding_id is not null
    order by updated_at desc, id asc
    `,
    [input.organizationId, input.projectId, input.userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    candidateConfigRevisionId: row.candidate_config_revision_id,
    projectParameterBindingId: row.project_parameter_binding_id,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
  }));
}

export async function rebaseOpenBindingDraftCandidates(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    candidateConfigRevisionId: string;
    excludeDraftId?: string;
  },
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `
    update parameter_drafts
    set candidate_config_revision_id = $4,
        updated_at = now()
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and project_parameter_binding_id is not null
      and candidate_config_revision_id is distinct from $4
      and ($5::text is null or id <> $5)
    returning id
    `,
    [
      input.organizationId,
      input.projectId,
      input.userId,
      input.candidateConfigRevisionId,
      input.excludeDraftId ?? null,
    ],
  );
  return result.rows.map((row) => row.id);
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
    action?: ParameterChangeAction;
    reason: string;
    origin?: "manual" | "file_sync";
    originFileVersionId?: string;
    /** Semantic binding identity — required for topology-aware drafts. */
    projectParameterBindingId?: string;
    parameterSpecId?: string;
    writeLock?: BindingWriteLockFields;
    candidateConfigRevisionId?: string;
  }
) {
  if (await mustUseSemanticParameterIdentity(db)) {
    const bindingId = input.projectParameterBindingId ?? input.parameterId;
    const row = await upsertSemanticDraft(db, {
      id: input.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      bindingId,
      userId: input.userId,
      targetValue: input.targetValue,
      action: input.action,
      reason: input.reason,
      origin: input.origin,
      originFileVersionId: input.originFileVersionId,
      baseConfigRevisionId: input.writeLock?.baseConfigRevisionId,
      bindingRevisionId: input.writeLock?.bindingRevisionId,
      propertyOccurrenceId: input.writeLock?.propertyOccurrenceId,
      sourceFileVersionId: input.writeLock?.sourceFileVersionId,
      expectedChecksum: input.writeLock?.expectedChecksum,
      occurrenceSpan: input.writeLock?.occurrenceSpan,
      candidateConfigRevisionId: input.candidateConfigRevisionId,
    });
    void input.parameterSpecId;
    if (!row) {
      throw new Error("Failed to upsert semantic parameter draft");
    }
    return toDraftDto({
      id: row.id,
      project_id: row.project_id,
      project_parameter_value_id: bindingId,
      target_value: row.target_value,
      action: row.action,
      reason: row.reason,
      updated_at: row.updated_at,
      project_parameter_binding_id: row.project_parameter_binding_id
    });
  }

  const result = await db.query<DraftRow>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id,
      target_value, reason, origin, origin_file_version_id,
      action, project_parameter_binding_id, candidate_config_revision_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    on conflict (project_id, project_parameter_value_id, user_id)
    do update set
      target_value = excluded.target_value,
      reason = excluded.reason,
      origin = excluded.origin,
      origin_file_version_id = excluded.origin_file_version_id,
      action = excluded.action,
      project_parameter_binding_id = coalesce(
        excluded.project_parameter_binding_id,
        parameter_drafts.project_parameter_binding_id
      ),
      candidate_config_revision_id = coalesce(
        excluded.candidate_config_revision_id,
        parameter_drafts.candidate_config_revision_id
      ),
      updated_at = now()
    returning id, project_id, project_parameter_value_id, target_value, action, reason, updated_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.parameterId,
      input.userId,
      input.targetValue,
      input.reason,
      input.origin ?? "manual",
      input.originFileVersionId ?? null,
      input.action ?? "set",
      input.projectParameterBindingId ?? null,
      input.candidateConfigRevisionId ?? null
    ]
  );

  // parameter_spec_id is stored on change requests / history; drafts carry binding id.
  void input.parameterSpecId;

  return toDraftDto(result.rows[0]);
}

export async function upsertFileSyncDraft(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectParameterValueId: string;
    userId: string;
    targetValue: string;
    reason: string;
    originFileVersionId: string;
  }
) {
  return upsertDraft(db, {
    id: `${input.projectParameterValueId}-${input.userId}-file-sync`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    parameterId: input.projectParameterValueId,
    userId: input.userId,
    targetValue: input.targetValue,
    reason: input.reason,
    origin: "file_sync",
    originFileVersionId: input.originFileVersionId
  });
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
  if (await mustUseSemanticParameterIdentity(db)) {
    await db.query(
      `
      delete from parameter_drafts
      where organization_id = $1
        and user_id = $2
        and project_id = $3
        and project_parameter_binding_id = $4
      `,
      [input.organizationId, input.userId, input.projectId, input.parameterId]
    );
    return;
  }

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

export async function hasOpenFileSyncConflict(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  if (await mustUseSemanticParameterIdentity(db)) {
    const result = await db.query<{ id: string }>(
      `
      select id
      from parameter_file_sync_conflicts
      where project_parameter_binding_id = $1
        and status = 'open'
      limit 1
      `,
      [query.projectParameterValueId]
    );
    return result.rows.length > 0;
  }

  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_file_sync_conflicts
    where project_parameter_value_id = $1
      and status = 'open'
    limit 1
    `,
    [query.projectParameterValueId]
  );

  return result.rows.length > 0;
}

export async function insertFileSyncConflict(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    projectParameterValueId: string;
    parameterDefinitionId: string;
    fileVersionId: string;
    fileDraftId: string;
    uiDraftId: string;
    fileValue: string;
    uiDraftValue: string;
    parameterSpecId?: string;
    projectParameterBindingId?: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    insert into parameter_file_sync_conflicts (
      id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
      file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status,
      parameter_spec_id, project_parameter_binding_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.projectParameterValueId,
      input.parameterDefinitionId,
      input.fileVersionId,
      input.fileDraftId,
      input.uiDraftId,
      input.fileValue,
      input.uiDraftValue,
      input.parameterSpecId ?? null,
      input.projectParameterBindingId ?? null
    ]
  );

  return toFileSyncConflictRecord(result.rows[0]);
}

export async function listOpenConflicts(
  db: Queryable,
  query: { organizationId: string; projectParameterValueId?: string; projectId?: string; conflictId?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["organization_id = $1", "status = 'open'"];
  if (query.projectParameterValueId) {
    addCondition(
      where,
      values,
      (placeholder) => `project_parameter_value_id = ${placeholder}`,
      query.projectParameterValueId
    );
  }
  if (query.projectId) {
    addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, query.projectId);
  }
  if (query.conflictId) {
    addCondition(where, values, (placeholder) => `id = ${placeholder}`, query.conflictId);
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    select *
    from parameter_file_sync_conflicts
    where ${where.join("\n      and ")}
    order by created_at desc, id desc
    `,
    values
  );

  return result.rows.map(toFileSyncConflictRecord);
}

export async function resolveConflict(
  db: Queryable,
  input: {
    organizationId: string;
    conflictId: string;
    status: "resolved_file" | "resolved_ui";
    resolvedByUserId: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    update parameter_file_sync_conflicts
    set status = $3,
      resolved_by_user_id = $4,
      resolved_at = now()
    where organization_id = $1
      and id = $2
      and status = 'open'
    returning *
    `,
    [input.organizationId, input.conflictId, input.status, input.resolvedByUserId]
  );

  const row = result.rows[0];
  return row ? toFileSyncConflictRecord(row) : null;
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
  if (await mustUseSemanticParameterIdentity(db)) {
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
        users.name as submitter,
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
      inner join users on users.id = inserted.submitter_user_id
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
      users.name as submitter,
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
    inner join users on users.id = inserted.submitter_user_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
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
      left join lateral (
        select psv.*
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
        limit 1
      ) psv on true
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
    select psr.id, psr.project_id, projects.name as project_name, users.name as submitter,
      psr.status, psr.summary, psr.created_at
    from parameter_submission_rounds psr
    inner join projects on projects.id = psr.project_id
    inner join users on users.id = psr.submitter_user_id
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

  const semantic = await mustUseSemanticParameterIdentity(db);
  const result = await db.query<ChangeRequestRow>(
    semantic
      ? `
    select
      pcr.id,
      pcr.submission_round_id,
      pcr.project_id,
      coalesce(pcr.project_parameter_binding_id, '') as project_parameter_value_id,
      pcr.base_version,
      split_part(ps.specification_key, '/', 1) as module,
      coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      users.name as submitter,
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
      null::text as source_file_name,
      lnr.node_locator as source_node_path
    from parameter_change_requests pcr
    left join parameter_specs ps on ps.id = pcr.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join lateral (
      select psv.*
      from parameter_spec_versions psv
      where psv.parameter_spec_id = ps.id
      order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
      limit 1
    ) psv on true
    left join project_parameter_bindings b on b.id = pcr.project_parameter_binding_id
    left join lateral (
      select lnr.node_locator
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = b.logical_node_id
      order by lnr.config_revision_id desc
      limit 1
    ) lnr on true
    inner join users on users.id = pcr.submitter_user_id
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
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      users.name as submitter,
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
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
    const result = await db.query<ChangeRequestRow>(
      `
      select
        pcr.id,
        pcr.submission_round_id,
        pcr.project_id,
        coalesce(pcr.project_parameter_binding_id, '') as project_parameter_value_id,
        pcr.base_version,
        split_part(ps.specification_key, '/', 1) as module,
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as title,
        pcr.current_value,
        pcr.target_value,
        pcr.action,
        pcr.candidate_config_revision_id,
        users.name as submitter,
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
        null::text as source_file_name,
        null::text as source_node_path
      from parameter_change_requests pcr
      left join parameter_specs ps on ps.id = pcr.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join lateral (
        select psv.*
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
        limit 1
      ) psv on true
      inner join users on users.id = pcr.submitter_user_id
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
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      users.name as submitter,
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
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
    const result = await db.query<ChangeRequestRow>(
      `
      select
        pcr.id,
        pcr.submission_round_id,
        pcr.project_id,
        coalesce(pcr.project_parameter_binding_id, '') as project_parameter_value_id,
        null::text as parameter_definition_id,
        pcr.base_version,
        split_part(ps.specification_key, '/', 1) as module,
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as title,
        pcr.current_value,
        pcr.target_value,
        pcr.action,
        pcr.candidate_config_revision_id,
        users.name as submitter,
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
        null::text as source_file_name,
        null::text as source_node_path
      from parameter_change_requests pcr
      left join parameter_specs ps on ps.id = pcr.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join lateral (
        select psv.*
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
        limit 1
      ) psv on true
      inner join users on users.id = pcr.submitter_user_id
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
      pd.module,
      pd.name as title,
      pcr.current_value,
      pcr.target_value,
      pcr.action,
      pcr.candidate_config_revision_id,
      users.name as submitter,
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
    inner join users on users.id = pcr.submitter_user_id
    left join users assignee on assignee.id = pcr.assigned_to_user_id
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = pcr.project_parameter_value_id
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
  if (await mustUseSemanticParameterIdentity(db)) {
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
  if (await mustUseSemanticParameterIdentity(db)) {
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

export async function getProjectParameterForUpdate(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  if (await mustUseSemanticParameterIdentity(db)) {
    const result = await db.query<ProjectParameterForUpdateRow>(
      `
      select
        b.id,
        b.project_id,
        b.parameter_spec_id as parameter_definition_id,
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as name,
        split_part(ps.specification_key, '/', 1) as module,
        coalesce(psv.value_shape->>'unit', '') as unit,
        'Low' as risk,
        coalesce(bpr.raw_value, '') as current_value,
        '' as "initSuggestionText",
        coalesce(
          (select count(*)::int from project_parameter_binding_revisions br where br.binding_id = b.id),
          1
        ) as value_version,
        null::text as source_file_name,
        lnr.node_locator as source_node_path
      from project_parameter_bindings b
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join lateral (
        select psv.*
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
        limit 1
      ) psv on true
      left join lateral (
        select bpr.raw_value
        from project_parameter_binding_revisions bpr
        where bpr.binding_id = b.id
        order by bpr.created_at desc
        limit 1
      ) bpr on true
      left join dts_logical_nodes ln on ln.id = b.logical_node_id
      left join lateral (
        select lnr.node_locator
        from dts_logical_node_revisions lnr
        where lnr.logical_node_id = ln.id
        order by lnr.config_revision_id desc
        limit 1
      ) lnr on true
      where b.organization_id = $1
        and b.project_id = $2
        and b.id = $3
      for update of b
      `,
      [query.organizationId, query.projectId, query.parameterId]
    );
    return result.rows[0] ? toProjectParameterForUpdate(result.rows[0]) : null;
  }

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
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.value_version,
      ppv.source_file_name,
      ppv.source_node_path
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
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

export async function findProjectValueBySource(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.source_file_name = $3
      and ppv.source_node_path = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.sourceFileName, query.sourceNodePath]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function findProjectValueByDefinition(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    name: string;
    module: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and pd.name = $3
      and pd.module = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.name, query.module]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function bindParameterSource(
  db: Queryable,
  input: {
    projectParameterValueId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  await db.query(
    `
    update ${LEGACY_IDENTITY_SQL.valuesTable}
    set source_file_name = $2,
      source_node_path = $3,
      updated_at = now()
    where id = $1
    `,
    [input.projectParameterValueId, input.sourceFileName, input.sourceNodePath]
  );
}

/**
 * Create a parameter definition + project value bound to a structural DTS source path.
 * Used by structured edit submit when no existing PPV matches source or (name, module).
 */
export async function insertProjectParameterValueWithSource(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    definitionId: string;
    name: string;
    module: string;
    currentValue: string;
    recommendedValue: string;
    actorUserId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
): Promise<ProjectParameterValueMatch> {
  await db.query(
    `
    insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    )
    values ($1, $2, $3, $3, $3, 'DTS', $4, '', '', 'Low')
    on conflict (id) do nothing
    `,
    [input.definitionId, input.organizationId, input.name, input.module]
  );

  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
      id, organization_id, project_id, parameter_definition_id,
      current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id,
      source_file_name, source_node_path
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning
      id,
      project_id,
      parameter_definition_id,
      $10::text as name,
      $11::text as module,
      current_value
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.definitionId,
      input.currentValue,
      input.recommendedValue,
      input.actorUserId,
      input.sourceFileName,
      input.sourceNodePath,
      input.name,
      input.module
    ]
  );

  return toProjectParameterValueMatch(result.rows[0]);
}

export async function listParameterDefinitionsForImport(
  db: Queryable,
  query: { organizationId: string; projectId: string; names: string[]; definitionIds: string[] }
) {
  const result = await db.query<ParameterDefinitionImportRow>(
    `
    select
      pd.id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.id as project_parameter_value_id,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.value_version
    from ${LEGACY_IDENTITY_SQL.definitionsTable} pd
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.parameter_definition_id = pd.id
      and ppv.organization_id = $1
      and ppv.project_id = $2
    where pd.organization_id = $1
      and (pd.name = any($3::text[]) or pd.id = any($4::text[]))
    order by pd.name asc
    `,
    [query.organizationId, query.projectId, query.names, query.definitionIds]
  );

  return result.rows.map(toParameterDefinitionImportCandidate);
}

export async function insertImportBatch(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    createdByUserId: string;
    sourceName: string;
    summary: ParameterImportSummaryDto;
    items: PersistedImportBatchItem[];
  }
) {
  const result = await db.query<ImportBatchRow>(
    `
    insert into parameter_import_batches (
      id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.createdByUserId,
      input.sourceName,
      "previewed",
      JSON.stringify(input.summary),
      JSON.stringify(input.items)
    ]
  );

  return toImportBatchDto(result.rows[0]);
}

export async function getImportBatchForUpdate(
  db: Queryable,
  query: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    select id, project_id, source_name, status, summary, items, created_at, applied_at
    from parameter_import_batches
    where organization_id = $1
      and id = $2
    for update
    `,
    [query.organizationId, query.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}

export async function applyAddedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  const result = await db.query<ImportApplyResultRow>(
    `
    with inserted_definition as (
      insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do nothing
      returning id
    ),
    inserted_value as (
      insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
        id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id
      )
      select $4, $1, $2, inserted_definition.id, $11, $12, $3
      from inserted_definition
      on conflict (project_id, parameter_definition_id) do update set
        current_value = excluded.current_value,
        ${LEGACY_SQL.recommendedValueColumn} = excluded.${LEGACY_SQL.recommendedValueColumn},
        value_version = ${LEGACY_IDENTITY_SQL.valuesTable}.value_version + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
      returning id, parameter_definition_id, value_version
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, $2, parameter_definition_id, id, value_version, $11, $3, null
      from inserted_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from inserted_value
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function applyUpdatedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  const result = await db.query<ImportApplyResultRow>(
    `
    with upserted_definition as (
      insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        explanation = excluded.explanation,
        config_format = excluded.config_format,
        module = excluded.module,
        default_range = excluded.default_range,
        unit = excluded.unit,
        risk = excluded.risk,
        updated_at = now()
      where ${LEGACY_IDENTITY_SQL.definitionsTable}.organization_id = $1
      returning id
    ),
    existing_value as (
      select
        ppv.id,
        ppv.project_id,
        ppv.parameter_definition_id,
        ppv.current_value,
        ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
        ppv.value_version
      from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
      inner join upserted_definition on upserted_definition.id = ppv.parameter_definition_id
      where ppv.organization_id = $1
        and ppv.project_id = $2
    ),
    inserted_value as (
      insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
        id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id
      )
      select $4, $1, $2, upserted_definition.id, $11, $12, $3
      from upserted_definition
      where not exists (select 1 from existing_value)
      returning id, project_id, parameter_definition_id, current_value, value_version
    ),
    updated_value as (
      update ${LEGACY_IDENTITY_SQL.valuesTable} ppv
      set current_value = $11,
        ${LEGACY_SQL.recommendedValueColumn} = $12,
        value_version = ppv.value_version + 1,
        updated_by_user_id = $3,
        updated_at = now()
      from upserted_definition
      where ppv.organization_id = $1
        and ppv.project_id = $2
        and ppv.parameter_definition_id = upserted_definition.id
        and (
          ppv.current_value is distinct from $11
          or ppv.${LEGACY_SQL.recommendedValueColumn} is distinct from $12
        )
      returning ppv.id, ppv.project_id, ppv.parameter_definition_id, ppv.current_value, ppv.value_version
    ),
    changed_value as (
      select id, project_id, parameter_definition_id, current_value, value_version from inserted_value
      union all
      select id, project_id, parameter_definition_id, current_value, value_version from updated_value
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, project_id, parameter_definition_id, id, value_version, current_value, $3, null
      from changed_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from changed_value
    union all
    select $4 as id, upserted_definition.id as definition_id, existing_value.id as project_parameter_value_id, existing_value.value_version as new_version
    from upserted_definition
    inner join existing_value on existing_value.parameter_definition_id = upserted_definition.id
    where not exists (select 1 from changed_value)
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function markImportBatchApplied(
  db: Queryable,
  input: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    update parameter_import_batches
    set status = 'applied',
      applied_at = now()
    where organization_id = $1
      and id = $2
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [input.organizationId, input.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}

async function listSubmissionItemsByRoundIds(
  db: Queryable,
  query: { organizationId: string; roundIds: string[] }
) {
  const semantic = await mustUseSemanticParameterIdentity(db);
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
    left join lateral (
      select version.*
      from parameter_spec_versions version
      where version.parameter_spec_id = ps.id
      order by case when version.lifecycle = 'active' then 0 else 1 end, version.version desc
      limit 1
    ) psv on true
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
