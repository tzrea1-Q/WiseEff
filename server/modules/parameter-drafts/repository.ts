/**
 * Draft-lifecycle repository for `parameter_drafts`: write-lock row mapping,
 * draft-for-submission readers, change-request write-lock getters, and the
 * upsert/list/rebase/delete surface for binding and node-enablement drafts.
 */

import type { Queryable } from "../../shared/database/client";
import type { TrustedInvocationDomainAttribution } from "../auth/trustedInvocation";
import type { BindingWriteLockFields, EnablementWriteLockFields, ParameterChangeAction, ParameterDraftDto } from "./types";
import { upsertSemanticDraft } from "./semanticDraftUpsert";
// Identity mode lives in the parameter kernel (ADR-0029); this is the
// module's only import outside shared/.
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { addCondition, dateTimeToIso } from "../../shared/database/sqlUtil";
import { ApiError } from "../../shared/http/errors";

/**
 * Stable owner key for a draft working tip.  The principal user identifies
 * who is accountable for User/Agent executions; initiator type and explicit
 * System identity keep those executions from sharing a user-owned draft.
 */
export type ParameterDraftOwner = Pick<
  TrustedInvocationDomainAttribution,
  "userId" | "initiatorType" | "systemKind" | "systemName"
>;

type DraftOwnerInput = { owner: ParameterDraftOwner } | { userId: string };

function normalizeDraftOwner(input: DraftOwnerInput): ParameterDraftOwner {
  if ("owner" in input) return input.owner;
  return {
    userId: input.userId,
    initiatorType: "user",
    systemKind: null,
    systemName: null,
  };
}

function draftOwnerWhere(alias: string, firstPlaceholder: number) {
  return [
    `${alias}.initiator_type = $${firstPlaceholder}`,
    `${alias}.user_id is not distinct from $${firstPlaceholder + 1}`,
    `${alias}.initiator_system_kind is not distinct from $${firstPlaceholder + 2}`,
    `${alias}.initiator_system_name is not distinct from $${firstPlaceholder + 3}`,
  ];
}

function draftOwnerValues(owner: ParameterDraftOwner): unknown[] {
  return [owner.initiatorType, owner.userId, owner.systemKind, owner.systemName];
}

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
  } & DraftOwnerInput
): Promise<BindingWriteLockFields | null> {
  const owner = normalizeDraftOwner(input);
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
      and ${draftOwnerWhere("parameter_drafts", 4).join("\n      and ")}
    limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId, ...draftOwnerValues(owner)]
  );
  const row = result.rows[0];
  return row ? toWriteLockFields(row) : null;
}

