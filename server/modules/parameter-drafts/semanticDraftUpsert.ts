/**
 * Post-cutover binding-draft upsert against semantic bindings.
 * Must not query renamed flat-identity archive tables.
 */
import type { Queryable } from "../../shared/database/client";
import type { TrustedInvocationDomainAttribution } from "../auth/trustedInvocation";

export async function upsertSemanticDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    bindingId: string;
    userId: string | null;
    attribution?: TrustedInvocationDomainAttribution;
    targetValue: string;
    action?: "set" | "delete";
    reason: string;
    origin?: "manual" | "file_sync";
    originFileVersionId?: string;
    baseConfigRevisionId?: string;
    bindingRevisionId?: string;
    propertyOccurrenceId?: string | null;
    sourceFileVersionId?: string;
    expectedChecksum?: string;
    occurrenceSpan?: { start: number; end: number } | null;
    candidateConfigRevisionId?: string;
  }
) {
  const userId = input.attribution ? input.attribution.userId : input.userId;
  const result = await db.query<{
    id: string;
    project_id: string;
    project_parameter_binding_id: string;
    target_value: string;
    action: "set" | "delete";
    reason: string;
    updated_at: string | Date;
  }>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, user_id,
      target_value, reason, origin, origin_file_version_id,
      action,
      edit_subject_kind,
      project_parameter_binding_id,
      base_config_revision_id, binding_revision_id, property_occurrence_id,
      source_file_version_id, expected_checksum, occurrence_span,
      candidate_config_revision_id,
      initiator_type, initiator_system_kind, initiator_system_name,
      initiator_session_id, initiator_tool_call_id, initiator_approval_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'binding', $10, $11, $12, $13, $14, $15, $16::jsonb, $17,
            $18, $19, $20, $21, $22, $23)
    on conflict (
      project_id,
      project_parameter_binding_id,
      initiator_type,
      coalesce(user_id, ''),
      coalesce(initiator_system_kind, ''),
      coalesce(initiator_system_name, '')
    ) where edit_subject_kind = 'binding' and project_parameter_binding_id is not null
    do update set
      target_value = excluded.target_value,
      reason = excluded.reason,
      origin = excluded.origin,
      origin_file_version_id = excluded.origin_file_version_id,
      action = excluded.action,
      base_config_revision_id = coalesce(excluded.base_config_revision_id, parameter_drafts.base_config_revision_id),
      binding_revision_id = coalesce(excluded.binding_revision_id, parameter_drafts.binding_revision_id),
      property_occurrence_id = coalesce(excluded.property_occurrence_id, parameter_drafts.property_occurrence_id),
      source_file_version_id = coalesce(excluded.source_file_version_id, parameter_drafts.source_file_version_id),
      expected_checksum = coalesce(excluded.expected_checksum, parameter_drafts.expected_checksum),
      occurrence_span = coalesce(excluded.occurrence_span, parameter_drafts.occurrence_span),
      candidate_config_revision_id = coalesce(
        excluded.candidate_config_revision_id,
        parameter_drafts.candidate_config_revision_id
      ),
      initiator_type = excluded.initiator_type,
      initiator_system_kind = excluded.initiator_system_kind,
      initiator_system_name = excluded.initiator_system_name,
      initiator_session_id = excluded.initiator_session_id,
      initiator_tool_call_id = excluded.initiator_tool_call_id,
      initiator_approval_id = excluded.initiator_approval_id,
      updated_at = now()
    returning id, project_id, project_parameter_binding_id, target_value, action, reason, updated_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      userId,
      input.targetValue,
      input.reason,
      input.origin ?? "manual",
      input.originFileVersionId ?? null,
      input.action ?? "set",
      input.bindingId,
      input.baseConfigRevisionId ?? null,
      input.bindingRevisionId ?? null,
      input.propertyOccurrenceId ?? null,
      input.sourceFileVersionId ?? null,
      input.expectedChecksum ?? null,
      input.occurrenceSpan ? JSON.stringify(input.occurrenceSpan) : null,
      input.candidateConfigRevisionId ?? null,
      input.attribution?.initiatorType ?? "user",
      input.attribution?.systemKind ?? null,
      input.attribution?.systemName ?? null,
      input.attribution?.sessionId ?? null,
      input.attribution?.toolCallId ?? null,
      input.attribution?.approvalId ?? null,
    ]
  );
  return result.rows[0] ?? null;
}
