/** #906 C: the existing canonical request ledger for reviewed JSON member removal. */
import { randomUUID } from "node:crypto";

import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { asAuditTx } from "../../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { AuthContext } from "../../auth/types";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type { ObjectStore } from "../../logs/objectStore";
import { canAdminParameters, canEditParameters, canReviewParameters,
  canReviewParameterStage, canViewParameters } from "../../parameter-kernel/policy";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { applyReviewedCanonicalMemberRemoval, prepareCanonicalMemberRemoval,
  type CanonicalMemberRemovalProof } from "../../parameter-files/canonicalMemberRemoval";
import { recordCanonicalPermissionRefusal, requireCanonicalUserInvocation,
  type CanonicalSourceSecurityContext } from "../../parameter-files/canonicalSource";
import { writeTrustedGovernanceAudit } from "../../parameter-topology/governanceAudit";
import { hasCurrentCanonicalReviewRole, hasEligibleWorkflowAssignee } from "../../parameters/reviewWorkflowRepository";
import { getProjectById } from "../../projects/repository";
import { lockUserById } from "../../users/repository";

type Status = "pending" | "approved" | "rejected" | "withdrawn";
type Row = {
  id: string; project_id: string; member_config_set_id: string; member_file_id: string;
  member_file_version_id: string; member_proof_digest: string;
  member_frozen_proof: CanonicalMemberRemovalProof; status: Status; reason: string;
  submitter_user_id: string; assigned_to_user_id: string; reviewer_user_id: string | null;
  reviewer_note: string | null; applied_source_result: { tombstoneId: string; successorConfigRevisionId: string } | null;
  created_at: string | Date; updated_at: string | Date;
};
export type CanonicalMemberRemovalRequestDto = {
  id: string; projectId: string; configSetId: string; fileId: string; fileVersionId: string;
  proofDigest: string; frozenProof: CanonicalMemberRemovalProof; status: Status; reason: string;
  submitterUserId: string; assignedToUserId: string; reviewerUserId: string | null;
  reviewerNote: string | null; appliedSourceResult: Row["applied_source_result"];
  createdAt: string; updatedAt: string;
};
type Context = { invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink };
const security = (context: Context): CanonicalSourceSecurityContext => ({
  invocation: context.invocation, requestId: context.traceId, refusalSink: context.refusalSink
});
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value;
const dto = (row: Row): CanonicalMemberRemovalRequestDto => ({
  id: row.id, projectId: row.project_id, configSetId: row.member_config_set_id,
  fileId: row.member_file_id, fileVersionId: row.member_file_version_id,
  proofDigest: row.member_proof_digest, frozenProof: row.member_frozen_proof,
  status: row.status, reason: row.reason, submitterUserId: row.submitter_user_id,
  assignedToUserId: row.assigned_to_user_id, reviewerUserId: row.reviewer_user_id,
  reviewerNote: row.reviewer_note, appliedSourceResult: row.applied_source_result,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
});