export type BindingDraftForSubmission = {
  id: string;
  projectId: string;
  bindingId: string;
  logicalNodeId: string | null;
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
    draftId: string;
  } & DraftOwnerInput
): Promise<BindingDraftForSubmission | null> {
  const owner = normalizeDraftOwner(input);
  const result = await db.query<
    ParameterWriteLockRow & {
      id: string;
      project_id: string;
      project_parameter_binding_id: string;
      binding_logical_node_id: string | null;
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
        and ${draftOwnerWhere("d", 3).join("\n        and ")}
        and d.id = $7
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
      d.binding_logical_node_id,
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
    [input.organizationId, input.projectId, ...draftOwnerValues(owner), input.draftId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    bindingId: row.project_parameter_binding_id,
    logicalNodeId: row.binding_logical_node_id,
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
    draftId: string;
  } & DraftOwnerInput
): Promise<EnablementDraftForSubmission | null> {
  const owner = normalizeDraftOwner(input);
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
        and ${draftOwnerWhere("d", 3).join("\n        and ")}
        and d.id = $7
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
    [input.organizationId, input.projectId, ...draftOwnerValues(owner), input.draftId]
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

type DraftRow = {
  id: string;
  project_id: string;
  project_parameter_value_id: string | null;
  user_id?: string | null;
  target_value: string;
  action?: ParameterChangeAction;
  reason: string;
  origin?: "manual" | "file_sync";
  origin_file_version_id?: string | null;
  updated_at: string | Date;
  project_parameter_binding_id?: string | null;
  edit_subject_kind?: "binding" | "node-enablement" | null;
  logical_node_id?: string | null;
  candidate_config_revision_id?: string | null;
  parameter_spec_id?: string | null;
  base_raw_value?: string | null;
  property_name?: string | null;
  driver_module?: string | null;
  initiator_type?: "user" | "agent" | "system";
  initiator_system_kind?: "service" | "job" | null;
  initiator_system_name?: string | null;
  initiator_session_id?: string | null;
  initiator_tool_call_id?: string | null;
  initiator_approval_id?: string | null;
};

export type ParameterDraftWithOrigin = {
  id: string;
  /** Accountable user principal; System drafts deliberately have no user. */
  userId: string | null;
  projectId: string;
  projectParameterValueId: string;
  targetValue: string;
  action: ParameterChangeAction;
  origin: "manual" | "file_sync";
  originFileVersionId?: string;
  updatedAt: string;
  initiatorType?: "user" | "agent" | "system";
  initiatorSystemKind?: "service" | "job";
  initiatorSystemName?: string;
  initiatorSessionId?: string;
  initiatorToolCallId?: string;
  initiatorApprovalId?: string;
};

function toDraftDto(row: DraftRow): ParameterDraftDto {
  const bindingId = row.project_parameter_binding_id ?? undefined;
  // Post-cutover: parameterId DTO field carries the semantic binding id.
  const parameterId = bindingId || row.project_parameter_value_id?.trim() || row.logical_node_id;
  if (!parameterId) {
    throw new ApiError("CONFLICT", "Parameter draft has no persisted parameter identity.", {
      draftId: row.id,
    });
  }
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
    ...(row.edit_subject_kind && row.edit_subject_kind !== "binding"
      ? { editSubjectKind: row.edit_subject_kind }
      : {}),
    ...(row.logical_node_id ? { logicalNodeId: row.logical_node_id } : {}),
    ...(bindingId ? { projectParameterBindingId: bindingId } : {}),
    ...(candidateConfigRevisionId ? { candidateConfigRevisionId } : {}),
    ...(parameterSpecId ? { parameterSpecId } : {}),
    ...(name ? { name } : {}),
    ...(module ? { module } : {}),
    ...(currentValue !== undefined && currentValue !== null ? { currentValue } : {}),
    ...(row.initiator_type && row.initiator_type !== "user"
      ? {
          initiatorType: row.initiator_type,
          initiatorSystemKind: row.initiator_system_kind ?? undefined,
          initiatorSystemName: row.initiator_system_name ?? undefined,
          initiatorSessionId: row.initiator_session_id ?? undefined,
          initiatorToolCallId: row.initiator_tool_call_id ?? undefined,
          initiatorApprovalId: row.initiator_approval_id ?? undefined,
        }
      : {})
  };
}

function toDraftWithOrigin(row: DraftRow): ParameterDraftWithOrigin {
  if (!row.project_parameter_value_id) {
    throw new ApiError("CONFLICT", "Parameter draft has no persisted parameter identity.", {
      draftId: row.id,
    });
  }
  return {
    id: row.id,
    userId: row.user_id ?? null,
    projectId: row.project_id,
    projectParameterValueId: row.project_parameter_value_id,
    targetValue: row.target_value,
    action: row.action ?? "set",
    origin: row.origin ?? "manual",
    originFileVersionId: row.origin_file_version_id ?? undefined,
    updatedAt: dateTimeToIso(row.updated_at),
    ...(row.initiator_type && row.initiator_type !== "user"
      ? {
          initiatorType: row.initiator_type,
          initiatorSystemKind: row.initiator_system_kind ?? undefined,
          initiatorSystemName: row.initiator_system_name ?? undefined,
          initiatorSessionId: row.initiator_session_id ?? undefined,
          initiatorToolCallId: row.initiator_tool_call_id ?? undefined,
          initiatorApprovalId: row.initiator_approval_id ?? undefined,
        }
      : {})
  };
}

export async function listDraftsForUser(
  db: Queryable,
  query: { organizationId: string; projectId?: string } & DraftOwnerInput
) {
  const owner = normalizeDraftOwner(query);
  const values: unknown[] = [query.organizationId, ...draftOwnerValues(owner)];
  const where = ["d.organization_id = $1", ...draftOwnerWhere("d", 2)];

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
      d.user_id,
      coalesce(d.project_parameter_binding_id, '') as project_parameter_value_id,
      d.target_value,
      d.action,
      d.reason,
      d.updated_at,
      d.project_parameter_binding_id,
      d.edit_subject_kind,
      d.logical_node_id,
      d.candidate_config_revision_id,
      d.initiator_type,
      d.initiator_system_kind,
      d.initiator_system_name,
      d.initiator_session_id,
      d.initiator_tool_call_id,
      d.initiator_approval_id,
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
      d.user_id,
      d.project_parameter_value_id,
      d.target_value,
      d.action,
      d.reason,
      d.updated_at,
      d.project_parameter_binding_id,
      d.edit_subject_kind,
      d.logical_node_id,
      d.candidate_config_revision_id,
      d.initiator_type,
      d.initiator_system_kind,
      d.initiator_system_name,
      d.initiator_session_id,
      d.initiator_tool_call_id,
      d.initiator_approval_id,
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
      initiator_type,
      initiator_system_kind,
      initiator_system_name,
      initiator_session_id,
      initiator_tool_call_id,
      initiator_approval_id,
      project_parameter_binding_id
    from parameter_drafts
    where project_parameter_binding_id = $1
    order by updated_at desc, id asc
    `
      : `
    select id, user_id, project_id, project_parameter_value_id, target_value, action, origin, origin_file_version_id, updated_at,
           project_parameter_binding_id, initiator_type, initiator_system_kind, initiator_system_name,
           initiator_session_id, initiator_tool_call_id, initiator_approval_id
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
  input: { organizationId: string; projectId: string } & DraftOwnerInput,
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
  const owner = normalizeDraftOwner(input);
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
      and ${draftOwnerWhere("parameter_drafts", 3).join("\n      and ")}
    order by updated_at desc, id asc
    `,
    [input.organizationId, input.projectId, ...draftOwnerValues(owner)],
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
    candidateConfigRevisionId: string;
    excludeDraftId?: string;
  } & DraftOwnerInput,
): Promise<string[]> {
  const owner = normalizeDraftOwner(input);
  const result = await db.query<{ id: string }>(
    `
    update parameter_drafts
    set candidate_config_revision_id = $7,
        updated_at = now()
    where organization_id = $1
      and project_id = $2
      and ${draftOwnerWhere("parameter_drafts", 3).join("\n      and ")}
      and candidate_config_revision_id is distinct from $7
      and ($8::text is null or id <> $8)
    returning id
    `,
    [
      input.organizationId,
      input.projectId,
      ...draftOwnerValues(owner),
      input.candidateConfigRevisionId,
      input.excludeDraftId ?? null,
    ],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Upsert an open node-enablement draft for (project, logical node, trusted owner).
 * Uses select-then-update/insert so binding drafts' partial unique index is untouched.
 */
export async function upsertEnablementDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    logicalNodeId: string;
    userId: string | null;
    attribution?: TrustedInvocationDomainAttribution;
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
  const attribution = input.attribution;
  const userId = attribution ? attribution.userId : input.userId;
  const initiatorType = attribution?.initiatorType ?? "user";
  const systemKind = attribution?.systemKind ?? null;
  const systemName = attribution?.systemName ?? null;
  const existing = await db.query<{ id: string }>(
    `
    select id
    from parameter_drafts
    where organization_id = $1
      and project_id = $2
      and user_id is not distinct from $3
      and logical_node_id = $4
      and edit_subject_kind = 'node-enablement'
      and initiator_type = $5
      and initiator_system_kind is not distinct from $6
      and initiator_system_name is not distinct from $7
    limit 1
    for update
    `,
    [input.organizationId, input.projectId, userId, input.logicalNodeId, initiatorType, systemKind, systemName],
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
          user_id = $13,
          initiator_type = $14,
          initiator_system_kind = $15,
          initiator_system_name = $16,
          initiator_session_id = $17,
          initiator_tool_call_id = $18,
          initiator_approval_id = $19,
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
        userId,
        initiatorType,
        systemKind,
        systemName,
        attribution?.sessionId ?? null,
        attribution?.toolCallId ?? null,
        attribution?.approvalId ?? null,
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
      candidate_config_revision_id,
      initiator_type, initiator_system_kind, initiator_system_name,
      initiator_session_id, initiator_tool_call_id, initiator_approval_id
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, 'node-enablement', $10, null,
      $11, null, $12, $13, $14, $15::jsonb, $16,
      $17, $18, $19, $20, $21, $22
    )
    returning id, project_id, target_value, action, reason, updated_at
    `,
    [
      draftId,
      input.organizationId,
      input.projectId,
      userId,
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
      initiatorType,
      systemKind,
      systemName,
      attribution?.sessionId ?? null,
      attribution?.toolCallId ?? null,
      attribution?.approvalId ?? null,
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
    userId: string | null;
    attribution?: TrustedInvocationDomainAttribution;
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
  const attribution = input.attribution;
  if (parameterIdentityMode() === "semantic") {
    const bindingId = input.projectParameterBindingId ?? input.parameterId;
    const row = await upsertSemanticDraft(db, {
      id: input.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      bindingId,
      userId: attribution ? attribution.userId : input.userId,
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
      attribution,
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
      project_parameter_binding_id: row.project_parameter_binding_id,
      initiator_type: attribution?.initiatorType ?? "user",
      initiator_system_kind: attribution?.systemKind ?? null,
      initiator_system_name: attribution?.systemName ?? null,
      initiator_session_id: attribution?.sessionId ?? null,
      initiator_tool_call_id: attribution?.toolCallId ?? null,
      initiator_approval_id: attribution?.approvalId ?? null
    });
  }

  const result = await db.query<DraftRow>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id,
      target_value, reason, origin, origin_file_version_id,
      action, project_parameter_binding_id, candidate_config_revision_id,
      base_config_revision_id, binding_revision_id, property_occurrence_id,
      source_file_version_id, expected_checksum, occurrence_span,
      initiator_type, initiator_system_kind, initiator_system_name,
      initiator_session_id, initiator_tool_call_id, initiator_approval_id
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23, $24
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
      initiator_type = excluded.initiator_type,
      initiator_system_kind = excluded.initiator_system_kind,
      initiator_system_name = excluded.initiator_system_name,
      initiator_session_id = excluded.initiator_session_id,
      initiator_tool_call_id = excluded.initiator_tool_call_id,
      initiator_approval_id = excluded.initiator_approval_id,
      updated_at = now()
    returning id, project_id, project_parameter_value_id, target_value, action, reason, updated_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.parameterId,
      attribution ? attribution.userId : input.userId,
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
      input.writeLock?.occurrenceSpan ? JSON.stringify(input.writeLock.occurrenceSpan) : null,
      attribution?.initiatorType ?? "user",
      attribution?.systemKind ?? null,
      attribution?.systemName ?? null,
      attribution?.sessionId ?? null,
      attribution?.toolCallId ?? null,
      attribution?.approvalId ?? null
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
  input: { organizationId: string; draftId: string } & DraftOwnerInput
) {
  const owner = normalizeDraftOwner(input);
  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and ${draftOwnerWhere("parameter_drafts", 2).join("\n      and ")}
      and id = $6
    `,
    [input.organizationId, ...draftOwnerValues(owner), input.draftId]
  );
}

export async function deleteDraftForParameter(
  db: Queryable,
  input: { organizationId: string; projectId: string; parameterId: string } & DraftOwnerInput
) {
  const owner = normalizeDraftOwner(input);
  if (parameterIdentityMode() === "semantic") {
    await db.query(
      `
      delete from parameter_drafts
      where organization_id = $1
        and ${draftOwnerWhere("parameter_drafts", 2).join("\n        and ")}
        and project_id = $6
        and project_parameter_binding_id = $7
      `,
      [input.organizationId, ...draftOwnerValues(owner), input.projectId, input.parameterId]
    );
    return;
  }

  await db.query(
    `
      delete from parameter_drafts
      where organization_id = $1
        and ${draftOwnerWhere("parameter_drafts", 2).join("\n        and ")}
        and project_id = $6
        and project_parameter_value_id = $7
      `,
    [input.organizationId, ...draftOwnerValues(owner), input.projectId, input.parameterId]
  );
}
