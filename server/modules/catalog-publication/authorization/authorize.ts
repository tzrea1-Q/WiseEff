/**
 * Catalog publication authorization seam (CP-04).
 *
 * Callers must SET ROLE catalog_publication_coordinator_role for candidate
 * SELECT and authorization INSERT. This module does not GRANT EXECUTE on
 * revise_publication_policy and does not take the catalog exclusive lock.
 *
 * CP-05 lock order: catalog exclusive lock THEN publication_guard. Do not
 * UPDATE insert-only authorization tables to lock them.
 */
import { randomUUID } from "node:crypto";

import {
  assertTrustedInvocationContext,
  type TrustedInvocationContext,
} from "../../auth/trustedInvocation";
import type { BackendPermission } from "../../auth/types";
import {
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalRevisionId,
  PublicationAuthorizationId,
  PublicationPolicyRevision,
} from "../../parameter-catalog-contract/index";
import type { Queryable } from "../../../shared/database/client";
import { PUBLICATION_GUARD_FUNCTION_IDENTITY } from "../../catalog-kernel/security/catalogRoleManifest";
import { appendAuthorization, getCandidate, getPolicy } from "../persistence/store";
import type {
  PublicationAuthorizationRecord,
  PublicationCandidateRecord,
} from "../persistence/types";
import { classifyImpact } from "./classify";
import type {
  AuthorizationCandidateTuple,
  AuthorizePublishInput,
  AuthorizedPublication,
  ImpactFacts,
  PublicationAuthorizationFailure,
  PublicationAuthorizationResult,
  PublicationRiskClass,
  RevokeAuthorizationInput,
  RevokedPublicationAuthorization,
  VerifiedPublicationAuthorization,
  VerifyAuthorizationForActivationInput,
} from "./types";

const fail = (
  reason: PublicationAuthorizationFailure["reason"],
  detail?: string,
): PublicationAuthorizationResult<never> => ({
  ok: false,
  error: detail ? { reason, detail } : { reason },
});

const hasPermission = (
  actor: TrustedInvocationContext,
  permission: BackendPermission,
): boolean => {
  const trusted = assertTrustedInvocationContext(actor);
  if (trusted.initiator === "system") {
    return false;
  }
  return trusted.principal.permissions.includes(permission);
};

const realUserPrincipalId = (actor: TrustedInvocationContext): string | null => {
  const trusted = assertTrustedInvocationContext(actor);
  if (trusted.initiator !== "user") {
    return null;
  }
  if (!trusted.principal.user.isActive) {
    return null;
  }
  return trusted.principal.user.id;
};

const authorPrincipalIdFromCandidate = (
  candidate: PublicationCandidateRecord,
  impactFacts?: ImpactFacts,
): string | null => {
  if (impactFacts?.authorPrincipalId) {
    return impactFacts.authorPrincipalId;
  }
  const allocated = candidate.identityAllocation.authorPrincipalId;
  return typeof allocated === "string" && allocated.trim().length > 0 ? allocated : null;
};

const capabilityContractDigest = async (
  db: Queryable,
  candidateId: CatalogCandidateId,
): Promise<string | null> => {
  const digest = await db.query<{ digest: string }>(
    `select catalog_publication.digest_jsonb(capability_contract) as digest
     from catalog_publication.candidates
     where id = $1`,
    [candidateId],
  );
  return digest.rows[0]?.digest ?? null;
};

const tupleMatchesCandidate = (
  candidate: PublicationCandidateRecord,
  tuple: AuthorizationCandidateTuple,
  capabilityDigest: string,
): boolean =>
  candidate.id === tuple.candidateId &&
  candidate.artifactDigest === tuple.artifactDigest &&
  candidate.expectedBaseReleaseId === tuple.expectedBaseReleaseId &&
  candidate.expectedBaseReleaseDigest === tuple.expectedBaseReleaseDigest &&
  (candidate.proposalRevisionId ?? null) === (tuple.proposalRevisionId ?? null) &&
  candidate.impactReportDigest === tuple.impactReportDigest &&
  capabilityDigest === tuple.capabilityContractDigest;

