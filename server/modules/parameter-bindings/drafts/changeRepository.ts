/**
 * Canonical value change requests (Issue #849 C4).
 *
 * Pending → reviewed → applied workflow rows for canonical pending drafts.
 * Every reference is a genuine canonical identity plus the frozen base pins.
 */
import { randomUUID } from "node:crypto";

import type { Queryable } from "../../../shared/database/client";

export type CanonicalChangeRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type CanonicalChangeApplyOutcome = "committed" | "replayed";

export type CanonicalValueChangeRequestRow = {
  id: string;
  request_kind: "single" | "batch";
  organization_id: string;
  project_id: string;
  draft_id: string | null;
  binding_id: string;
  definition_id: string;
  definition_revision_id: string;
  catalog_release_id: string;
  base_current_value_id: string;
  config_revision_id: string;
  source_ref: string;
  action: "set" | "delete";
  target_value: unknown;
  reason: string;
  status: CanonicalChangeRequestStatus;
  submitter_user_id: string | null;
  assigned_to_user_id: string | null;
  reviewer_user_id: string | null;
  reviewer_note: string | null;
  applied_value_id: string | null;
  apply_outcome: CanonicalChangeApplyOutcome | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  source_pin_id: string | null;
  candidate_id: string | null;
  candidate_base_digest: string | null;
  candidate_proposed_digest: string | null;
  candidate_diff_digest: string | null;
  candidate_member_manifest: unknown[] | null;
  candidate_binding_manifest: unknown[] | null;
  applied_history_event_id: string | null;
  applied_audit_ref: string | null;
  applied_file_version_ids: unknown[] | null;
  applied_source_result: Record<string, unknown> | null;
  source_format: "dts" | "json" | null;
  applied_value_state: "present" | "deleted" | null;
};

async function hydrateRequest(db: Queryable, row: CanonicalValueChangeRequestRow): Promise<CanonicalValueChangeRequestRow> {
  if (row.source_format) return row;
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `select request.*, pin.format as source_format, applied.value_state as applied_value_state
       from project_parameter_value_change_requests request
       left join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
       left join parameter_catalog.project_parameter_values applied on applied.id=request.applied_value_id
      where request.organization_id=$1 and request.project_id=$2 and request.id=$3`,
    [row.organization_id, row.project_id, row.id]);
  return result.rows[0] ?? row;
}

export async function insertCanonicalValueChangeRequest(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    draftId: string;
    bindingId: string;
    definitionId: string;
    definitionRevisionId: string;
    catalogReleaseId: string;
    baseCurrentValueId: string;
    configRevisionId: string;
    sourceRef: string;
    action: "set" | "delete";
    targetValue: unknown;
    reason: string;
    submitterUserId: string;
    assignedToUserId: string | null;
    sourcePinId: string;
    candidateId: string;
    candidateBaseDigest: string;
    candidateProposedDigest: string;
    candidateDiffDigest: string;
    candidateMemberManifest: unknown[];
    candidateBindingManifest: unknown[];
  }
): Promise<CanonicalValueChangeRequestRow> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    insert into project_parameter_value_change_requests (
      id, organization_id, project_id, draft_id, binding_id, definition_id,
      definition_revision_id, catalog_release_id, base_current_value_id,
      config_revision_id, source_ref, action, target_value, reason, status,
      submitter_user_id, assigned_to_user_id, source_pin_id, candidate_id,
      candidate_base_digest, candidate_proposed_digest, candidate_diff_digest,
      candidate_member_manifest, candidate_binding_manifest
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14,
      'pending', $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb)
    returning *
    `,
    [
      `pvcr_${randomUUID()}`,
      input.organizationId,
      input.projectId,
      input.draftId,
      input.bindingId,
      input.definitionId,
      input.definitionRevisionId,
      input.catalogReleaseId,
      input.baseCurrentValueId,
      input.configRevisionId,
      input.sourceRef,
      input.action,
      JSON.stringify(input.targetValue),
      input.reason,
      input.submitterUserId,
      input.assignedToUserId,
      input.sourcePinId,
      input.candidateId,
      input.candidateBaseDigest,
      input.candidateProposedDigest,
      input.candidateDiffDigest,
      JSON.stringify(input.candidateMemberManifest),
      JSON.stringify(input.candidateBindingManifest)
    ]
  );
  return hydrateRequest(db, result.rows[0]!);
}

export async function getCanonicalValueChangeRequest(
  db: Queryable,
  input: { organizationId: string; projectId: string; requestId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select request.*, pin.format as source_format, applied.value_state as applied_value_state
      from project_parameter_value_change_requests request
      left join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
      left join parameter_catalog.project_parameter_values applied on applied.id=request.applied_value_id
     where request.organization_id = $1
       and request.project_id = $2
       and request.id = $3
       and request.request_kind = 'single'
     limit 1
    `,
    [input.organizationId, input.projectId, input.requestId]
  );
  return result.rows[0] ? hydrateRequest(db, result.rows[0]) : null;
}

