import type { Queryable } from "../../shared/database/client";
import type {
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportSummaryDto,
  ParameterHistoryEntryDto,
  ParameterRecordDto,
  ParameterChangeAction
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
import { type ParameterRiskLevel } from "./status";
import { LEGACY_SQL } from "../parameter-topology/migration";
import {
  listSemanticParameters,
  upsertSemanticDraft
} from "./semanticParameterReads";
import { parameterIdentityMode } from "./parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";
import type { BindingWriteLockFields, EnablementWriteLockFields } from "../parameter-topology/editService";

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
      select d.*, b.parameter_spec_id, b.logical_node_id as binding_logical_node_id
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
        on candidate_lnr.logical_node_id = d.binding_logical_node_id
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

export type { EnablementWriteLockFields };

export function toEnablementWriteLockFields(
  row: ParameterWriteLockRow
): EnablementWriteLockFields | null {
  if (!row.base_config_revision_id || !row.source_file_version_id || !row.expected_checksum) {
    return null;
  }
  return {
    baseConfigRevisionId: row.base_config_revision_id,
    propertyOccurrenceId: row.property_occurrence_id,
    sourceFileVersionId: row.source_file_version_id,
    expectedChecksum: row.expected_checksum,
    occurrenceSpan: row.occurrence_span,
  };
}

export type EnablementDraftForSubmission = {
  id: string;
  projectId: string;
  logicalNodeId: string;
  candidateConfigRevisionId: string | null;
  candidateStatus: string | null;
  candidateHasStatusEffect: boolean;
  candidateValueMatchesDraft: boolean;
  candidateDeleteTombstone: boolean;
  candidateActionProven: boolean;
  targetValue: string;
  action: ParameterChangeAction;
  reason: string;
  writeLock: EnablementWriteLockFields | null;
  writeLockMatchesRevision: boolean;
};

/**
 * Enablement twin of getBindingDraftForSubmission.
 * Candidate proof comes from `status` occurrence effects on the logical node,
 * not from binding revisions, and the write lock carries no binding_revision_id.
 */
export async function getEnablementDraftForSubmission(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    draftId: string;
  }
): Promise<EnablementDraftForSubmission | null> {
  const result = await db.query<
    ParameterWriteLockRow & {
      id: string;
      project_id: string;
      logical_node_id: string;
      candidate_config_revision_id: string | null;
      candidate_status: string | null;
      candidate_has_status_effect: boolean;
      candidate_value_matches_draft: boolean;
      candidate_delete_tombstone: boolean;
      candidate_action_proven: boolean;
      write_lock_matches_revision: boolean;
      target_value: string;
      action: ParameterChangeAction;
      reason: string;
    }
  >(
    `
    with locked_draft as materialized (
      select d.*, base_lnr.node_locator as base_node_locator
      from parameter_drafts d
      inner join dts_logical_nodes ln
        on ln.id = d.logical_node_id
       and ln.organization_id = d.organization_id
       and ln.project_id = d.project_id
      -- Tip candidates may mint a new logical_node_id for the same locator when
      -- continuity rematches; prove status by node_locator, not stable id equality.
      inner join dts_logical_node_revisions base_lnr
        on base_lnr.logical_node_id = d.logical_node_id
       and base_lnr.config_revision_id = d.base_config_revision_id
      where d.organization_id = $1
        and d.project_id = $2
        and d.user_id = $3
        and d.id = $4
        and d.edit_subject_kind = 'node-enablement'
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
    locked_status_effects as materialized (
      select candidate_effect.id, candidate_effect.effect_kind, candidate_occurrence.raw_text
      from dts_logical_node_revisions candidate_lnr
      inner join dts_occurrence_effects candidate_effect
        on candidate_effect.logical_node_revision_id = candidate_lnr.id
       and candidate_effect.config_revision_id = candidate_lnr.config_revision_id
       and candidate_effect.property_name = 'status'
      inner join locked_draft d
        on candidate_lnr.node_locator = d.base_node_locator
       and candidate_lnr.config_revision_id = d.candidate_config_revision_id
      inner join locked_candidate candidate
        on candidate.id = candidate_lnr.config_revision_id
      left join dts_property_occurrences candidate_occurrence
        on candidate_occurrence.id = candidate_effect.property_occurrence_id
      for update of candidate_lnr, candidate_effect
    )
    select
      d.id,
      d.project_id,
      d.logical_node_id,
      d.candidate_config_revision_id,
      candidate.status as candidate_status,
      exists (
        select 1 from locked_status_effects where effect_kind in ('set', 'override')
      ) as candidate_has_status_effect,
      exists (
        select 1
        from locked_status_effects
        where effect_kind in ('set', 'override')
          and raw_text = d.target_value
      ) as candidate_value_matches_draft,
      (
        not exists (
          select 1 from locked_status_effects where effect_kind in ('set', 'override')
        )
        and exists (select 1 from locked_status_effects where effect_kind = 'delete')
      ) as candidate_delete_tombstone,
      case d.action
        when 'set' then exists (
          select 1
          from locked_status_effects
          where effect_kind in ('set', 'override')
            and raw_text = d.target_value
        )
        when 'delete' then (
          not exists (
            select 1 from locked_status_effects where effect_kind in ('set', 'override')
          )
          and exists (select 1 from locked_status_effects where effect_kind = 'delete')
        )
        else false
      end as candidate_action_proven,
      exists (
        select 1
        from dts_config_revision_members locked_member
        inner join dts_config_revisions base_revision
          on base_revision.id = locked_member.config_revision_id
         and base_revision.organization_id = d.organization_id
         and base_revision.project_id = d.project_id
        where locked_member.config_revision_id = d.base_config_revision_id
          and locked_member.file_version_id = d.source_file_version_id
      ) as write_lock_matches_revision,
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
    logicalNodeId: row.logical_node_id,
    candidateConfigRevisionId: row.candidate_config_revision_id,
    candidateStatus: row.candidate_status,
    candidateHasStatusEffect: row.candidate_has_status_effect,
    candidateValueMatchesDraft: row.candidate_value_matches_draft,
    candidateDeleteTombstone: row.candidate_delete_tombstone,
    candidateActionProven: row.candidate_action_proven,
    targetValue: row.target_value,
    action: row.action,
    reason: row.reason,
    writeLock: toEnablementWriteLockFields(row),
    writeLockMatchesRevision: row.write_lock_matches_revision
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
      and edit_subject_kind = 'binding'
    limit 1
    `,
    [input.organizationId, input.requestId]
  );
  const row = result.rows[0];
  return row ? toWriteLockFields(row) : null;
}