async function ownedProject(db: Database, auth: AuthContext, projectId: string) {
  if (!await getProjectById(db, { organizationId: auth.organization.id, projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
  }
}
async function load(db: Database, auth: AuthContext, projectId: string, requestId: string, lock = false) {
  return (await db.query<Row>(`select * from public.project_parameter_value_change_requests
    where id=$1 and organization_id=$2 and project_id=$3 and request_kind='member-removal'
    ${lock ? "for update" : ""}`,
  [requestId, auth.organization.id, projectId])).rows[0] ?? null;
}
async function currentReviewer(db: Database, auth: AuthContext, projectId: string,
  context: Context, requestId: string) {
  if (canEditParameters(auth, projectId) && canReviewParameters(auth)
    && canReviewParameterStage(auth, projectId, "software_review")
    && await hasCurrentCanonicalReviewRole(db, {
      organizationId: auth.organization.id, projectId, userId: auth.user.id
    })) return;
  await recordCanonicalPermissionRefusal(security(context), {
    projectId, operation: "canonical member removal review",
    targetType: "project-parameter-value-change-request", targetId: requestId,
    details: { reason: "current-review-role-required" }
  });
  throw new ApiError("FORBIDDEN", "A current project software reviewer is required.");
}

export async function submitCanonicalMemberRemoval(
  db: Database, storage: ObjectStore | undefined, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string; reason: string;
    assignedToUserId: string } & Context
): Promise<CanonicalMemberRemovalRequestDto> {
  await requireCanonicalUserInvocation(auth, security(input), {
    projectId: input.projectId, operation: "canonical member removal submit",
    targetType: "project-parameter-file", targetId: input.fileId
  });
  await ownedProject(db, auth, input.projectId);
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    await recordCanonicalPermissionRefusal(security(input), {
      projectId: input.projectId, operation: "canonical member removal submit",
      targetType: "project-parameter-file", targetId: input.fileId,
      details: { permission: "parameter:admin-and-edit" }
    });
    throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
  }
  if (!storage) throw new ApiError("INTERNAL_ERROR", "Canonical member removal requires source storage.");
  const reason = input.reason.trim();
  if (!reason || !input.assignedToUserId.trim() || input.assignedToUserId === auth.user.id) {
    throw new ApiError("VALIDATION_FAILED", "Member removal requires a reason and a separate human reviewer.");
  }
  return db.transaction(async (tx) => {
    const reviewer = await lockUserById(tx, {
      organizationId: auth.organization.id, userId: input.assignedToUserId
    });
    if (!reviewer || !await hasEligibleWorkflowAssignee(tx, {
      organizationId: auth.organization.id, projectId: input.projectId,
      userId: input.assignedToUserId, roleId: "software-committer"
    })) throw new ApiError("VALIDATION_FAILED", "The selected software reviewer is no longer eligible.");
    const proof = await prepareCanonicalMemberRemoval(tx, storage, auth, input);
    const pending = await tx.query<Row>(`select * from public.project_parameter_value_change_requests
      where organization_id=$1 and project_id=$2 and member_file_id=$3
        and request_kind='member-removal' and status='pending'`,
    [auth.organization.id, input.projectId, input.fileId]);
    if (pending.rows.length) {
      const prior = pending.rows[0]!;
      if (prior.submitter_user_id === auth.user.id
        && prior.assigned_to_user_id === input.assignedToUserId
        && prior.reason === reason && prior.member_proof_digest === proof.proofDigest) return dto(prior);
      throw new ApiError("CONFLICT", "Member already has a pending removal request.");
    }
    const id = `pvcr_${randomUUID()}`;
    const row = (await tx.query<Row>(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
       assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,
       member_proof_digest,member_frozen_proof)
      values ($1,$2,$3,'member-removal',$4,'pending',$5,$6,$7,$8,$9,$10,$11::jsonb)
      returning *`, [id, auth.organization.id, input.projectId, reason, auth.user.id,
      input.assignedToUserId, proof.fileId, proof.configSetId, proof.fileVersionId,
      proof.proofDigest, JSON.stringify(proof)])).rows[0]!;
    await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
      action: "value-change-submitted", organizationId: auth.organization.id,
      projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: id,
      metadata: { requestId: id, requestKind: "member-removal", fileId: proof.fileId,
        configSetId: proof.configSetId, proofDigest: proof.proofDigest }
    }, input.traceId);
    return dto(row);
  });
}

export async function getCanonicalMemberRemovalForAuth(db: Database, auth: AuthContext,
  input: { projectId: string; requestId: string }): Promise<CanonicalMemberRemovalRequestDto | null> {
  await ownedProject(db, auth, input.projectId);
  if (!auth.user.isActive || !canViewParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter view access is required.");
  const row = await load(db, auth, input.projectId, input.requestId);
  if (!row) return null;
  if (row.submitter_user_id === auth.user.id) return dto(row);
  if (row.assigned_to_user_id === auth.user.id && canReviewParameters(auth)
    && canReviewParameterStage(auth, input.projectId, "software_review")
    && await hasCurrentCanonicalReviewRole(db, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    })) return dto(row);
  return null;
}

export async function listCanonicalMemberRemovalsForAuth(db: Database, auth: AuthContext,
  input: { projectId: string; status?: Status; mine?: boolean }): Promise<CanonicalMemberRemovalRequestDto[]> {
  await ownedProject(db, auth, input.projectId);
  if (!auth.user.isActive || !canViewParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter view access is required.");
  const reviewer = !input.mine && canReviewParameters(auth)
    && canReviewParameterStage(auth, input.projectId, "software_review")
    && await hasCurrentCanonicalReviewRole(db, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    });
  const rows = await db.query<Row>(`select * from public.project_parameter_value_change_requests
    where organization_id=$1 and project_id=$2 and request_kind='member-removal'
      and ($3::text is null or status=$3)
      and (submitter_user_id=$4 or ($5::boolean and assigned_to_user_id=$4))
    order by updated_at desc,id`, [auth.organization.id, input.projectId,
    input.status ?? null, auth.user.id, reviewer]);
  return rows.rows.map(dto);
}

export async function reviewCanonicalMemberRemoval(db: Database, storage: ObjectStore | undefined,
  auth: AuthContext,
  input: { projectId: string; requestId: string; decision: "approve" | "reject";
    proofDigest: string; note?: string | null } & Context): Promise<CanonicalMemberRemovalRequestDto> {
  await requireCanonicalUserInvocation(auth, security(input), {
    projectId: input.projectId, operation: `canonical member removal ${input.decision}`,
    targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  await ownedProject(db, auth, input.projectId);
  return db.transaction(async (tx) => {
    await currentReviewer(tx, auth, input.projectId, input, input.requestId);
    // Approval uses D's own request/source lock sequence. Do not pre-lock the row.
    const visible = await load(tx, auth, input.projectId, input.requestId);
    if (!visible) throw new ApiError("NOT_FOUND", "Member removal request was not found.");
    if (visible.submitter_user_id === auth.user.id || visible.assigned_to_user_id !== auth.user.id) {
      await recordCanonicalPermissionRefusal(security(input), {
        projectId: input.projectId, operation: "canonical member removal review",
        targetType: "project-parameter-value-change-request", targetId: input.requestId,
        details: { reason: "separate-assigned-reviewer-required" }
      });
      throw new ApiError("FORBIDDEN", "The separate assigned reviewer is required.");
    }
    if (visible.member_proof_digest !== input.proofDigest) {
      throw new ApiError("CONFLICT", "Member removal proof disagrees with the frozen request.", {
        reason: "canonical-member-removal-proof-mismatch"
      });
    }
    if (input.decision === "approve") {
      const pool = getRootPostgresPool(db);
      if (!storage || !pool) throw new ApiError("INTERNAL_ERROR", "Member removal approval requires source storage and Catalog.");
      const snapshot = await loadPublishedCatalog(pool);
      if (!snapshot) throw new ApiError("CONFLICT", "The published Catalog snapshot is unavailable.");
      await applyReviewedCanonicalMemberRemoval(tx, storage, auth, snapshot, {
        requestId: visible.id, submitterUserId: visible.submitter_user_id,
        reviewerUserId: visible.assigned_to_user_id, decision: "approve", frozen: visible.member_frozen_proof
      }, input);
      if (visible.status === "pending" && input.note) await tx.query(`update public.project_parameter_value_change_requests
        set reviewer_note=$2,updated_at=now() where id=$1 and status='approved'`, [visible.id, input.note]);
    } else {
      const locked = await load(tx, auth, input.projectId, input.requestId, true);
      if (!locked) throw new ApiError("NOT_FOUND", "Member removal request was not found.");
      if (locked.assigned_to_user_id !== auth.user.id || locked.submitter_user_id === auth.user.id
        || locked.member_proof_digest !== input.proofDigest) {
        throw new ApiError("CONFLICT", "Member removal assignment or proof changed.");
      }
      if (locked.status === "rejected" && locked.reviewer_user_id === auth.user.id) return dto(locked);
      if (locked.status !== "pending") throw new ApiError("CONFLICT", "Member removal request is already closed.");
      await tx.query(`update public.project_parameter_value_change_requests
        set status='rejected',reviewer_user_id=$2,reviewer_note=$3,updated_at=now()
        where id=$1 and status='pending'`, [locked.id, auth.user.id, input.note ?? null]);
      await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
        action: "value-change-reviewed", organizationId: auth.organization.id,
        projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: locked.id,
        metadata: { requestId: locked.id, requestKind: "member-removal", decision: "reject",
          proofDigest: locked.member_proof_digest }
      }, input.traceId);
    }
    return dto((await load(tx, auth, input.projectId, input.requestId))!);
  });
}

export async function withdrawCanonicalMemberRemoval(db: Database, auth: AuthContext,
  input: { projectId: string; requestId: string } & Context): Promise<CanonicalMemberRemovalRequestDto> {
  await requireCanonicalUserInvocation(auth, security(input), {
    projectId: input.projectId, operation: "canonical member removal withdraw",
    targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  await ownedProject(db, auth, input.projectId);
  return db.transaction(async (tx) => {
    const row = await load(tx, auth, input.projectId, input.requestId, true);
    if (!row) throw new ApiError("NOT_FOUND", "Member removal request was not found.");
    if (row.submitter_user_id !== auth.user.id) {
      await recordCanonicalPermissionRefusal(security(input), {
        projectId: input.projectId, operation: "canonical member removal withdraw",
        targetType: "project-parameter-value-change-request", targetId: input.requestId,
        details: { reason: "withdraw-not-submitter" }
      });
      throw new ApiError("FORBIDDEN", "Only the submitter can withdraw this member removal.");
    }
    if (row.status === "withdrawn") return dto(row);
    if (row.status !== "pending") throw new ApiError("CONFLICT", "Member removal request is already closed.");
    const withdrawn = (await tx.query<Row>(`update public.project_parameter_value_change_requests
      set status='withdrawn',reviewer_user_id=$2,updated_at=now()
      where id=$1 and status='pending' returning *`, [row.id, auth.user.id])).rows[0]!;
    await writeTrustedGovernanceAudit(asAuditTx(tx), input.invocation, {
      action: "value-change-withdrawn", organizationId: auth.organization.id,
      projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: row.id,
      metadata: { requestId: row.id, requestKind: "member-removal", proofDigest: row.member_proof_digest }
    }, input.traceId);
    return dto(withdrawn);
  });
}