/** Serializes concurrent reviews of the same request. */
export async function getCanonicalValueChangeRequestForUpdate(
  db: Queryable,
  input: { organizationId: string; projectId: string; requestId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select request.*, pin.format as source_format, applied.value_state as applied_value_state
      from project_parameter_value_change_requests request
      left join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
      left join parameter_catalog.project_parameter_values applied on applied.id=request.applied_value_id
     where request.organization_id = $1
       and request.project_id = $2
       and request.id = $3
       and request.request_kind = 'single'
     for update of request
    `,
    [input.organizationId, input.projectId, input.requestId]
  );
  return result.rows[0] ? hydrateRequest(db, result.rows[0]) : null;
}

export async function getOpenCanonicalValueChangeRequestForDraft(
  db: Queryable,
  input: { organizationId: string; projectId: string; draftId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select request.*, pin.format as source_format, applied.value_state as applied_value_state
      from project_parameter_value_change_requests request
      left join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
      left join parameter_catalog.project_parameter_values applied on applied.id=request.applied_value_id
     where request.organization_id = $1
       and request.project_id = $2
       and request.draft_id = $3
       and request.status = 'pending'
     limit 1
    `,
    [input.organizationId, input.projectId, input.draftId]
  );
  return result.rows[0] ? hydrateRequest(db, result.rows[0]) : null;
}

export async function listCanonicalValueChangeRequests(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    status?: CanonicalChangeRequestStatus;
  }
): Promise<CanonicalValueChangeRequestRow[]> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select request.*, pin.format as source_format, applied.value_state as applied_value_state
      from project_parameter_value_change_requests request
      left join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
      left join parameter_catalog.project_parameter_values applied on applied.id=request.applied_value_id
     where request.organization_id = $1
       and request.project_id = $2
       and ($3::text is null or request.status = $3)
       and request.request_kind = 'single'
     order by updated_at desc, id
    `,
    [input.organizationId, input.projectId, input.status ?? null]
  );
  return Promise.all(result.rows.map((row) => hydrateRequest(db, row)));
}

export async function markCanonicalValueChangeRequestReviewed(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    requestId: string;
    status: Extract<CanonicalChangeRequestStatus, "rejected" | "withdrawn">;
    actorUserId: string;
    note: string | null;
  }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    update project_parameter_value_change_requests
       set status = $4,
           reviewer_user_id = $5,
           reviewer_note = $6,
           updated_at = now()
     where organization_id = $1
       and project_id = $2
       and id = $3
       and status = 'pending'
    returning *
    `,
    [input.organizationId, input.projectId, input.requestId, input.status, input.actorUserId, input.note]
  );
  return result.rows[0] ? hydrateRequest(db, result.rows[0]) : null;
}

export async function markCanonicalValueChangeRequestApplied(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    requestId: string;
    reviewerUserId: string;
    reviewerNote: string | null;
    appliedValueId: string;
    applyOutcome: CanonicalChangeApplyOutcome;
    appliedHistoryEventId?: string;
    appliedAuditRef?: string;
    appliedFileVersionIds?: unknown[];
    appliedSourceResult?: Record<string, unknown>;
  }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    update project_parameter_value_change_requests
       set status = 'approved',
           reviewer_user_id = $4,
           reviewer_note = $5,
           applied_value_id = $6,
           apply_outcome = $7,
           applied_at = now(),
           applied_history_event_id = $8,
           applied_audit_ref = $9,
           applied_file_version_ids = $10::jsonb,
           applied_source_result = $11::jsonb,
           updated_at = now()
     where organization_id = $1
       and project_id = $2
       and id = $3
       and status = 'pending'
    returning *
    `,
    [
      input.organizationId,
      input.projectId,
      input.requestId,
      input.reviewerUserId,
      input.reviewerNote,
      input.appliedValueId,
      input.applyOutcome,
      input.appliedHistoryEventId ?? null,
      input.appliedAuditRef ?? null,
      input.appliedFileVersionIds ? JSON.stringify(input.appliedFileVersionIds) : null,
      input.appliedSourceResult ? JSON.stringify(input.appliedSourceResult) : null
    ]
  );
  return result.rows[0] ? hydrateRequest(db, result.rows[0]) : null;
}
