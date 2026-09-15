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
  submitter_user_id: string;
  assigned_to_user_id: string | null;
  reviewer_user_id: string | null;
  reviewer_note: string | null;
  applied_value_id: string | null;
  apply_outcome: CanonicalChangeApplyOutcome | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

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
  }
): Promise<CanonicalValueChangeRequestRow> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    insert into project_parameter_value_change_requests (
      id, organization_id, project_id, draft_id, binding_id, definition_id,
      definition_revision_id, catalog_release_id, base_current_value_id,
      config_revision_id, source_ref, action, target_value, reason, status,
      submitter_user_id, assigned_to_user_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, 'pending', $15, $16)
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
      input.assignedToUserId
    ]
  );
  return result.rows[0]!;
}

export async function getCanonicalValueChangeRequest(
  db: Queryable,
  input: { organizationId: string; projectId: string; requestId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select *
      from project_parameter_value_change_requests
     where organization_id = $1
       and project_id = $2
       and id = $3
     limit 1
    `,
    [input.organizationId, input.projectId, input.requestId]
  );
  return result.rows[0] ?? null;
}

/** Serializes concurrent reviews of the same request. */
export async function getCanonicalValueChangeRequestForUpdate(
  db: Queryable,
  input: { organizationId: string; projectId: string; requestId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select *
      from project_parameter_value_change_requests
     where organization_id = $1
       and project_id = $2
       and id = $3
     for update
    `,
    [input.organizationId, input.projectId, input.requestId]
  );
  return result.rows[0] ?? null;
}

export async function getOpenCanonicalValueChangeRequestForDraft(
  db: Queryable,
  input: { organizationId: string; projectId: string; draftId: string }
): Promise<CanonicalValueChangeRequestRow | null> {
  const result = await db.query<CanonicalValueChangeRequestRow>(
    `
    select *
      from project_parameter_value_change_requests
     where organization_id = $1
       and project_id = $2
       and draft_id = $3
       and status = 'pending'
     limit 1
    `,
    [input.organizationId, input.projectId, input.draftId]
  );
  return result.rows[0] ?? null;
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
    select *
      from project_parameter_value_change_requests
     where organization_id = $1
       and project_id = $2
       and ($3::text is null or status = $3)
     order by updated_at desc, id
    `,
    [input.organizationId, input.projectId, input.status ?? null]
  );
  return result.rows;
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
  return result.rows[0] ?? null;
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
      input.applyOutcome
    ]
  );
  return result.rows[0] ?? null;
}