const acquirePublicationGuard = async (db: Queryable): Promise<void> => {
  await db.query(`select ${PUBLICATION_GUARD_FUNCTION_IDENTITY}`);
};

const loadAuthorization = async (
  db: Queryable,
  authorizationId: PublicationAuthorizationId,
): Promise<PublicationAuthorizationRecord | null> => {
  const result = await db.query<{
    id: string;
    event_kind: "approve" | "revoke";
    candidate_id: string;
    artifact_digest: string;
    expected_base_release_id: string;
    expected_base_release_digest: string;
    proposal_revision_id: string | null;
    impact_report_digest: string;
    capability_contract_digest: string;
    policy_revision: string | number;
    actor_principal_id: string;
    approved_authorization_id: string | null;
    created_at: Date | string;
  }>(
    `select
       id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
       expected_base_release_digest, proposal_revision_id, impact_report_digest,
       capability_contract_digest, policy_revision, actor_principal_id,
       approved_authorization_id, created_at
     from catalog_publication.publication_authorizations
     where id = $1`,
    [authorizationId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: PublicationAuthorizationId(row.id),
    eventKind: row.event_kind,
    candidateId: CatalogCandidateId(row.candidate_id),
    artifactDigest: row.artifact_digest,
    expectedBaseReleaseId: CatalogReleaseId(row.expected_base_release_id),
    expectedBaseReleaseDigest: CatalogReleaseDigest(row.expected_base_release_digest),
    proposalRevisionId: row.proposal_revision_id
      ? DefinitionProposalRevisionId(row.proposal_revision_id)
      : null,
    impactReportDigest: row.impact_report_digest,
    capabilityContractDigest: row.capability_contract_digest,
    policyRevision: PublicationPolicyRevision(Number(row.policy_revision)),
    actorPrincipalId: row.actor_principal_id,
    approvedAuthorizationId: row.approved_authorization_id
      ? PublicationAuthorizationId(row.approved_authorization_id)
      : null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
};

const revokeExistsFor = async (
  db: Queryable,
  approvedAuthorizationId: PublicationAuthorizationId,
): Promise<boolean> => {
  const result = await db.query<{ exists: boolean }>(
    `select exists (
       select 1
       from catalog_publication.publication_authorizations
       where event_kind = 'revoke'
         and approved_authorization_id = $1
     ) as exists`,
    [approvedAuthorizationId],
  );
  return result.rows[0]?.exists === true;
};

const evaluateApprovalGate = (input: {
  riskClass: PublicationRiskClass;
  actor: TrustedInvocationContext;
  authorPrincipalId: string;
  publicationEnabled: boolean;
  lowRiskSingleActorPublish: boolean;
}): PublicationAuthorizationFailure | null => {
  if (!input.publicationEnabled) {
    return { reason: "publication-policy-disabled" };
  }

  const actorId = realUserPrincipalId(input.actor);
  if (actorId === null) {
    if (assertTrustedInvocationContext(input.actor).initiator !== "user") {
      return {
        reason: "publication-not-authorized",
        detail: "worker, agent, and service accounts cannot approve publication",
      };
    }
    return { reason: "publication-capability-missing", detail: "actor is inactive" };
  }

  if (input.riskClass === "high") {
    if (actorId === input.authorPrincipalId) {
      return { reason: "publication-self-approval-forbidden" };
    }
    if (!hasPermission(input.actor, "catalog:review-high-risk")) {
      return { reason: "publication-capability-missing" };
    }
    return null;
  }

  if (actorId === input.authorPrincipalId) {
    if (!input.lowRiskSingleActorPublish) {
      return { reason: "publication-self-approval-forbidden" };
    }
    if (!hasPermission(input.actor, "catalog:publish")) {
      return { reason: "publication-capability-missing" };
    }
    return null;
  }

  if (
    !hasPermission(input.actor, "catalog:publish") &&
    !hasPermission(input.actor, "catalog:review-high-risk")
  ) {
    return { reason: "publication-capability-missing" };
  }
  return null;
};

export async function authorizePublish(
  db: Queryable,
  input: AuthorizePublishInput,
): Promise<PublicationAuthorizationResult<AuthorizedPublication>> {
  assertTrustedInvocationContext(input.trustedActor);
  void input.untrustedRequest;

  const classified = classifyImpact(input.impactFacts);
  if (!classified.ok) {
    return classified;
  }

  const candidate = await getCandidate(db, input.candidate.candidateId);
  if (!candidate.ok) {
    if (candidate.error.kind === "not-found") {
      return fail("candidate-stale", "candidate not found");
    }
    return fail("publication-not-authorized", candidate.error.kind);
  }

  const digest = await capabilityContractDigest(db, candidate.value.id);
  if (digest === null) {
    return fail("candidate-tampered", "capability contract digest missing");
  }
  if (!tupleMatchesCandidate(candidate.value, input.candidate, digest)) {
    return fail("candidate-tampered", "authorization tuple does not match candidate");
  }

  const allocatedAuthor = authorPrincipalIdFromCandidate(candidate.value, input.impactFacts);
  if (allocatedAuthor === null || allocatedAuthor !== input.impactFacts.authorPrincipalId) {
    return fail("candidate-tampered", "candidate author does not match impact facts");
  }

  const policy = await getPolicy(db);
  if (!policy.ok) {
    return fail("publication-policy-disabled", "publication policy is missing");
  }
  if (policy.value.revision !== input.policyRevision) {
    return fail("candidate-stale", "policy revision does not match current policy");
  }

  const gate = evaluateApprovalGate({
    riskClass: classified.value,
    actor: input.trustedActor,
    authorPrincipalId: input.impactFacts.authorPrincipalId,
    publicationEnabled: policy.value.publicationEnabled,
    lowRiskSingleActorPublish: policy.value.lowRiskSingleActorPublish,
  });
  if (gate) {
    return { ok: false, error: gate };
  }

  const actorId = realUserPrincipalId(input.trustedActor);
  if (actorId === null) {
    return fail("publication-not-authorized");
  }

  const appended = await appendAuthorization(db, {
    id: PublicationAuthorizationId(`cauth_${randomUUID()}`),
    eventKind: "approve",
    candidateId: candidate.value.id,
    artifactDigest: candidate.value.artifactDigest,
    expectedBaseReleaseId: candidate.value.expectedBaseReleaseId,
    expectedBaseReleaseDigest: candidate.value.expectedBaseReleaseDigest,
    proposalRevisionId: candidate.value.proposalRevisionId,
    impactReportDigest: candidate.value.impactReportDigest,
    capabilityContractDigest: digest,
    policyRevision: policy.value.revision,
    actorPrincipalId: actorId,
    approvedAuthorizationId: null,
  });
  if (!appended.ok) {
    return fail("publication-not-authorized", appended.error.kind);
  }

  return {
    ok: true,
    value: {
      authorization: appended.value,
      candidate: candidate.value,
      policy: policy.value,
      riskClass: classified.value,
    },
  };
}

export async function revokeAuthorization(
  db: Queryable,
  input: RevokeAuthorizationInput,
): Promise<PublicationAuthorizationResult<RevokedPublicationAuthorization>> {
  assertTrustedInvocationContext(input.trustedActor);
  const actorId = realUserPrincipalId(input.trustedActor);
  if (actorId === null) {
    return fail(
      "publication-not-authorized",
      "revoke requires a real user principal",
    );
  }

  if (input.lockMode === "publication-guard") {
    await acquirePublicationGuard(db);
  }

  const approved = await loadAuthorization(db, input.approvedAuthorizationId);
  if (!approved || approved.eventKind !== "approve") {
    return fail("publication-not-authorized", "approve authorization not found");
  }
  if (approved.candidateId !== input.candidateId) {
    return fail(
      "publication-not-authorized",
      "revoke must point at the same candidate as the approve",
    );
  }

  const candidate = await getCandidate(db, input.candidateId);
  if (!candidate.ok) {
    return fail("candidate-stale", "candidate not found");
  }

  const revoked = await appendAuthorization(db, {
    id: PublicationAuthorizationId(`cauth_${randomUUID()}`),
    eventKind: "revoke",
    candidateId: approved.candidateId,
    artifactDigest: approved.artifactDigest,
    expectedBaseReleaseId: approved.expectedBaseReleaseId,
    expectedBaseReleaseDigest: approved.expectedBaseReleaseDigest,
    proposalRevisionId: approved.proposalRevisionId,
    impactReportDigest: approved.impactReportDigest,
    capabilityContractDigest: approved.capabilityContractDigest,
    policyRevision: approved.policyRevision,
    actorPrincipalId: actorId,
    approvedAuthorizationId: approved.id,
  });
  if (!revoked.ok) {
    return fail("publication-not-authorized", revoked.error.kind);
  }

  return {
    ok: true,
    value: {
      revocation: revoked.value,
      approvedAuthorizationId: approved.id,
    },
  };
}

export async function verifyAuthorizationForActivation(
  db: Queryable,
  input: VerifyAuthorizationForActivationInput,
): Promise<PublicationAuthorizationResult<VerifiedPublicationAuthorization>> {
  assertTrustedInvocationContext(input.trustedActor);

  if (input.lockMode === "publication-guard") {
    await acquirePublicationGuard(db);
  }

  const authorization = await loadAuthorization(db, input.authorizationId);
  if (!authorization || authorization.eventKind !== "approve") {
    return fail("publication-not-authorized", "approve authorization not found");
  }
  if (authorization.candidateId !== input.candidateId) {
    return fail("candidate-tampered", "authorization candidate does not match");
  }

  if (await revokeExistsFor(db, authorization.id)) {
    return fail("publication-authorization-revoked");
  }

  const candidate = await getCandidate(db, input.candidateId);
  if (!candidate.ok) {
    return fail("candidate-stale", "candidate not found");
  }

  const digest = await capabilityContractDigest(db, candidate.value.id);
  if (
    digest === null ||
    authorization.artifactDigest !== candidate.value.artifactDigest ||
    authorization.expectedBaseReleaseId !== candidate.value.expectedBaseReleaseId ||
    authorization.expectedBaseReleaseDigest !== candidate.value.expectedBaseReleaseDigest ||
    (authorization.proposalRevisionId ?? null) !== (candidate.value.proposalRevisionId ?? null) ||
    authorization.impactReportDigest !== candidate.value.impactReportDigest ||
    authorization.capabilityContractDigest !== digest
  ) {
    return fail("candidate-tampered", "authorization tuple no longer matches candidate");
  }

  const policy = await getPolicy(db);
  if (!policy.ok) {
    return fail("publication-policy-disabled", "publication policy is missing");
  }
  if (policy.value.revision !== authorization.policyRevision) {
    return fail("candidate-stale", "policy revision is no longer applicable");
  }

  let riskClass: PublicationRiskClass = "high";
  if (input.impactFacts) {
    const classified = classifyImpact(input.impactFacts);
    if (!classified.ok) {
      return classified;
    }
    riskClass = classified.value;
  } else {
    const authorId = authorPrincipalIdFromCandidate(candidate.value);
    riskClass =
      authorId !== null && authorization.actorPrincipalId === authorId ? "low" : "high";
  }

  const authorPrincipalId =
    input.impactFacts?.authorPrincipalId ??
    authorPrincipalIdFromCandidate(candidate.value) ??
    authorization.actorPrincipalId;

  const gate = evaluateApprovalGate({
    riskClass,
    actor: input.trustedActor,
    authorPrincipalId,
    publicationEnabled: policy.value.publicationEnabled,
    lowRiskSingleActorPublish: policy.value.lowRiskSingleActorPublish,
  });
  if (gate) {
    return { ok: false, error: gate };
  }

  const actorId = realUserPrincipalId(input.trustedActor);
  if (actorId === null || actorId !== authorization.actorPrincipalId) {
    return fail(
      "publication-capability-missing",
      "execute-time actor snapshot is not the original approver",
    );
  }

  return {
    ok: true,
    value: {
      authorization,
      candidate: candidate.value,
      policy: policy.value,
      riskClass,
    },
  };
}
