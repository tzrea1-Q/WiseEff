/** #906 C owner: freeze one JSON source candidate into one ordered request. */
import { randomUUID } from "node:crypto";

import { asAuditTx } from "../../audit/auditedWrite";
import { writeTrustedGovernanceAudit } from "../../parameter-topology/governanceAudit";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { AuthContext } from "../../auth/types";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { ObjectStore } from "../../logs/objectStore";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage, canViewParameters } from "../../parameter-kernel/policy";
import { getProjectById } from "../../projects/repository";
import { lockUserById } from "../../users/repository";
import { hasCurrentCanonicalReviewRole, hasEligibleWorkflowAssignee } from "../../parameters/reviewWorkflowRepository";
import { freezeCanonicalCandidateBatchSnapshotInTransaction } from "../../parameter-files/canonicalFileWorkflow";
import { commitCanonicalSourceBatchRevision } from "../../parameter-files/canonicalSourceBatchCommit";
import { parseJsonSource } from "../../parameter-files/jsonSource";
import { recordCanonicalPermissionRefusal, requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "../../parameter-files/canonicalSource";

export type CanonicalBatchChangeRequestDto = {
  id: string;
  projectId: string;
  candidateId: string;
  batchProofDigest: string;
  cohortCount: number;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reason: string;
  submitterUserId: string | null;
  assignedToUserId: string | null;
  reviewerUserId: string | null;
  reviewerNote: string | null;
  sourceProofToken: string;
  cohortProofToken: string;
  fileId: string;
  baseVersionId: string;
  configSetId: string;
  appliedAt: string | null;
  appliedAuditRef: string | null;
  targets: Array<{
    ordinal: number;
    draftId: string | null;
    bindingId: string;
    definitionId: string;
    definitionRevisionId: string;
    catalogReleaseId: string;
    baseCurrentValueId: string;
    configRevisionId: string;
    sourceRef: string;
    sourcePinId: string;
    action: "set" | "delete";
    targetText: string | null;
    appliedValueId: string | null;
    appliedHistoryEventId: string | null;
    appliedSourcePinId: string | null;
    appliedFileVersionId: string | null;
  }>;
};

type BatchRow = {
  id: string; project_id: string; candidate_id: string; batch_proof_digest: string;
  batch_cohort_count: number;
  status: CanonicalBatchChangeRequestDto["status"]; reason: string;
  submitter_user_id: string | null; assigned_to_user_id: string | null;
  reviewer_user_id: string | null; reviewer_note: string | null;
  batch_source_proof_token: string; batch_cohort_proof_token: string;
  batch_file_id: string; batch_base_version_id: string; batch_config_set_id: string;
  applied_at: string | null; applied_audit_ref: string | null;
};

async function loadBatchRequest(db: Database, organizationId: string, projectId: string, requestId: string): Promise<CanonicalBatchChangeRequestDto | null> {
  const request = (await db.query<BatchRow>(`
    select * from public.project_parameter_value_change_requests
     where id=$1 and organization_id=$2 and project_id=$3 and request_kind='batch'`,
    [requestId, organizationId, projectId])).rows[0];
  if (!request) return null;
  const targets = await db.query<{
    ordinal: number; draft_id: string | null; binding_id: string; definition_id: string;
    definition_revision_id: string; catalog_release_id: string; base_current_value_id: string;
    config_revision_id: string; source_ref: string; source_pin_id: string;
    action: "set" | "delete"; target_text: string | null;
    applied_value_id: string | null; applied_history_event_id: string | null;
    applied_source_pin_id: string | null; applied_file_version_id: string | null;
  }>(`select * from public.project_parameter_value_change_targets
      where request_id=$1 and organization_id=$2 and project_id=$3 order by ordinal`,
    [requestId, organizationId, projectId]);
  return {
    id: request.id,
    projectId: request.project_id,
    candidateId: request.candidate_id,
    batchProofDigest: request.batch_proof_digest,
    cohortCount: request.batch_cohort_count,
    status: request.status,
    reason: request.reason,
    submitterUserId: request.submitter_user_id,
    assignedToUserId: request.assigned_to_user_id,
    reviewerUserId: request.reviewer_user_id,
    reviewerNote: request.reviewer_note,
    sourceProofToken: request.batch_source_proof_token,
    cohortProofToken: request.batch_cohort_proof_token,
    fileId: request.batch_file_id,
    baseVersionId: request.batch_base_version_id,
    configSetId: request.batch_config_set_id,
    appliedAt: request.applied_at,
    appliedAuditRef: request.applied_audit_ref,
    targets: targets.rows.map((target) => ({
      ordinal: target.ordinal,
      draftId: target.draft_id,
      bindingId: target.binding_id,
      definitionId: target.definition_id,
      definitionRevisionId: target.definition_revision_id,
      catalogReleaseId: target.catalog_release_id,
      baseCurrentValueId: target.base_current_value_id,
      configRevisionId: target.config_revision_id,
      sourceRef: target.source_ref,
      sourcePinId: target.source_pin_id,
      action: target.action,
      targetText: target.target_text,
      appliedValueId: target.applied_value_id,
      appliedHistoryEventId: target.applied_history_event_id,
      appliedSourcePinId: target.applied_source_pin_id,
      appliedFileVersionId: target.applied_file_version_id
    }))
  };
}

export async function submitCanonicalBatchValueChange(
  db: Database,
  objectStore: ObjectStore | undefined,
  auth: AuthContext,
  input: {
    projectId: string;
    candidateId: string;
    expectedProofToken: string;
    reason: string;
    assignedToUserId: string;
    selectedDrafts?: Array<{ bindingId: string; draftId: string }>;
    invocation: TrustedInvocationContext;
    requestId: string;
    refusalSink: TrustedRefusalAuditSink;
  }
): Promise<CanonicalBatchChangeRequestDto> {
  const security: CanonicalSourceSecurityContext = {
    invocation: input.invocation, requestId: input.requestId, refusalSink: input.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical batch submit",
    targetType: "project-parameter-file-candidate", targetId: input.candidateId
  });
  if (!await getProjectById(db, { organizationId: auth.organization.id, projectId: input.projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
  }
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical batch submit",
      targetType: "project-parameter-file-candidate", targetId: input.candidateId,
      details: { permission: "parameter:admin-and-edit" }
    });
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  const reason = input.reason.trim();
  if (!reason || !input.assignedToUserId.trim() || input.assignedToUserId === auth.user.id) {
    throw new ApiError("VALIDATION_FAILED", "A batch change requires a reason and a separate assigned reviewer.");
  }
  if (!objectStore) throw new ApiError("INTERNAL_ERROR", "Canonical batch submit requires source object storage.");

  return db.transaction(async (tx) => {
    // The single-target submitter takes the reviewer row before source locks.
    // Keep that order to avoid a reviewer/source lock cycle.
    const locked = await lockUserById(tx, { organizationId: auth.organization.id, userId: input.assignedToUserId });
    if (!locked || !await hasEligibleWorkflowAssignee(tx, {
      organizationId: auth.organization.id, projectId: input.projectId,
      userId: input.assignedToUserId, roleId: "software-committer"
    })) throw new ApiError("VALIDATION_FAILED", "The selected software reviewer is no longer eligible.");

    const proof = await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, objectStore, auth, {
      projectId: input.projectId, candidateId: input.candidateId,
      expectedProofToken: input.expectedProofToken
    });
    if (proof.organizationId !== auth.organization.id || proof.projectId !== input.projectId
      || proof.candidateId !== input.candidateId || proof.format !== "json"
      || proof.targets.length < 2 || !/^[0-9a-f]{64}$/.test(proof.batchProofDigest)) {
      throw new ApiError("CONFLICT", "Canonical batch source proof is incomplete.");
    }
    const candidate = (await tx.query<{
      base_digest: string; proposed_digest: string; diff_digest: string;
      frozen_member_manifest: unknown[]; frozen_binding_manifest: unknown[];
    }>(`select base_digest, proposed_digest, diff_digest,
              frozen_member_manifest, frozen_binding_manifest
         from public.project_parameter_file_candidates
        where id=$1 and organization_id=$2 and project_id=$3 for update`,
      [input.candidateId, auth.organization.id, input.projectId])).rows[0];
    if (!candidate || candidate.base_digest !== proof.baseDigest
      || candidate.proposed_digest !== proof.proposedDigest
      || candidate.diff_digest !== proof.batchProofDigest
      || !Array.isArray(candidate.frozen_member_manifest)
      || !Array.isArray(candidate.frozen_binding_manifest)
      || serializeContract(candidate.frozen_member_manifest as ContractJsonValue) !== serializeContract(proof.members)
      || serializeContract(candidate.frozen_binding_manifest as ContractJsonValue) !== serializeContract(proof.cohort)) {
      throw new ApiError("CONFLICT", "Candidate snapshot disagrees with the locked batch proof.");
    }
    const selected = new Map<string, string>();
    for (const item of input.selectedDrafts ?? []) {
      if (selected.has(item.bindingId) || !item.draftId) {
        throw new ApiError("VALIDATION_FAILED", "Selected drafts must identify distinct Binding targets.");
      }
      selected.set(item.bindingId, item.draftId);
    }
    const cohort = new Map(proof.cohort.map((entry) => [entry.bindingId, entry]));
    const targetIds = proof.targets.map((target) => target.bindingId);
    if (new Set(targetIds).size !== targetIds.length || [...selected.keys()].some((id) => !targetIds.includes(id))) {
      throw new ApiError("CONFLICT", "Batch proof or selected drafts contain an unexpected Binding.");
    }
    const pending = await tx.query<{ id: string }>(`select id from public.project_parameter_value_change_requests
      where candidate_id=$1 and organization_id=$2 and project_id=$3 and status='pending' for update`,
      [input.candidateId, auth.organization.id, input.projectId]);
    if (pending.rows.length) {
      const prior = await loadBatchRequest(tx, auth.organization.id, input.projectId, pending.rows[0]!.id);
      if (prior && prior.submitterUserId === auth.user.id && prior.assignedToUserId === input.assignedToUserId
        && prior.reason === reason && prior.batchProofDigest === proof.batchProofDigest
        && prior.sourceProofToken === proof.proofToken && prior.targets.length === proof.targets.length
        && prior.targets.every((target) => (selected.get(target.bindingId) ?? null) === target.draftId)) return prior;
      throw new ApiError("CONFLICT", "Candidate already has a pending review request.");
    }
    const bases = await tx.query<{
      binding_id: string; definition_id: string; effective_revision_id: string;
      catalog_release_id: string; current_value_id: string; config_revision_id: string;
      source_ref: string; source_pin_id: string;
    }>(`select binding.id as binding_id, binding.definition_id, binding.effective_revision_id,
              binding.catalog_release_id, binding.current_value_id, value.config_revision_id,
              value.source_ref, pin.id as source_pin_id
         from parameter_catalog.project_parameter_bindings binding
         join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
         join parameter_catalog.project_value_source_pins pin
           on pin.project_value_id=value.id and pin.binding_id=binding.id
        where binding.organization_id=$1 and binding.project_id=$2
          and binding.id=any($3::text[])`,
      [auth.organization.id, input.projectId, targetIds]);
    const byBinding = new Map(bases.rows.map((row) => [row.binding_id, row]));
    if (byBinding.size !== proof.targets.length) throw new ApiError("CONFLICT", "Batch target base changed.");

    const requestId = `pvcr_${randomUUID()}`;
    await tx.query(`insert into public.project_parameter_value_change_requests (
      id, organization_id, project_id, request_kind, reason, status,
      submitter_user_id, assigned_to_user_id, candidate_id,
      candidate_base_digest, candidate_proposed_digest, candidate_diff_digest,
      candidate_member_manifest, candidate_binding_manifest, batch_proof_digest,
      batch_target_count, batch_source_proof_token, batch_cohort_proof_token,
      batch_file_id, batch_base_version_id, batch_config_set_id, batch_cohort_count
    ) values ($1,$2,$3,'batch',$4,'pending',$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
              $13,$14,$15,$16,$17,$18,$19,$20)`, [
      requestId, auth.organization.id, input.projectId, reason, auth.user.id,
      input.assignedToUserId, proof.candidateId, candidate.base_digest,
      candidate.proposed_digest, candidate.diff_digest,
      JSON.stringify(candidate.frozen_member_manifest), JSON.stringify(candidate.frozen_binding_manifest),
      proof.batchProofDigest, proof.targets.length, proof.proofToken,
      proof.cohortProofToken, proof.fileId, proof.baseVersionId, proof.configSetId,
      proof.cohort.length
    ]);

    for (const [ordinal, target] of proof.targets.entries()) {
      const base = byBinding.get(target.bindingId);
      const cohortPin = cohort.get(target.bindingId);
      if (!base || !cohortPin || base.definition_id !== target.definitionId
        || base.definition_id !== cohortPin.definitionId
        || base.effective_revision_id !== cohortPin.effectiveRevisionId
        || base.catalog_release_id !== cohortPin.catalogReleaseId
        || base.current_value_id !== target.baseCurrentValueId
        || base.current_value_id !== cohortPin.oldValueId
        || base.config_revision_id !== target.configRevisionId
        || base.source_pin_id !== target.sourcePinId
        || base.source_pin_id !== cohortPin.sourcePinId
        || target.baseDigest !== proof.baseDigest
        || target.proposedDigest !== proof.proposedDigest) {
        throw new ApiError("CONFLICT", "Batch target no longer matches its locked canonical base.");
      }
      const targetValue = target.action === "delete" ? "" : {
        kind: "json-source", value: parseJsonSource(target.targetText ?? "")
      };
      const selectedDraftId = selected.get(target.bindingId) ?? null;
      if (selectedDraftId) {
        const draft = (await tx.query<{
          id: string; user_id: string | null; source_pin_id: string; base_current_value_id: string;
          config_revision_id: string; candidate_id: string; action: string; target_value: unknown;
        }>(`select * from public.project_parameter_value_drafts
              where id=$1 and organization_id=$2 and project_id=$3 and binding_id=$4 for update`,
          [selectedDraftId, auth.organization.id, input.projectId, target.bindingId])).rows[0];
        if (!draft || draft.user_id !== auth.user.id
          || draft.source_pin_id !== target.sourcePinId
          || draft.base_current_value_id !== target.baseCurrentValueId
          || draft.config_revision_id !== target.configRevisionId
          || draft.candidate_id !== proof.candidateId || draft.action !== target.action
          || serializeContract(draft.target_value as ContractJsonValue) !== serializeContract(targetValue as ContractJsonValue)) {
          throw new ApiError("CONFLICT", "Selected draft disagrees with the frozen candidate target.");
        }
        const open = await tx.query(`select request.id from public.project_parameter_value_change_requests request
          left join public.project_parameter_value_change_targets other on other.request_id=request.id
          where request.status='pending' and (request.draft_id=$1 or other.draft_id=$1)
          limit 1`, [selectedDraftId]);
        if (open.rows.length) throw new ApiError("CONFLICT", "Selected draft already has a pending request.");
      }
      await tx.query(`insert into public.project_parameter_value_change_targets (
        id, request_id, organization_id, project_id, ordinal, draft_id, binding_id,
        definition_id, definition_revision_id, catalog_release_id,
        base_current_value_id, config_revision_id, source_ref, source_pin_id,
        action, target_value, target_text, base_digest, proposed_digest
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`, [
        `pvct_${randomUUID()}`, requestId, auth.organization.id, input.projectId,
        ordinal, selectedDraftId, target.bindingId, base.definition_id,
        base.effective_revision_id, base.catalog_release_id, base.current_value_id,
        base.config_revision_id, base.source_ref, base.source_pin_id,
        target.action, JSON.stringify(targetValue), target.targetText ?? null,
        target.baseDigest, target.proposedDigest
      ]);
    }
    const frozen = await loadBatchRequest(tx, auth.organization.id, input.projectId, requestId);
    if (!frozen) throw new ApiError("INTERNAL_ERROR", "Frozen batch request disappeared.");
    await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
      action: "value-change-submitted", organizationId: auth.organization.id,
      projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: requestId,
      metadata: { requestId, requestKind: "batch", candidateId: proof.candidateId,
        batchProofDigest: proof.batchProofDigest, targetCount: proof.targets.length }
    }, input.requestId);
    return frozen;
  });
}

