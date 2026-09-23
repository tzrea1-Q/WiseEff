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
import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { ObjectStore } from "../../logs/objectStore";
import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import {
  canEditParameters,
  canReviewParameters,
  canReviewParameterStage,
  canViewParameters
} from "../../parameter-kernel/policy";
import { getProjectById } from "../../projects/repository";
import { lockUserById } from "../../users/repository";
import { renderDtsValue } from "../../dts/valueAst";
import type { DtsValue } from "../../dts/types";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import { commitCanonicalSourceRevision } from "../../parameter-files/canonicalSourceCommit";
import { loadCanonicalSourceCohort, recordCanonicalPermissionRefusal, requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "../../parameter-files/canonicalSource";
import {
  hasCurrentCanonicalReviewRole,
  hasEligibleWorkflowAssignee,
  listEligibleWorkflowAssignees
} from "../../parameters/reviewWorkflowRepository";
import {
  deleteCanonicalValueDraft,
  getCanonicalValueDraftForUpdate,
} from "./repository";
import {
  getCanonicalValueChangeRequest,
  getCanonicalValueChangeRequestForUpdate,
  getOpenCanonicalValueChangeRequestForDraft,
  insertCanonicalValueChangeRequest,
  listCanonicalValueChangeRequests,
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
  sourceFormat: "dts" | "json";
  sourceTarget?: { format: "json"; sourceText: string };
  baseRevisionId: string;
  baseCurrentValueId: string;
  reason: string;
  submitterUserId: string | null;
  assignedToUserId: string | null;
  reviewerUserId: string | null;
  reviewerNote: string | null;
  appliedValueId: string | null;
  applyOutcome: CanonicalChangeApplyOutcome | null;
  sourcePinId?: string | null;
  candidateId?: string | null;
  appliedSourceResult?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  action: "set" | "delete";
};

export type SubmitCanonicalValueChangeInput = {
  projectId: string;
  draftId: string;
  assignedToUserId?: string | null;
  invocation: TrustedInvocationContext;
  requestId: string;
  refusalSink: TrustedRefusalAuditSink;
};

export type ReviewCanonicalValueChangeInput = {
  projectId: string;
  requestId: string;
  decision: "approve" | "reject";
  note?: string | null;
};

export type ReviewCanonicalValueChangeOptions = {
  objectStore?: ObjectStore;
  snapshot?: CatalogSnapshot;
  invocation?: TrustedInvocationContext;
  traceId?: string;
  refusalSink?: TrustedRefusalAuditSink;
};

function renderTarget(row: CanonicalValueChangeRequestRow): string {
  if (row.target_value && typeof row.target_value === "object"
    && (row.target_value as { kind?: unknown }).kind === "json-source") {
    return JSON.stringify((row.target_value as { value: unknown }).value);
  }
  try {
    return renderDtsValue(row.target_value as DtsValue);
  } catch {
    return JSON.stringify(row.target_value);
  }
}

export function toCanonicalValueChangeRequestDto(
  row: CanonicalValueChangeRequestRow
): CanonicalValueChangeRequestDto {
  const jsonTarget = row.target_value && typeof row.target_value === "object" && (row.target_value as { kind?: unknown }).kind === "json-source"
    ? row.target_value as { value: ContractJsonValue } : null;
  return {
    id: row.id,
    projectId: row.project_id,
    draftId: row.draft_id,
    bindingId: row.binding_id,
    definitionId: row.definition_id,
    effectiveRevisionId: row.definition_revision_id,
    status: row.status,
    targetValue: row.action === "delete" ? "" : renderTarget(row),
    sourceFormat: row.source_format ?? (jsonTarget ? "json" : "dts"),
    ...(row.action === "set" && jsonTarget ? { sourceTarget: { format: "json" as const,sourceText: serializeContract(jsonTarget.value) } } : {}),
    baseRevisionId: row.config_revision_id,
    baseCurrentValueId: row.base_current_value_id,
    reason: row.reason,
    submitterUserId: row.submitter_user_id,
    assignedToUserId: row.assigned_to_user_id,
    reviewerUserId: row.reviewer_user_id,
    reviewerNote: row.reviewer_note,
    appliedValueId: row.applied_value_id,
    applyOutcome: row.apply_outcome,
    sourcePinId: row.source_pin_id,
    candidateId: row.candidate_id,
    appliedSourceResult: row.applied_source_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    action: row.action
  };
}

async function requireOwnedProject(db: Database, auth: AuthContext, projectId: string) {
  const project = await getProjectById(db, { organizationId: auth.organization.id, projectId });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", { projectId });
  }
}

