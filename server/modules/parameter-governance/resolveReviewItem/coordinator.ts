import { randomUUID } from "node:crypto";
import type pg from "pg";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { assertTrustedInvocationMatchesScope } from "../../auth/trustedInvocation";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { lockCatalogPointerForGovernance } from "../../parameter-modules/recognitionLock";

import {
  CatalogSubjectId,
  DefinitionProposalId,
  ReviewItemId,
  ReviewResolutionId,
  type ReviewResolutionType,
} from "../../parameter-catalog-contract/index";
import type { RegisterSubjectCommand, RestoreRegistrationCommand } from "../registration/command";
import { writeGuardedRegistration } from "../registration/internalGuardedRegistrationWriter";
import type { RegistrationResult } from "../registration/result";
import {
  groupReviewEvidence,
  projectReviewQueueItem,
} from "../review/group";
import { loadReviewObservationSource } from "../queries/reviewObservationSource";
import { fingerprintResolvedItem } from "../review/fingerprint";

import {
  fingerprintResolveReviewItemCommand,
  validateResolveReviewItemCommand,
  type ResolveReviewItemCommand,
} from "./command";
import {
  mapCoordinatorDatabaseError,
  mapRegistrationFailure,
  type GovernanceFailure,
} from "./failures";
import type { Result, ReviewResolutionResult } from "./result";
import {
  commitIdempotency,
  insertDraftProposal,
  insertResolution,
  insertSuccessAudit,
  loadEvidenceRecords,
  loadStoredResult,
  lockReviewItem,
  recordDurableRefusal,
  reserveIdempotency,
  reviewEvidenceSourceIsOwned,
  updateReviewItem,
  withReviewResolutionUnitOfWork,
  type ReviewItemRow,
} from "./unitOfWork";

export type ReviewItemResolver = {
  resolve(
    command: ResolveReviewItemCommand,
  ): Promise<Result<ReviewResolutionResult, GovernanceFailure>>;
};

const fail = (error: GovernanceFailure): Result<never, GovernanceFailure> => ({
  ok: false,
  error,
});

const allowedResolutionsFor = (reason: ReviewItemRow["reason"]): readonly ReviewResolutionType[] => {
  if (reason === "retired-registration-observed") {
    return ["restore-registration", "mark-out-of-scope"];
  }
  if (reason === "unknown") {
    return ["register-subject", "open-definition-proposal", "mark-out-of-scope"];
  }
  return ["register-subject", "mark-out-of-scope"];
};

const derivedRegistrationKey = (command: ResolveReviewItemCommand): string =>
  `review-resolution:${command.reviewItemId}:${command.idempotencyKey}`;

const toRegisterCommand = (
  command: Extract<ResolveReviewItemCommand, { resolution: "register-subject" }>,
): RegisterSubjectCommand => ({
  kind: "register",
  organizationId: command.organizationId,
  subjectId: command.subjectId,
  subjectKind: command.subjectKind,
  expectedRelease: command.expectedRelease,
  placement: command.placement,
  destinationModuleId: command.destinationModuleId,
  method: "review",
  proof: command.proof ?? {
    reviewItemId: command.reviewItemId,
    reason: command.reason,
  },
  idempotencyKey: derivedRegistrationKey(command),
  context: {
    actorKind: "review-coordinator",
    principalId: "principalId" in command.context ? command.context.principalId : "",
  },
});

const toRestoreCommand = (
  command: Extract<ResolveReviewItemCommand, { resolution: "restore-registration" }>,
): RestoreRegistrationCommand => ({
  kind: "restore",
  organizationId: command.organizationId,
  registrationId: command.registrationId,
  expectedRelease: command.expectedRelease,
  idempotencyKey: derivedRegistrationKey(command),
  context: {
    actorKind: "review-coordinator",
    principalId: "principalId" in command.context ? command.context.principalId : "",
  },
  reason: command.reason,
});

const refuse = async (
  pool: pg.Pool,
  command: ResolveReviewItemCommand,
  error: GovernanceFailure,
): Promise<Result<never, GovernanceFailure>> => {
  await recordDurableRefusal(pool, command.organizationId, error, command.reviewItemId);
  return fail(error);
};