export async function getChangeRequestEnablementWriteLock(
  db: Queryable,
  input: { organizationId: string; requestId: string }
): Promise<EnablementWriteLockFields | null> {
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
      and edit_subject_kind = 'node-enablement'
    limit 1
    `,
    [input.organizationId, input.requestId]
  );
  const row = result.rows[0];
  return row ? toEnablementWriteLockFields(row) : null;
}

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
  parameter_spec_id?: string | null;
  base_raw_value?: string | null;
  property_name?: string | null;
  driver_module?: string | null;
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

type FileSyncConflictSourceLocator = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

type FileSyncConflictRow = {
  id: string;
  organization_id: string;
  project_id: string;
  project_parameter_value_id?: string | null;
  parameter_definition_id?: string | null;
  project_parameter_binding_id?: string | null;
  parameter_spec_id?: string | null;
  file_version_id: string;
  file_draft_id: string;
  ui_draft_id: string;
  file_value: string;
  ui_draft_value: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolved_by_user_id: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
  base_value?: string | null;
  parameter_name?: string | null;
  parameter_module?: string | null;
  file_version_number?: number | string | null;
  file_version_created_at?: string | Date | null;
  file_draft_updated_at?: string | Date | null;
  ui_draft_updated_at?: string | Date | null;
  file_id?: string | null;
  file_name?: string | null;
  config_set_id?: string | null;
  source_node_path?: string | null;
  source_start_offset?: number | null;
  source_end_offset?: number | null;
  source_start_line?: number | null;
  source_start_column?: number | null;
  source_end_line?: number | null;
  source_end_column?: number | null;
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
  baseValue?: string;
  parameterName?: string;
  parameterModule?: string;
  fileVersionNumber?: number;
  fileVersionLabel?: string;
  fileVersionCreatedAt?: string;
  fileDraftUpdatedAt?: string;
  uiDraftUpdatedAt?: string;
  fileId?: string;
  fileName?: string;
  configSetId?: string;
  nodePath?: string;
  propertyName?: string;
  sourceNodePath?: string;
  source?: FileSyncConflictSourceLocator;
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

export function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export function resolveParameterValueKind(row: { value_kind?: string | null; config_format: string }) {
  if (row.value_kind === "complex" || row.value_kind === "scalar") {
    return row.value_kind;
  }

  const format = row.config_format.trim();
  if (format.startsWith("DTS:") || format.toLowerCase().includes("string-list")) {
    return "complex";
  }

  return "scalar";
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
  const currentValue = row.base_raw_value ?? undefined;
  const name = row.property_name?.trim() || undefined;
  const module = row.driver_module?.trim() || undefined;
  const candidateConfigRevisionId = row.candidate_config_revision_id?.trim() || undefined;
  const parameterSpecId = row.parameter_spec_id?.trim() || undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    parameterId,
    targetValue: row.target_value,
    action: row.action ?? "set",
    reason: row.reason,
    updatedAt: dateTimeToIso(row.updated_at),
    ...(bindingId ? { projectParameterBindingId: bindingId } : {}),
    ...(candidateConfigRevisionId ? { candidateConfigRevisionId } : {}),
    ...(parameterSpecId ? { parameterSpecId } : {}),
    ...(name ? { name } : {}),
    ...(module ? { module } : {}),
    ...(currentValue !== undefined && currentValue !== null ? { currentValue } : {})
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

function splitSourceNodePath(sourceNodePath: string | null | undefined): {
  nodePath?: string;
  propertyName?: string;
} {
  if (!sourceNodePath) {
    return {};
  }
  const separator = sourceNodePath.lastIndexOf("/");
  if (separator <= 0 || separator === sourceNodePath.length - 1) {
    return { nodePath: sourceNodePath };
  }
  return {
    nodePath: sourceNodePath.slice(0, separator),
    propertyName: sourceNodePath.slice(separator + 1)
  };
}

function toFileSyncConflictSource(
  row: FileSyncConflictRow
): FileSyncConflictSourceLocator | undefined {
  if (
    row.source_start_offset == null ||
    row.source_end_offset == null ||
    row.source_start_line == null ||
    row.source_start_column == null ||
    row.source_end_line == null ||
    row.source_end_column == null
  ) {
    return undefined;
  }
  return {
    startOffset: Number(row.source_start_offset),
    endOffset: Number(row.source_end_offset),
    startLine: Number(row.source_start_line),
    startColumn: Number(row.source_start_column),
    endLine: Number(row.source_end_line),
    endColumn: Number(row.source_end_column)
  };
}

function toFileSyncConflictRecord(row: FileSyncConflictRow): FileSyncConflictRecord {
  const sourceNodePath = row.source_node_path ?? undefined;
  const { nodePath, propertyName } = splitSourceNodePath(sourceNodePath);
  const fileVersionNumber =
    row.file_version_number == null || row.file_version_number === ""
      ? undefined
      : Number(row.file_version_number);
  const source = toFileSyncConflictSource(row);
  const bindingId = row.project_parameter_binding_id ?? row.project_parameter_value_id ?? "";
  const specId = row.parameter_spec_id ?? row.parameter_definition_id ?? "";

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    // Post-cutover DTO compatibility: binding/spec ids occupy the legacy field names.
    projectParameterValueId: bindingId,
    parameterDefinitionId: specId,
    fileVersionId: row.file_version_id,
    fileDraftId: row.file_draft_id,
    uiDraftId: row.ui_draft_id,
    fileValue: row.file_value,
    uiDraftValue: row.ui_draft_value,
    status: row.status,
    resolvedByUserId: row.resolved_by_user_id ?? undefined,
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
    createdAt: dateTimeToIso(row.created_at),
    baseValue: row.base_value ?? undefined,
    parameterName: row.parameter_name ?? undefined,
    parameterModule: row.parameter_module ?? undefined,
    fileVersionNumber: Number.isFinite(fileVersionNumber) ? fileVersionNumber : undefined,
    fileVersionLabel:
      Number.isFinite(fileVersionNumber) && fileVersionNumber != null
        ? `v${fileVersionNumber}`
        : undefined,
    fileVersionCreatedAt: row.file_version_created_at
      ? dateTimeToIso(row.file_version_created_at)
      : undefined,
    fileDraftUpdatedAt: row.file_draft_updated_at
      ? dateTimeToIso(row.file_draft_updated_at)
      : undefined,
    uiDraftUpdatedAt: row.ui_draft_updated_at ? dateTimeToIso(row.ui_draft_updated_at) : undefined,
    fileId: row.file_id ?? undefined,
    fileName: row.file_name ?? undefined,
    configSetId: row.config_set_id ?? undefined,
    nodePath,
    propertyName,
    sourceNodePath,
    source
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

export function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

export async function listParameters(db: Queryable, query: ListParametersQuery) {
  if (parameterIdentityMode() === "semantic") {
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
  if (parameterIdentityMode() === "semantic") {
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
  if (parameterIdentityMode() === "semantic") {
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
  const where = ["d.organization_id = $1", "d.user_id = $2"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `d.project_id = ${placeholder}`, query.projectId);
  }

  const semantic = parameterIdentityMode() === "semantic";
  const result = await db.query<DraftRow>(
    semantic
      ? `
    select
      d.id,
      d.project_id,
      coalesce(d.project_parameter_binding_id, '') as project_parameter_value_id,
      d.target_value,
      d.action,
      d.reason,
      d.updated_at,
      d.project_parameter_binding_id,
      d.candidate_config_revision_id,
      b.parameter_spec_id,
      locked_bpr.raw_value as base_raw_value,
      coalesce(
        dps.property_key,
        nullif(split_part(ps.specification_key, '/', 2), ''),
        ps.specification_key
      ) as property_name,
      coalesce(pm.name, nullif(split_part(ps.specification_key, '/', 1), '')) as driver_module
    from parameter_drafts d
    left join project_parameter_bindings b
      on b.id = d.project_parameter_binding_id
    left join parameter_modules pm
      on pm.id = b.module_id
    left join parameter_specs ps
      on ps.id = b.parameter_spec_id
    left join dts_property_specs dps
      on dps.parameter_spec_id = ps.id
    left join project_parameter_binding_revisions locked_bpr
      on locked_bpr.id = d.binding_revision_id
    where ${where.join("\n      and ")}
    order by d.updated_at desc
    `
      : `
    select
      d.id,
      d.project_id,
      d.project_parameter_value_id,
      d.target_value,
      d.action,
      d.reason,
      d.updated_at,
      d.project_parameter_binding_id,
      d.candidate_config_revision_id,
      coalesce(b.parameter_spec_id, null) as parameter_spec_id,
      coalesce(locked_bpr.raw_value, ppv.current_value) as base_raw_value,
      coalesce(
        dps.property_key,
        nullif(split_part(ps.specification_key, '/', 2), ''),
        ps.specification_key,
        pd.name
      ) as property_name,
      coalesce(
        pm.name,
        nullif(split_part(ps.specification_key, '/', 1), ''),
        pd.module
      ) as driver_module
    from parameter_drafts d
    left join project_parameter_values ppv
      on ppv.id = d.project_parameter_value_id
    left join parameter_definitions pd
      on pd.id = ppv.parameter_definition_id
    left join project_parameter_bindings b
      on b.id = d.project_parameter_binding_id
    left join parameter_modules pm
      on pm.id = b.module_id
    left join parameter_specs ps
      on ps.id = b.parameter_spec_id
    left join dts_property_specs dps
      on dps.parameter_spec_id = ps.id
    left join project_parameter_binding_revisions locked_bpr
      on locked_bpr.id = d.binding_revision_id
    where ${where.join("\n      and ")}
    order by d.updated_at desc
    `,
    values
  );

  return result.rows.map(toDraftDto);
}

export async function listDraftsForParameterValue(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  const semantic = parameterIdentityMode() === "semantic";
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
    editSubjectKind: "binding" | "node-enablement";
    logicalNodeId: string | null;
    updatedAt: string;
  }>
> {
  const result = await db.query<{
    id: string;
    candidate_config_revision_id: string | null;
    project_parameter_binding_id: string | null;
    edit_subject_kind: string;
    logical_node_id: string | null;
    updated_at: Date | string;
  }>(
    `
    select id, candidate_config_revision_id, project_parameter_binding_id,
           edit_subject_kind, logical_node_id, updated_at
    from parameter_drafts
    where organization_id = $1
      and project_id = $2
      and user_id = $3
    order by updated_at desc, id asc
    `,
    [input.organizationId, input.projectId, input.userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    candidateConfigRevisionId: row.candidate_config_revision_id,
    projectParameterBindingId: row.project_parameter_binding_id,
    editSubjectKind:
      row.edit_subject_kind === "node-enablement" ? "node-enablement" : "binding",
    logicalNodeId: row.logical_node_id,
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

/**
 * Upsert an open node-enablement draft for (project, logical node, user).
 * Uses select-then-update/insert so binding drafts' partial unique index is untouched.
 */
export async function upsertEnablementDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    logicalNodeId: string;
    userId: string;
    targetValue: string;
    action?: ParameterChangeAction;
    reason: string;
    origin?: "manual" | "file_sync";
    originFileVersionId?: string;
    writeLock?: {
      baseConfigRevisionId?: string;
      propertyOccurrenceId?: string | null;
      sourceFileVersionId?: string;
      expectedChecksum?: string;
      occurrenceSpan?: { start: number; end: number } | null;
    };
    candidateConfigRevisionId?: string;
  },
): Promise<{ id: string; projectId: string; targetValue: string; action: ParameterChangeAction; reason: string; updatedAt: string }> {
  const existing = await db.query<{ id: string }>(
    `
    select id
    from parameter_drafts
    where project_id = $1
      and user_id = $2
      and logical_node_id = $3
      and edit_subject_kind = 'node-enablement'
    limit 1
    `,
    [input.projectId, input.userId, input.logicalNodeId],
  );

  const draftId = existing.rows[0]?.id ?? input.id;
  const occurrenceSpanJson = input.writeLock?.occurrenceSpan
    ? JSON.stringify(input.writeLock.occurrenceSpan)
    : null;

  if (existing.rows[0]) {
    const updated = await db.query<{
      id: string;
      project_id: string;
      target_value: string;
      action: ParameterChangeAction;
      reason: string;
      updated_at: Date | string;
    }>(
      `
      update parameter_drafts
      set target_value = $2,
          reason = $3,
          origin = $4,
          origin_file_version_id = $5,
          action = $6,
          project_parameter_binding_id = null,
          base_config_revision_id = coalesce($7, base_config_revision_id),
          binding_revision_id = null,
          property_occurrence_id = coalesce($8, property_occurrence_id),
          source_file_version_id = coalesce($9, source_file_version_id),
          expected_checksum = coalesce($10, expected_checksum),
          occurrence_span = coalesce($11::jsonb, occurrence_span),
          candidate_config_revision_id = coalesce($12, candidate_config_revision_id),
          updated_at = now()
      where id = $1
      returning id, project_id, target_value, action, reason, updated_at
      `,
      [
        draftId,
        input.targetValue,
        input.reason,
        input.origin ?? "manual",
        input.originFileVersionId ?? null,
        input.action ?? "set",
        input.writeLock?.baseConfigRevisionId ?? null,
        input.writeLock?.propertyOccurrenceId ?? null,
        input.writeLock?.sourceFileVersionId ?? null,
        input.writeLock?.expectedChecksum ?? null,
        occurrenceSpanJson,
        input.candidateConfigRevisionId ?? null,
      ],
    );
    const row = updated.rows[0]!;
    return {
      id: row.id,
      projectId: row.project_id,
      targetValue: row.target_value,
      action: row.action,
      reason: row.reason,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
    };
  }

  const inserted = await db.query<{
    id: string;
    project_id: string;
    target_value: string;
    action: ParameterChangeAction;
    reason: string;
    updated_at: Date | string;
  }>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, user_id,
      target_value, reason, origin, origin_file_version_id,
      action, edit_subject_kind, logical_node_id, project_parameter_binding_id,
      base_config_revision_id, binding_revision_id, property_occurrence_id,
      source_file_version_id, expected_checksum, occurrence_span,
      candidate_config_revision_id
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, 'node-enablement', $10, null,
      $11, null, $12, $13, $14, $15::jsonb, $16
    )
    returning id, project_id, target_value, action, reason, updated_at
    `,
    [
      draftId,
      input.organizationId,
      input.projectId,
      input.userId,
      input.targetValue,
      input.reason,
      input.origin ?? "manual",
      input.originFileVersionId ?? null,
      input.action ?? "set",
      input.logicalNodeId,
      input.writeLock?.baseConfigRevisionId ?? null,
      input.writeLock?.propertyOccurrenceId ?? null,
      input.writeLock?.sourceFileVersionId ?? null,
      input.writeLock?.expectedChecksum ?? null,
      occurrenceSpanJson,
      input.candidateConfigRevisionId ?? null,
    ],
  );
  const row = inserted.rows[0]!;
  return {
    id: row.id,
    projectId: row.project_id,
    targetValue: row.target_value,
    action: row.action,
    reason: row.reason,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
  };
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
  if (parameterIdentityMode() === "semantic") {
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
      action, project_parameter_binding_id, candidate_config_revision_id,
      base_config_revision_id, binding_revision_id, property_occurrence_id,
      source_file_version_id, expected_checksum, occurrence_span
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18::jsonb
    )
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
      base_config_revision_id = coalesce(
        excluded.base_config_revision_id,
        parameter_drafts.base_config_revision_id
      ),
      binding_revision_id = coalesce(
        excluded.binding_revision_id,
        parameter_drafts.binding_revision_id
      ),
      property_occurrence_id = coalesce(
        excluded.property_occurrence_id,
        parameter_drafts.property_occurrence_id
      ),
      source_file_version_id = coalesce(
        excluded.source_file_version_id,
        parameter_drafts.source_file_version_id
      ),
      expected_checksum = coalesce(
        excluded.expected_checksum,
        parameter_drafts.expected_checksum
      ),
      occurrence_span = coalesce(
        excluded.occurrence_span,
        parameter_drafts.occurrence_span
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
      input.candidateConfigRevisionId ?? null,
      input.writeLock?.baseConfigRevisionId ?? null,
      input.writeLock?.bindingRevisionId ?? null,
      input.writeLock?.propertyOccurrenceId ?? null,
      input.writeLock?.sourceFileVersionId ?? null,
      input.writeLock?.expectedChecksum ?? null,
      input.writeLock?.occurrenceSpan ? JSON.stringify(input.writeLock.occurrenceSpan) : null
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
  if (parameterIdentityMode() === "semantic") {
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
  if (parameterIdentityMode() === "semantic") {
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

/**
 * Enrichment for file↔UI sync conflicts.
 * Prefer post-cutover binding/spec joins; fall back to legacy PPV/definition columns
 * so pre-cutover conflict rows still surface baseValue and parameterName.
 */
const FILE_SYNC_CONFLICT_SELECT = `
    select
      c.*,
      coalesce(c.project_parameter_binding_id, '') as project_parameter_value_id,
      coalesce(c.parameter_spec_id, b.parameter_spec_id, '') as parameter_definition_id,
      coalesce(bpr.raw_value, ppv.current_value, '') as base_value,
      case
        when lnr.node_locator is null then coalesce(dps.property_key, pd.name)
        when lnr.node_locator like '/%'
          then ltrim(lnr.node_locator, '/') || '/' || coalesce(dps.property_key, pd.name)
        else lnr.node_locator || '/' || coalesce(dps.property_key, pd.name)
      end as source_node_path,
      coalesce(
        dps.property_key,
        nullif(split_part(ps.specification_key, '/', 2), ''),
        ps.specification_key,
        pd.name
      ) as parameter_name,
      coalesce(
        nullif(trim(binding_pm.name), ''),
        nullif(split_part(ps.specification_key, '/', 1), ''),
        pd.module,
        ''
      ) as parameter_module,
      fv.version_number as file_version_number,
      fv.created_at as file_version_created_at,
      fd.updated_at as file_draft_updated_at,
      ud.updated_at as ui_draft_updated_at,
      pf.id as file_id,
      pf.file_name as file_name,
      pf.config_set_id as config_set_id,
      src.source_start_offset,
      src.source_end_offset,
      src.source_start_line,
      src.source_start_column,
      src.source_end_line,
      src.source_end_column
    from parameter_file_sync_conflicts c
    left join project_parameter_bindings b
      on b.id = coalesce(c.project_parameter_binding_id, c.project_parameter_value_id)
    left join project_parameter_values ppv on ppv.id = c.project_parameter_value_id
    left join parameter_definitions pd on pd.id = c.parameter_definition_id
    left join parameter_specs ps on ps.id = coalesce(c.parameter_spec_id, b.parameter_spec_id)
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join parameter_modules binding_pm on binding_pm.id = b.module_id
    left join lateral (
      select bpr.raw_value
      from project_parameter_binding_revisions bpr
      where bpr.binding_id = b.id
      order by bpr.created_at desc
      limit 1
    ) bpr on true
    left join lateral (
      select lnr.node_locator
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = b.logical_node_id
      order by lnr.config_revision_id desc
      limit 1
    ) lnr on true
    left join project_parameter_file_versions fv on fv.id = c.file_version_id
    left join project_parameter_files pf on pf.id = fv.file_id
    left join parameter_drafts fd on fd.id = c.file_draft_id
    left join parameter_drafts ud on ud.id = c.ui_draft_id
    left join lateral (
      select
        po.start_offset as source_start_offset,
        po.end_offset as source_end_offset,
        po.start_line as source_start_line,
        po.start_column as source_start_column,
        po.end_line as source_end_line,
        po.end_column as source_end_column
      from dts_property_occurrences po
      inner join dts_occurrence_effects oe
        on oe.property_occurrence_id = po.id
      inner join dts_logical_node_revisions occ_lnr
        on occ_lnr.id = oe.logical_node_revision_id
      where po.file_version_id = c.file_version_id
        and occ_lnr.logical_node_id = b.logical_node_id
        and (
          oe.property_name = dps.property_key
          or (dps.property_key is null and oe.property_name is not null)
        )
      order by oe.source_order desc
      limit 1
    ) src on true
`;

export async function listOpenConflicts(
  db: Queryable,
  query: { organizationId: string; projectParameterValueId?: string; projectId?: string; conflictId?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["c.organization_id = $1", "c.status = 'open'"];
  if (query.projectParameterValueId) {
    // Callers still pass the binding id under the legacy parameter name after cutover.
    addCondition(
      where,
      values,
      (placeholder) => `c.project_parameter_binding_id = ${placeholder}`,
      query.projectParameterValueId
    );
  }
  if (query.projectId) {
    addCondition(where, values, (placeholder) => `c.project_id = ${placeholder}`, query.projectId);
  }
  if (query.conflictId) {
    addCondition(where, values, (placeholder) => `c.id = ${placeholder}`, query.conflictId);
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    ${FILE_SYNC_CONFLICT_SELECT}
    where ${where.join("\n      and ")}
    order by c.created_at desc, c.id desc
    `,
    values
  );

  return result.rows.map(toFileSyncConflictRecord);
}

/**
 * Lookup conflicts by id without requiring open status (used for bulk ineligibility reasons).
 * Enrichment joins are included so ineligible rows can still surface names/file ids when present.
 */
export async function listFileSyncConflictsByIds(
  db: Queryable,
  query: { organizationId: string; conflictIds: string[] }
) {
  if (query.conflictIds.length === 0) {
    return [];
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    ${FILE_SYNC_CONFLICT_SELECT}
    where c.organization_id = $1
      and c.id = any($2::text[])
    `,
    [query.organizationId, query.conflictIds]
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

export async function getProjectParameterForUpdate(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  if (parameterIdentityMode() === "semantic") {
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
