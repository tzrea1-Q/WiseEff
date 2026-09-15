/**
 * Canonical value change request workflow (Issue #849 C4).
 *
 * submit  → pending work is frozen with its exact canonical and base pins.
 * approve → the single authorized apply unit: pins are re-resolved, drift is
 *           rejected, and the value + source + history + workflow status are
 *           committed through the existing canonical owners inside the caller's
 *           owned PostgreSQL transaction.
 * reject / withdraw → no value is written; pending work stays pending.
 *
 * The canonical value owner already performs protected-reference source writeback
 * and appends the ProjectValue history. This module does not duplicate it.
 */
import { ApiError } from "../../../shared/http/errors";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import {
  canEditParameters,
  canReviewParameters,
  canReviewParameterStage,
  canViewParameters
} from "../../parameter-kernel/policy";
import { getProjectById } from "../../projects/repository";
import { renderDtsValue } from "../../dts/valueAst";
import type { DtsValue } from "../../dts/types";
import {
  asValueClient,
  saveCanonicalProjectValue
} from "../catalogProjectValueSync";
import {
  deleteCanonicalValueDraft,
  getCanonicalValueDraft,
  loadCanonicalBindingPins
} from "./repository";
import {
  getCanonicalValueChangeRequest,
  getCanonicalValueChangeRequestForUpdate,
  getOpenCanonicalValueChangeRequestForDraft,
  insertCanonicalValueChangeRequest,
  listCanonicalValueChangeRequests,
  markCanonicalValueChangeRequestApplied,
  markCanonicalValueChangeRequestReviewed,
  type CanonicalChangeApplyOutcome,
  type CanonicalChangeRequestStatus,
  type CanonicalValueChangeRequestRow
} from "./changeRepository";

/** The review stage whose role contract governs a software-configuration value change. */
const CANONICAL_VALUE_REVIEW_STAGE = "software_review" as const;

export type CanonicalValueChangeRequestDto = {
  id: string;
  projectId: string;
  draftId: string | null;
  bindingId: string;
  definitionId: string;
  effectiveRevisionId: string;
  status: CanonicalChangeRequestStatus;
  targetValue: string;
  reason: string;
  submitterUserId: string | null;
  assignedToUserId: string | null;
  reviewerUserId: string | null;
  reviewerNote: string | null;
  appliedValueId: string | null;
  applyOutcome: CanonicalChangeApplyOutcome | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmitCanonicalValueChangeInput = {
  projectId: string;
  draftId: string;
  assignedToUserId?: string | null;
};

export type ReviewCanonicalValueChangeInput = {
  projectId: string;
  requestId: string;
  decision: "approve" | "reject";
  note?: string | null;
};

function renderTarget(row: CanonicalValueChangeRequestRow): string {
  try {
    return renderDtsValue(row.target_value as DtsValue);
  } catch {
    return JSON.stringify(row.target_value);
  }
}

export function toCanonicalValueChangeRequestDto(
  row: CanonicalValueChangeRequestRow
): CanonicalValueChangeRequestDto {
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    bindingId: row.binding_id,
    definitionId: row.definition_id,
    effectiveRevisionId: row.definition_revision_id,
    status: row.status,
    targetValue: renderTarget(row),
    reason: row.reason,
    submitterUserId: row.submitter_user_id,
    assignedToUserId: row.assigned_to_user_id,
    reviewerUserId: row.reviewer_user_id,
    reviewerNote: row.reviewer_note,
    appliedValueId: row.applied_value_id,
    applyOutcome: row.apply_outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireOwnedProject(db: Database, auth: AuthContext, projectId: string) {
  const project = await getProjectById(db, { organizationId: auth.organization.id, projectId });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", { projectId });
  }
}

function requireProjectEditor(auth: AuthContext, projectId: string) {
  if (!canEditParameters(auth) || !canEditParameters(auth, projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter edit role is required for this project.");
  }
}

/**
 * Freeze one pending draft into a reviewable change request. The current value,
 * its tip and the active source revision are untouched.
 */
export async function submitCanonicalValueChange(
  db: Database,
  auth: AuthContext,
  input: SubmitCanonicalValueChangeInput
): Promise<CanonicalValueChangeRequestDto> {
  await requireOwnedProject(db, auth, input.projectId);
  requireProjectEditor(auth, input.projectId);

  const draft = await getCanonicalValueDraft(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    userId: auth.user.id,
    draftId: input.draftId
  });
  if (!draft) {
    throw new ApiError("NOT_FOUND", "Pending value draft was not found.", {
      projectId: input.projectId,
      draftId: input.draftId
    });
  }
  if (draft.action !== "set") {
    throw new ApiError("VALIDATION_FAILED", "Only a set draft can be submitted for review.", {
      draftId: input.draftId,
      action: draft.action
    });
  }
  const open = await getOpenCanonicalValueChangeRequestForDraft(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    draftId: input.draftId
  });
  if (open) {
    throw new ApiError("CONFLICT", "Draft already has an open change request.", {
      draftId: input.draftId,
      requestId: open.id
    });
  }

  const row = await insertCanonicalValueChangeRequest(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    draftId: draft.id,
    bindingId: draft.binding_id,
    definitionId: draft.definition_id,
    definitionRevisionId: draft.definition_revision_id,
    catalogReleaseId: draft.catalog_release_id,
    baseCurrentValueId: draft.base_current_value_id,
    configRevisionId: draft.config_revision_id,
    sourceRef: draft.source_ref,
    action: draft.action,
    targetValue: draft.target_value,
    reason: draft.reason,
    submitterUserId: auth.user.id,
    assignedToUserId: input.assignedToUserId ?? null
  });
  return toCanonicalValueChangeRequestDto(row);
}