/** B reviewer handoff: one request ID and all targets under a current DB role check. */
export async function getCanonicalBatchValueChangeForReviewer(
  db: Database, auth: AuthContext, input: { projectId: string; requestId: string },
  security?: CanonicalSourceSecurityContext
): Promise<CanonicalBatchChangeRequestDto | null> {
  if (security) await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical batch approve",
    targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  if (!await getProjectById(db, { organizationId: auth.organization.id, projectId: input.projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
  }
  const denyReview = async () => {
    if (security) await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical batch approve",
      targetType: "project-parameter-value-change-request", targetId: input.requestId,
      details: { permission: "parameter:edit-and-review", reason: "current-review-role-required" }
    });
    throw new ApiError("FORBIDDEN", "The software review role is required.");
  };
  const frozen = await loadBatchRequest(db, auth.organization.id, input.projectId, input.requestId);
  if (!frozen || frozen.assignedToUserId !== auth.user.id || frozen.submitterUserId === auth.user.id) {
    if (frozen && security) await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical batch approve",
      targetType: "project-parameter-value-change-request", targetId: input.requestId,
      details: { reason: "separate-assigned-reviewer-required" }
    });
    return null;
  }
  if (!canReviewParameters(auth) || !canReviewParameterStage(auth, input.projectId, "software_review")
    || (security && !canEditParameters(auth, input.projectId))) {
    await denyReview();
  }
  return db.transaction(async (tx) => {
    if (!await hasCurrentCanonicalReviewRole(tx, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    })) await denyReview();
    return frozen;
  });
}