const projectLockedItem = async (
  client: Parameters<typeof loadEvidenceRecords>[0],
  item: ReviewItemRow,
  command: ResolveReviewItemCommand,
): Promise<Result<{ etag: string; allowedResolutions: ReturnType<typeof projectReviewQueueItem>["allowedResolutions"] }, GovernanceFailure>> => {
  const records = await loadEvidenceRecords(client, command.organizationId);
  const grouped = groupReviewEvidence(records, command.expectedRelease, {
    existingOpenItems: [
      { id: item.id, groupingFingerprint: item.evidence_fingerprint },
    ],
  });
  if (!grouped.ok) {
    return fail({ kind: "invalid-command", reason: grouped.error.kind });
  }
  const group = grouped.value.find(
    (entry) =>
      entry.existingItemId === item.id ||
      entry.groupingFingerprint === item.evidence_fingerprint,
  );
  if (!group) {
    return fail({
      kind: "revision-conflict",
      reviewItemId: item.id,
      storedEtag: "",
      attemptedEtag: command.etag,
    });
  }
  for (const evidence of group.evidence) {
    const source = evidence.observationId
      ? await loadReviewObservationSource(client, command.organizationId, evidence.observationId) : null;
    if ((evidence.observationId && (!source || source.catalogReleaseId !== evidence.evidence.catalogReleaseId
      || source.matcherRevision !== evidence.evidence.matcherRevision))
      || !await reviewEvidenceSourceIsOwned(client, command.organizationId, evidence.evidence.payload, source?.references)) {
      return fail({ kind: "invalid-command", reason: "source-evidence-not-owned" });
    }
  }
  const projected = projectReviewQueueItem(group, {
    capturedRelease: command.expectedRelease,
    candidateState: { status: "current", capturedRelease: command.expectedRelease },
    persisted: {
      id: ReviewItemId(item.id),
      etagVersion: Number(item.etag_version),
    },
  });
  return {
    ok: true,
    value: {
      etag: projected.etag,
      allowedResolutions: projected.allowedResolutions,
    },
  };
};