async function assertSingleRequestReview(db: Database, auth: AuthContext, projectId: string, requestId: string) {
  const kind = (await db.query<{ request_kind: string }>(
    `select request_kind from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3`,
    [requestId, auth.organization.id, projectId]
  )).rows[0]?.request_kind;
  if (kind === "batch") {
    throw new ApiError("CONFLICT", "The batch source commit proof is not available for review.", {
      reason: "canonical-batch-source-commit-unavailable"
    });
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
  const security: CanonicalSourceSecurityContext = {
    invocation: input.invocation,
    requestId: input.requestId,
    refusalSink: input.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical value submit", targetType: "project-parameter-value-draft", targetId: input.draftId
  });
  await requireOwnedProject(db, auth, input.projectId);
  try {
    requireProjectEditor(auth, input.projectId);
  } catch (error) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical value submit", targetType: "project-parameter-value-draft", targetId: input.draftId,
      details: { permission: "parameter:edit" }
    });
    throw error;
  }

  const row = await db.transaction(async (tx) => {
    const source = await tx.query<{ config_set_id: string }>(`select occurrence.config_set_id
      from project_parameter_value_drafts draft
      join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
        and pin.organization_id=draft.organization_id and pin.project_id=draft.project_id and pin.binding_id=draft.binding_id
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
      where draft.organization_id=$1 and draft.project_id=$2 and draft.user_id=$3 and draft.id=$4`,
    [auth.organization.id,input.projectId,auth.user.id,input.draftId]);
    if (source.rows.length !== 1) throw new ApiError("NOT_FOUND", "Prepared source draft was not found.");
    const configSetId = source.rows[0]!.config_set_id;
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== null) {
      // Lock the selected reviewer before checking eligibility so a concurrent
      // role revoke cannot commit between the check and request insertion.
      const lockedUserId = await lockUserById(tx, {
        organizationId: auth.organization.id,
        userId: input.assignedToUserId
      });
      if (!lockedUserId) {
        throw new ApiError("VALIDATION_FAILED", "The assigned reviewer is not an active project software committer.", {
          assignedToUserId: input.assignedToUserId,
          projectId: input.projectId
        });
      }
      const eligible = await hasEligibleWorkflowAssignee(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        userId: input.assignedToUserId,
        roleId: "software-committer"
      });
      if (!eligible) {
        throw new ApiError("VALIDATION_FAILED", "The assigned reviewer is not an active project software committer.", {
          assignedToUserId: input.assignedToUserId,
          projectId: input.projectId
        });
      }
    } else {
      const eligible = await listEligibleWorkflowAssignees(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId
      });
      if (eligible.softwareCommitters.length === 0) {
        throw new ApiError("VALIDATION_FAILED", "An active project software committer is required when no reviewer is selected.", {
          projectId: input.projectId,
          roleId: "software-committer"
        });
      }
    }
    // Match prepare/apply ordering before locking the draft. Otherwise a
    // request FK can wait for the editor's Binding while holding its draft.
    await tx.query(`select id from dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update`,
      [configSetId,auth.organization.id,input.projectId]);
    await tx.query(`select id from project_parameter_files where config_set_id=$1 order by id for update`, [configSetId]);
    await loadCanonicalSourceCohort(tx,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId });
    const draft = await getCanonicalValueDraftForUpdate(tx, {
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
    if (!draft.source_pin_id || !draft.candidate_id
      || !draft.candidate_base_digest || !draft.candidate_proposed_digest || !draft.candidate_diff_digest
      || !draft.candidate_member_manifest || !draft.candidate_binding_manifest) {
      throw new ApiError("VALIDATION_FAILED", "Only a prepared source draft can be submitted for review.", {
        draftId: input.draftId
      });
    }
    const open = await getOpenCanonicalValueChangeRequestForDraft(tx, {
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
    return insertCanonicalValueChangeRequest(tx, {
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
    assignedToUserId: input.assignedToUserId ?? null,
    sourcePinId: draft.source_pin_id,
    candidateId: draft.candidate_id,
    candidateBaseDigest: draft.candidate_base_digest,
    candidateProposedDigest: draft.candidate_proposed_digest,
    candidateDiffDigest: draft.candidate_diff_digest,
    candidateMemberManifest: draft.candidate_member_manifest,
    candidateBindingManifest: draft.candidate_binding_manifest
    });
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
  input: ReviewCanonicalValueChangeInput,
  options: ReviewCanonicalValueChangeOptions = {}
): Promise<CanonicalValueChangeRequestDto> {
  if (!options.invocation || !options.refusalSink || !options.traceId?.trim()) {
    throw new ApiError("INTERNAL_ERROR", "Canonical value review requires trusted invocation and refusal evidence.");
  }
  const security: CanonicalSourceSecurityContext = {
    invocation: options.invocation,
    requestId: options.traceId.trim(),
    refusalSink: options.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: `canonical value ${input.decision}`, targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  await requireOwnedProject(db, auth, input.projectId);

  const requireCurrentReviewRole = async (tx: Database) => {
    if (!canReviewParameters(auth) || !canReviewParameterStage(auth, input.projectId, CANONICAL_VALUE_REVIEW_STAGE)) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: input.projectId, operation: `canonical value ${input.decision}`, targetType: "project-parameter-value-change-request", targetId: input.requestId,
        details: { permission: "parameter:review" }
      });
      throw new ApiError(
        "FORBIDDEN",
        "The software review role is required to review this parameter change."
      );
    }
    if (!await hasCurrentCanonicalReviewRole(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      userId: auth.user.id
    })) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: input.projectId,
        operation: `canonical value ${input.decision}`,
        targetType: "project-parameter-value-change-request",
        targetId: input.requestId,
        details: { reason: "current-review-role-required", decision: input.decision }
      });
      throw new ApiError("FORBIDDEN", "The software review role is required to review this parameter change.", {
        requestId: input.requestId
      });
    }
  };

  if (input.decision === "approve") {
    return db.transaction(async (tx) => {
      await requireCurrentReviewRole(tx);
      await assertSingleRequestReview(tx, auth, input.projectId, input.requestId);
      // Keep the source-commit lock order: source cohort/files are locked before
      // the request row. The owner rechecks the request under its request lock.
      const visibleRequest = await getCanonicalValueChangeRequest(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        requestId: input.requestId
      });
      if (!visibleRequest) {
        throw new ApiError("NOT_FOUND", "Parameter change request was not found.", {
          requestId: input.requestId
        });
      }
      if (visibleRequest.submitter_user_id === auth.user.id) {
        await recordCanonicalPermissionRefusal(security, {
          projectId: input.projectId,
          operation: `canonical value ${input.decision}`,
          targetType: "project-parameter-value-change-request",
          targetId: input.requestId,
          details: { reason: "submitter-self-review", decision: input.decision }
        });
        throw new ApiError("FORBIDDEN", "The submitter cannot review their own parameter change.", {
          requestId: input.requestId
        });
      }
      if (!options.objectStore || !options.snapshot || !options.invocation || !options.traceId?.trim()) {
        throw new ApiError("INTERNAL_ERROR", "Canonical source approval requires storage, snapshot and trusted invocation context.");
      }
      const applied = await commitCanonicalSourceRevision(tx, options.objectStore!, auth, options.snapshot!, {
        projectId: input.projectId,
        requestId: input.requestId,
        invocation: options.invocation!,
        traceId: options.traceId!.trim(),
        refusalSink: options.refusalSink!,
        note: input.note ?? null
      });
      if (applied.draft_id && applied.submitter_user_id) {
        const deleted = await deleteCanonicalValueDraft(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId,
          userId: applied.submitter_user_id,
          draftId: applied.draft_id,
          candidateId: applied.candidate_id ?? undefined
        });
        // Reflect the FK's SET NULL so the first response equals an exact replay.
        if (deleted) applied.draft_id = null;
      }
      return toCanonicalValueChangeRequestDto(applied);
    });
  }

  return db.transaction(async (tx) => {
    await requireCurrentReviewRole(tx);
    await assertSingleRequestReview(tx, auth, input.projectId, input.requestId);
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

    if (request.submitter_user_id === auth.user.id) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: input.projectId,
        operation: `canonical value ${input.decision}`,
        targetType: "project-parameter-value-change-request",
        targetId: input.requestId,
        details: { reason: "submitter-self-review", decision: input.decision }
      });
      throw new ApiError("FORBIDDEN", "The submitter cannot review their own parameter change.", {
        requestId: input.requestId
      });
    }

    // Idempotent replay: an already-applied request returns its recorded outcome.
    if (request.status === "approved") {
      return toCanonicalValueChangeRequestDto(request);
    }
    if (request.status !== "pending") {
      throw new ApiError("CONFLICT", "Parameter change request is already closed.", {
        requestId: input.requestId,
        status: request.status
      });
    }
    if (input.decision === "reject") {
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

    throw new ApiError("CONFLICT", "Parameter change request is already closed.", {
      requestId: input.requestId,
      status: request.status
    });
  });
}

/** Withdraw a pending request. Only the submitter may withdraw, and no value is written. */
export async function withdrawCanonicalValueChange(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; requestId: string; note?: string | null; invocation: TrustedInvocationContext; refusalSink: TrustedRefusalAuditSink; traceId: string }
): Promise<CanonicalValueChangeRequestDto> {
  const security: CanonicalSourceSecurityContext = { invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical value withdraw", targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  await requireOwnedProject(db, auth, input.projectId);
  await assertSingleRequestReview(db, auth, input.projectId, input.requestId);

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
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId,
      operation: "canonical value withdraw",
      targetType: "project-parameter-value-change-request",
      targetId: input.requestId,
      details: { reason: "withdraw-not-submitter" }
    });
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