export async function listCanonicalValueChangesForAuth(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; status?: CanonicalChangeRequestStatus }
): Promise<CanonicalValueChangeRequestDto[]> {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
  await requireOwnedProject(db, auth, input.projectId);
  const rows = await listCanonicalValueChangeRequests(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    status: input.status
  });
  return rows.map(toCanonicalValueChangeRequestDto);
}

/**
 * Approve (and apply) or reject a pending change request.
 *
 * Approval is the authorized apply unit. It commits the canonical value, its
 * protected source writeback, the ProjectValue history appended by the canonical
 * owner, the workflow status and the caller's audit in one transaction.
 */
export async function reviewCanonicalValueChange(
  db: Database,
  auth: AuthContext,
  input: ReviewCanonicalValueChangeInput
): Promise<CanonicalValueChangeRequestDto> {
  await requireOwnedProject(db, auth, input.projectId);

  const pool = getRootPostgresPool(db);

  return db.transaction(async (tx) => {
    const request = await getCanonicalValueChangeRequestForUpdate(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      requestId: input.requestId
    });
    if (!request) {
      throw new ApiError("NOT_FOUND", "Parameter change request was not found.", {
        requestId: input.requestId
      });
    }

    // Idempotent replay: an already-applied request returns its recorded outcome
    // and never appends a second value.
    if (request.status === "approved") {
      return toCanonicalValueChangeRequestDto(request);
    }
    if (request.status !== "pending") {
      throw new ApiError("CONFLICT", "Parameter change request is already closed.", {
        requestId: input.requestId,
        status: request.status
      });
    }
    if (request.action !== "set") {
      throw new ApiError("VALIDATION_FAILED", "Only a set change can be applied.", {
        requestId: input.requestId,
        action: request.action
      });
    }

    if (input.decision === "reject") {
      if (!canReviewParameters(auth)) {
        throw new ApiError("FORBIDDEN", "Parameter review permission is required.");
      }
      const rejected = await markCanonicalValueChangeRequestReviewed(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        requestId: input.requestId,
        status: "rejected",
        actorUserId: auth.user.id,
        note: input.note ?? null
      });
      if (!rejected) {
        throw new ApiError("CONFLICT", "Parameter change request is no longer pending.", {
          requestId: input.requestId
        });
      }
      // The draft stays pending so the editor can revise and resubmit.
      return toCanonicalValueChangeRequestDto(rejected);
    }

    if (!canReviewParameters(auth) || !canReviewParameterStage(auth, input.projectId, CANONICAL_VALUE_REVIEW_STAGE)) {
      throw new ApiError(
        "FORBIDDEN",
        "The software review role is required to approve this parameter change."
      );
    }
    // Actor separation: the submitter cannot approve their own change.
    if (request.submitter_user_id === auth.user.id) {
      throw new ApiError("FORBIDDEN", "The submitter cannot approve their own parameter change.", {
        requestId: input.requestId
      });
    }
    if (!pool) {
      throw new ApiError("INTERNAL_ERROR", "Canonical apply requires the root database.");
    }

    // Re-resolve the protected references and reject drift. A changed value,
    // definition or source pin must be resubmitted, never force-overwritten.
    const pins = await loadCanonicalBindingPins(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: request.binding_id
    });
    if (!pins) {
      throw new ApiError("CONFLICT", "Canonical binding is no longer available.", {
        requestId: input.requestId,
        bindingId: request.binding_id
      });
    }
    if (pins.currentValueId !== request.base_current_value_id) {
      throw new ApiError("CONFLICT", "Change request base value is stale.", {
        requestId: input.requestId,
        reason: "stale-base-value",
        expected: request.base_current_value_id,
        actual: pins.currentValueId
      });
    }
    if (pins.configRevisionId !== request.config_revision_id) {
      throw new ApiError("CONFLICT", "Change request base source revision is stale.", {
        requestId: input.requestId,
        reason: "stale-base-revision",
        expected: request.config_revision_id,
        actual: pins.configRevisionId
      });
    }
    if (pins.definitionRevisionId !== request.definition_revision_id) {
      throw new ApiError("CONFLICT", "Change request definition revision is stale.", {
        requestId: input.requestId,
        reason: "stale-definition-revision",
        expected: request.definition_revision_id,
        actual: pins.definitionRevisionId
      });
    }

    const written = await saveCanonicalProjectValue(
      pool,
      {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        bindingId: request.binding_id,
        configRevisionId: request.config_revision_id,
        targetValue: request.target_value as DtsValue
      },
      asValueClient(tx)
    );

    const outcome: CanonicalChangeApplyOutcome =
      written.currentValueId === request.base_current_value_id ? "replayed" : "committed";

    const applied = await markCanonicalValueChangeRequestApplied(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      requestId: input.requestId,
      reviewerUserId: auth.user.id,
      reviewerNote: input.note ?? null,
      appliedValueId: written.currentValueId,
      applyOutcome: outcome
    });
    if (!applied) {
      throw new ApiError("CONFLICT", "Parameter change request is no longer pending.", {
        requestId: input.requestId
      });
    }

    // The applied pending work leaves the draft tray in the same transaction.
    // A deleted submitter clears the attribution (and takes unsubmitted drafts with
    // it), so the consumed draft can only be removed while attribution still exists.
    if (request.draft_id && request.submitter_user_id) {
      await deleteCanonicalValueDraft(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        userId: request.submitter_user_id,
        draftId: request.draft_id
      });
    }

    return toCanonicalValueChangeRequestDto(applied);
  });
}

/** Withdraw a pending request. Only the submitter may withdraw, and no value is written. */
export async function withdrawCanonicalValueChange(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; requestId: string; note?: string | null }
): Promise<CanonicalValueChangeRequestDto> {
  await requireOwnedProject(db, auth, input.projectId);

  const request = await getCanonicalValueChangeRequest(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    requestId: input.requestId
  });
  if (!request) {
    throw new ApiError("NOT_FOUND", "Parameter change request was not found.", {
      requestId: input.requestId
    });
  }
  if (request.submitter_user_id !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "Only the submitter can withdraw this parameter change.", {
      requestId: input.requestId
    });
  }
  if (request.status !== "pending") {
    throw new ApiError("CONFLICT", "Parameter change request is already closed.", {
      requestId: input.requestId,
      status: request.status
    });
  }

  const withdrawn = await markCanonicalValueChangeRequestReviewed(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    requestId: input.requestId,
    status: "withdrawn",
    actorUserId: auth.user.id,
    note: input.note ?? null
  });
  if (!withdrawn) {
    throw new ApiError("CONFLICT", "Parameter change request is no longer pending.", {
      requestId: input.requestId
    });
  }
  return toCanonicalValueChangeRequestDto(withdrawn);
}