const executeResolution = async (
  client: Parameters<typeof loadEvidenceRecords>[0],
  command: ResolveReviewItemCommand,
  fingerprint: string,
): Promise<Result<ReviewResolutionResult, GovernanceFailure>> => {
  const reserved = await reserveIdempotency(client, command, fingerprint);
  if (reserved.request_fingerprint !== fingerprint) {
    return fail({
      kind: "revision-conflict",
      idempotencyKey: command.idempotencyKey,
      storedFingerprint: reserved.request_fingerprint,
      attemptedFingerprint: fingerprint,
    });
  }
  if (reserved.state === "committed" && reserved.result_ref) {
    if (reserved.result_kind === "review-reopen")
      return { ok: true, value: { ...JSON.parse(reserved.result_ref) as ReviewResolutionResult, outcome: "replayed" } };
    const stored = await loadStoredResult(client, command, reserved.result_ref, fingerprint);
    if (!stored) {
      return fail({ kind: "review-item-not-found", reviewItemId: command.reviewItemId });
    }
    return { ok: true, value: stored };
  }

  const item = await lockReviewItem(client, command.organizationId, command.reviewItemId);
  if (!item) {
    return fail({ kind: "review-item-not-found", reviewItemId: command.reviewItemId });
  }
  if (command.resolution === "reopen-out-of-scope") return reopenReviewItem(client, item, command, fingerprint);
  if (item.status !== "open") {
    return fail({
      kind: "revision-conflict",
      reviewItemId: item.id,
      status: item.status,
    });
  }

  const projected = await projectLockedItem(client, item, command);
  if (!projected.ok) return projected;
  if (projected.value.etag !== command.etag) {
    return fail({
      kind: "revision-conflict",
      reviewItemId: item.id,
      storedEtag: projected.value.etag,
      attemptedEtag: command.etag,
    });
  }
  if (command.reason !== item.reason) {
    return fail({ kind: "invalid-command", reason: "reason" });
  }
  const allowed = projected.value.allowedResolutions.length
    ? projected.value.allowedResolutions
    : allowedResolutionsFor(item.reason);
  if (!allowed.includes(command.resolution)) {
    return fail({ kind: "invalid-command", reason: "resolution" });
  }

  let registration: RegistrationResult | undefined;
  let proposalId: string | undefined;
  if (command.resolution === "register-subject") {
    const written = await writeGuardedRegistration(client, toRegisterCommand(command));
    if (!written.ok) return fail(mapRegistrationFailure(written.error));
    registration = written.value;
  } else if (command.resolution === "restore-registration") {
    const written = await writeGuardedRegistration(client, toRestoreCommand(command));
    if (!written.ok) return fail(mapRegistrationFailure(written.error));
    registration = written.value;
  } else if (command.resolution === "open-definition-proposal") {
    proposalId = await insertDraftProposal(client, command);
  }

  const resolutionId = `prsl_${randomUUID()}`;
  const auditId = `aud_${randomUUID()}`;
  const afterVersion = Number(item.etag_version) + 1;
  const nextStatus = command.resolution === "mark-out-of-scope" ? "out-of-scope" : "resolved";
  const afterEtag = fingerprintResolvedItem({
    id: item.id,
    etagVersion: afterVersion,
    status: nextStatus,
    groupingFingerprint: item.evidence_fingerprint,
    catalogReleaseId: item.catalog_release_id,
    matcherRevision: item.matcher_revision,
    reason: item.reason,
    resolutionId,
  });
  const principalId =
    "principalId" in command.context ? command.context.principalId : "";

  await insertSuccessAudit(client, {
    id: auditId,
    organizationId: command.organizationId,
    reviewItemId: command.reviewItemId,
    resolutionId,
    resolutionType: command.resolution,
    fingerprint,
    principalId,
    ...(registration?.cascadedRegistrations ? { cascadedRegistrations: registration.cascadedRegistrations } : {}),
    invocation: command.invocation,
    requestId: command.requestId,
  });
  await insertResolution(client, {
    id: resolutionId,
    reviewItemId: command.reviewItemId,
    resolutionType: command.resolution,
    beforeEtagVersion: Number(item.etag_version),
    afterEtagVersion: afterVersion,
    principalId,
    capturedReleaseId: command.expectedRelease.id,
    requestFingerprint: fingerprint,
    registrationId: registration?.registrationId ?? null,
    proposalId: proposalId ?? null,
    outOfScopeReason:
      command.resolution === "mark-out-of-scope" ? command.outOfScopeReason : null,
    successAuditRef: auditId,
  });
  await updateReviewItem(client, command.reviewItemId, nextStatus, resolutionId, afterVersion);
  await commitIdempotency(client, command, resolutionId);

  const committed: ReviewResolutionResult = {
    outcome: "committed",
    reviewItemId: ReviewItemId(command.reviewItemId),
    resolutionId: ReviewResolutionId(resolutionId),
    resolutionType: command.resolution,
    organizationId: command.organizationId,
    status: nextStatus,
    etag: afterEtag,
    beforeEtag: command.etag,
    release: command.expectedRelease,
    idempotencyKey: command.idempotencyKey,
    fingerprint,
    successAuditRef: auditId,
  };
  if (registration) {
    return {
      ok: true,
      value: {
        ...committed,
        registrationId: registration.registrationId,
        placementId: registration.placementId,
        subjectId: CatalogSubjectId(registration.subjectId),
      },
    };
  }
  if (proposalId) {
    return {
      ok: true,
      value: {
        ...committed,
        proposalId: DefinitionProposalId(proposalId),
      },
    };
  }
  return { ok: true, value: committed };
};

