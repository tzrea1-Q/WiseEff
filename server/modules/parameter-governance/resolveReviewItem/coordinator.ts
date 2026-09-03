import { randomUUID } from "node:crypto";
import type pg from "pg";

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
  fingerprintResolvedItem,
  insertDraftProposal,
  insertResolution,
  insertSuccessAudit,
  loadEvidenceRecords,
  loadStoredResult,
  lockReviewItem,
  recordDurableRefusal,
  reserveIdempotency,
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
    principalId: command.context.actorKind === "org-admin" ? command.context.principalId : "",
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
    principalId: command.context.actorKind === "org-admin" ? command.context.principalId : "",
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
): Promise<Result<{ etag: string; allowedResolutions: readonly ReviewResolutionType[] }, GovernanceFailure>> => {
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
    command.context.actorKind === "org-admin" ? command.context.principalId : "";

  await insertSuccessAudit(client, {
    id: auditId,
    organizationId: command.organizationId,
    reviewItemId: command.reviewItemId,
    resolutionId,
    resolutionType: command.resolution,
    fingerprint,
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