export async function listCanonicalBatchValueChangesForAuth(
  db: Database, auth: AuthContext,
  input: { projectId: string; status?: CanonicalBatchChangeRequestDto["status"]; mine?: boolean }
): Promise<CanonicalBatchChangeRequestDto[]> {
  if (!await getProjectById(db, { organizationId: auth.organization.id, projectId: input.projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
  }
  if (!auth.user.isActive || !canViewParameters(auth)
    || !auth.roles.some((role) => role.projectId === null || role.projectId === input.projectId)) {
    throw new ApiError("FORBIDDEN", "Project parameter view permission is required.");
  }
  if (!input.mine && (!canEditParameters(auth, input.projectId) || !canReviewParameters(auth)
    || !canReviewParameterStage(auth, input.projectId, "software_review")
    || !await hasCurrentCanonicalReviewRole(db, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    }))) throw new ApiError("FORBIDDEN", "The software review role is required.");
  const rows = await db.query<{ id: string }>(`select id from public.project_parameter_value_change_requests
    where organization_id=$1 and project_id=$2 and request_kind='batch'
      and ($3::text is null or status=$3)
      and ${input.mine ? "submitter_user_id" : "assigned_to_user_id"}=$4
    order by updated_at desc,id`, [auth.organization.id, input.projectId, input.status ?? null, auth.user.id]);
  return Promise.all(rows.rows.map(async ({ id }) => (await loadBatchRequest(db, auth.organization.id, input.projectId, id))!));
}

export async function rejectCanonicalBatchValueChange(
  db: Database, auth: AuthContext,
  input: { projectId: string; requestId: string; batchProofDigest: string; note?: string | null;
    invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalBatchChangeRequestDto> {
  return db.transaction(async (tx) => {
    const visible = await getCanonicalBatchValueChangeForReviewer(tx, auth, input, {
      invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
    });
    if (!visible) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
    if (visible.batchProofDigest !== input.batchProofDigest) {
      throw new ApiError("CONFLICT", "Canonical batch review proof disagrees with the frozen request.", {
        reason: "canonical-batch-proof-mismatch"
      });
    }
    const locked = (await tx.query<BatchRow>(`select * from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='batch' for update`,
    [input.requestId, auth.organization.id, input.projectId])).rows[0];
    if (!locked || locked.assigned_to_user_id !== auth.user.id
      || locked.submitter_user_id === auth.user.id || locked.batch_proof_digest !== input.batchProofDigest) {
      throw new ApiError("CONFLICT", "Canonical batch assignment or proof changed.");
    }
    if (locked.status === "rejected" && locked.reviewer_user_id === auth.user.id) {
      return (await loadBatchRequest(tx, auth.organization.id, input.projectId, input.requestId))!;
    }
    if (locked.status !== "pending") throw new ApiError("CONFLICT", "Canonical batch request is already closed.");
    await tx.query(`update public.project_parameter_value_change_requests
      set status='rejected',reviewer_user_id=$2,reviewer_note=$3,updated_at=now()
      where id=$1 and status='pending'`, [locked.id, auth.user.id, input.note ?? null]);
    await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
      action: "value-change-reviewed", organizationId: auth.organization.id,
      projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: locked.id,
      metadata: { requestId: locked.id, requestKind: "batch", decision: "reject",
        batchProofDigest: locked.batch_proof_digest }
    }, input.traceId);
    return (await loadBatchRequest(tx, auth.organization.id, input.projectId, input.requestId))!;
  });
}

export async function withdrawCanonicalBatchValueChange(
  db: Database, auth: AuthContext,
  input: { projectId: string; requestId: string; invocation: TrustedInvocationContext;
    traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalBatchChangeRequestDto> {
  const security: CanonicalSourceSecurityContext = {
    invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical batch withdraw",
    targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  if (!await getProjectById(db, { organizationId: auth.organization.id, projectId: input.projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
  }
  return db.transaction(async (tx) => {
    const locked = (await tx.query<BatchRow>(`select * from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='batch' for update`,
    [input.requestId, auth.organization.id, input.projectId])).rows[0];
    if (!locked) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
    if (locked.submitter_user_id !== auth.user.id) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: input.projectId, operation: "canonical batch withdraw",
        targetType: "project-parameter-value-change-request", targetId: input.requestId,
        details: { reason: "withdraw-not-submitter" }
      });
      throw new ApiError("FORBIDDEN", "Only the batch submitter can withdraw this request.");
    }
    if (locked.status === "withdrawn") {
      return (await loadBatchRequest(tx, auth.organization.id, input.projectId, input.requestId))!;
    }
    if (locked.status !== "pending") throw new ApiError("CONFLICT", "Canonical batch request is already closed.");
    await tx.query(`update public.project_parameter_value_change_requests
      set status='withdrawn',reviewer_user_id=$2,updated_at=now()
      where id=$1 and status='pending'`, [locked.id, auth.user.id]);
    await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
      action: "value-change-withdrawn", organizationId: auth.organization.id,
      projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: locked.id,
      metadata: { requestId: locked.id, requestKind: "batch",
        batchProofDigest: locked.batch_proof_digest }
    }, input.traceId);
    return (await loadBatchRequest(tx, auth.organization.id, input.projectId, input.requestId))!;
  });
}

/** Adapt the existing reviewer transaction to D's exact whole-cohort commit. */
export async function approveCanonicalBatchValueChange(
  tx: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  snapshot: CatalogSnapshot,
  input: {
    projectId: string;
    requestId: string;
    batchProofDigest: string;
    invocation: TrustedInvocationContext;
    traceId: string;
    refusalSink: TrustedRefusalAuditSink;
    note?: string | null;
  }
): Promise<CanonicalBatchChangeRequestDto> {
  const frozen = await getCanonicalBatchValueChangeForReviewer(tx, auth, input, {
    invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
  });
  if (!frozen) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
  if (!/^[0-9a-f]{64}$/.test(input.batchProofDigest)
    || frozen.batchProofDigest !== input.batchProofDigest) {
    throw new ApiError("CONFLICT", "Canonical batch review proof disagrees with the frozen request.", {
      reason: "canonical-batch-proof-mismatch"
    });
  }
  const applied = await commitCanonicalSourceBatchRevision(tx, objectStore, auth, snapshot, {
    projectId: input.projectId, requestId: input.requestId,
    invocation: input.invocation, traceId: input.traceId,
    refusalSink: input.refusalSink, note: input.note ?? null
  });
  const result = await loadBatchRequest(tx, auth.organization.id, input.projectId, input.requestId);
  if (applied.batchProofDigest !== input.batchProofDigest || !result
    || result.status !== "approved" || result.batchProofDigest !== input.batchProofDigest
    || result.targets.length < 2 || result.targets.some((target, ordinal) =>
      target.ordinal !== ordinal || !target.appliedValueId || !target.appliedHistoryEventId
      || !target.appliedSourcePinId || !target.appliedFileVersionId)) {
    throw new ApiError("CONFLICT", "Canonical batch review has no complete ordered result.");
  }
  return result;
}