async function reopenReviewItem(
  client: Parameters<typeof loadEvidenceRecords>[0],
  item: ReviewItemRow,
  command: Extract<ResolveReviewItemCommand, { resolution: "reopen-out-of-scope" }>,
  fingerprint: string,
): Promise<Result<ReviewResolutionResult, GovernanceFailure>> {
  const invocation = command.invocation;
  if (!invocation || !command.requestId || !("principalId" in command.context) ||
      invocation.principal.user.id !== command.context.principalId)
    return fail({ kind: "permission-denied", actorKind: command.context.actorKind });
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, command.organizationId, "review item reopen");
  await lockCatalogPointerForGovernance(client);
  const current = await readCurrentCatalogPointer(client);
  if (current.kind !== "installed" || current.current.id !== command.expectedRelease.id || current.current.digest !== command.expectedRelease.digest)
    return fail({ kind: "release-drift", code: "PCAT-GUARD-RELEASE-MISMATCH", sqlstate: "PCA01", expected: command.expectedRelease });
  if (item.status !== "out-of-scope" || !item.current_resolution_id || item.catalog_release_id !== current.current.id)
    return fail({ kind: "revision-conflict", reviewItemId: item.id, storedEtag: "", attemptedEtag: command.etag });
  const etag = fingerprintResolvedItem({ id: item.id, etagVersion: Number(item.etag_version),
    status: item.status, groupingFingerprint: item.evidence_fingerprint, catalogReleaseId: item.catalog_release_id,
    matcherRevision: item.matcher_revision, reason: item.reason, resolutionId: item.current_resolution_id });
  if (etag !== command.etag) return fail({ kind: "revision-conflict", reviewItemId: item.id, storedEtag: etag, attemptedEtag: command.etag });
  const original = await client.query<{ out_of_scope_reason: string }>(`select out_of_scope_reason
    from parameter_catalog.parameter_review_resolutions
    where id=$1 and review_item_id=$2 and resolution_type='mark-out-of-scope'`, [item.current_resolution_id, item.id]);
  if (!original.rows[0]) return fail({ kind: "invalid-command", reason: "original-out-of-scope-verdict" });
  const projected = await projectLockedItem(client, item, command);
  if (!projected.ok) return projected;
  const reopenedReviewItemId = ReviewItemId(`prit_${randomUUID()}`);
  const inserted = await client.query(`insert into parameter_catalog.parameter_review_items
    (id, organization_id, evidence_fingerprint, matcher_revision, catalog_release_id, reason, status, etag_version, reopened_from_item_id, reopen_reason)
    values ($1,$2,$3,$4,$5,$6,'open',1,$7,$8) on conflict do nothing`,
  [reopenedReviewItemId, item.organization_id, item.evidence_fingerprint, item.matcher_revision, item.catalog_release_id,
    item.reason, item.id, command.correctionReason]);
  if (!inserted.rowCount) return fail({ kind: "revision-conflict", reviewItemId: item.id, status: item.status });

  const auditId = `aud_${randomUUID()}`;
  await writeAuditEventInTx(asAuditTx(client), invocation, { requestId: command.requestId }, {
    id: auditId, app: "parameter-governance", kind: "parameter-catalog-governance", action: "review-item-reopened", severity: "Medium",
    projectId: null, targetType: "review-item", targetId: item.id,
    metadata: { originalResolutionId: item.current_resolution_id, originalVerdict: "mark-out-of-scope", originalReason: original.rows[0].out_of_scope_reason,
      reason: command.correctionReason, reopenedReviewItemId, catalogReleaseId: item.catalog_release_id },
  });
  const result: ReviewResolutionResult = {
    outcome: "committed", reviewItemId: ReviewItemId(item.id), resolutionId: ReviewResolutionId(item.current_resolution_id),
    resolutionType: command.resolution, organizationId: item.organization_id, status: item.status, etag, beforeEtag: command.etag,
    release: command.expectedRelease, idempotencyKey: command.idempotencyKey, fingerprint, successAuditRef: auditId, reopenedReviewItemId,
  };
  await commitIdempotency(client, command, JSON.stringify(result), "review-reopen");
  return { ok: true, value: result };
}

export const resolveReviewItem = async (
  pool: pg.Pool,
  command: ResolveReviewItemCommand,
): Promise<Result<ReviewResolutionResult, GovernanceFailure>> => {
  const validated = validateResolveReviewItemCommand(command);
  if (!validated.ok) {
    await recordDurableRefusal(
      pool,
      command.organizationId,
      validated.error,
      command.reviewItemId,
    ).catch(() => undefined);
    return validated;
  }
  const fingerprint = fingerprintResolveReviewItemCommand(validated.value);
  try {
    const result = await withReviewResolutionUnitOfWork(pool, (client) =>
      executeResolution(client, validated.value, fingerprint),
    );
    if (!result.ok) {
      return refuse(pool, validated.value, result.error);
    }
    return result;
  } catch (error) {
    const subjectId =
      validated.value.resolution === "register-subject"
        ? validated.value.subjectId
        : validated.value.reviewItemId;
    const mapped = mapCoordinatorDatabaseError(
      error,
      validated.value.expectedRelease,
      subjectId,
    );
    if (mapped) {
      return refuse(pool, validated.value, mapped);
    }
    throw error;
  }
};

export const createReviewItemResolver = (pool: pg.Pool): ReviewItemResolver => ({
  resolve: (command) => resolveReviewItem(pool, command),
});
