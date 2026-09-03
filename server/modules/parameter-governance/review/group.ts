import {
  CatalogReleaseId,
  ReviewEvidenceId,
  ReviewItemEtag,
  ReviewItemId,
  type CatalogReleasePin,
  type ContractJsonValue,
  type ReviewReason,
  type ReviewResolutionType,
} from "../../parameter-catalog-contract/index";

import {
  fingerprintCanonical,
  groupingIdentityKey,
  reviewGroupFingerprintModel,
} from "./fingerprint";
import type {
  GroupedReview,
  GroupReviewEvidenceOptions,
  ProjectReviewQueueItemInput,
  Result,
  ReviewEvidenceRecord,
  ReviewQueueFailure,
  ReviewQueueItem,
} from "./types";

const reviewReasons = new Set<ReviewReason>([
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed",
]);

const allowedResolutionsFor = (reason: ReviewReason): readonly ReviewResolutionType[] => {
  if (reason === "retired-registration-observed") {
    return ["restore-registration", "mark-out-of-scope"];
  }
  if (reason === "unknown") {
    return ["register-subject", "open-definition-proposal", "mark-out-of-scope"];
  }
  return ["register-subject", "mark-out-of-scope"];
};

const compareById = (left: ReviewEvidenceRecord, right: ReviewEvidenceRecord): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export const groupReviewEvidence = (
  records: readonly ReviewEvidenceRecord[],
  capturedRelease: CatalogReleasePin,
  options: GroupReviewEvidenceOptions = {},
): Result<readonly GroupedReview[], ReviewQueueFailure> => {
  const existing = options.existingOpenItems ?? [];
  const existingByFingerprint = new Map<string, string[]>();
  for (const item of existing) {
    const ids = existingByFingerprint.get(item.groupingFingerprint) ?? [];
    ids.push(item.id);
    existingByFingerprint.set(item.groupingFingerprint, ids);
  }
  for (const [groupingFingerprint, ids] of existingByFingerprint) {
    if (new Set(ids).size > 1) {
      return {
        ok: false,
        error: {
          kind: "duplicate-group",
          organizationId: records[0]?.organizationId ?? "",
          groupingFingerprint,
        },
      };
    }
  }

  const buckets = new Map<string, ReviewEvidenceRecord[]>();
  const models = new Map<string, GroupedReview>();
  for (const record of records) {
    const body = record.evidence;
    if (body.catalogReleaseId !== capturedRelease.id) continue;
    if (!reviewReasons.has(record.reason) && !reviewReasons.has(body.reason)) continue;
    const reason = reviewReasons.has(record.reason) ? record.reason : body.reason;
    const rClass = record.rClass ?? body.rClass;
    const identityKey = groupingIdentityKey(body.sourceIdentity, body.payload);
    const model = reviewGroupFingerprintModel({
      organizationId: record.organizationId,
      matcherRevision: body.matcherRevision,
      catalogReleaseId: body.catalogReleaseId,
      reason,
      rClass,
      identityKey,
    });
    const groupingFingerprint = fingerprintCanonical(model as unknown as ContractJsonValue);
    const bucket = buckets.get(groupingFingerprint) ?? [];
    bucket.push(record);
    buckets.set(groupingFingerprint, bucket);
    if (!models.has(groupingFingerprint)) {
      const existingIds = existingByFingerprint.get(groupingFingerprint) ?? [];
      models.set(groupingFingerprint, {
        groupingFingerprint,
        identityKey,
        organizationId: record.organizationId,
        matcherRevision: body.matcherRevision,
        catalogReleaseId: body.catalogReleaseId,
        reason,
        rClass,
        evidence: [],
        existingItemId: existingIds[0] ?? null,
      });
    }
  }

  const grouped: GroupedReview[] = [];
  for (const [groupingFingerprint, evidence] of buckets) {
    const model = models.get(groupingFingerprint);
    if (!model) continue;
    grouped.push({
      ...model,
      evidence: [...evidence].sort(compareById),
    });
  }

  grouped.sort((left, right) => {
    if (left.reason !== right.reason) return left.reason < right.reason ? -1 : 1;
    if (left.identityKey !== right.identityKey) {
      return left.identityKey < right.identityKey ? -1 : 1;
    }
    return left.groupingFingerprint < right.groupingFingerprint ? -1 : 1;
  });
  return { ok: true, value: grouped };
};

export const reviewItemIdFor = (groupingFingerprint: string): ReviewItemId => {
  const hex = groupingFingerprint.startsWith("sha256:")
    ? groupingFingerprint.slice("sha256:".length)
    : groupingFingerprint;
  return ReviewItemId(`prit_${hex}`);
};

export const projectReviewQueueItem = (
  group: GroupedReview,
  input: ProjectReviewQueueItemInput,
): ReviewQueueItem => {
  const evidenceRefs = group.evidence.map((record) => ({
    id: ReviewEvidenceId(record.id),
    candidateSafeDigest: record.candidateSafeDigest,
    reason: record.reason,
    rClass: record.rClass,
  }));
  const etagModel = {
    kind: "review-item-etag",
    id: input.persisted.id,
    etagVersion: input.persisted.etagVersion,
    groupingFingerprint: group.groupingFingerprint,
    status: "open",
    catalogReleaseId: group.catalogReleaseId,
    matcherRevision: group.matcherRevision,
    reason: group.reason,
    rClass: group.rClass,
    identityKey: group.identityKey,
    candidateState: input.candidateState.status,
    capturedReleaseId: input.capturedRelease.id,
    capturedReleaseDigest: input.capturedRelease.digest,
    evidence: evidenceRefs.map((ref) => ({
      id: ref.id,
      candidateSafeDigest: ref.candidateSafeDigest,
    })),
  };
  return {
    id: input.persisted.id,
    organizationId: group.organizationId,
    status: "open",
    reason: group.reason,
    rClass: group.rClass,
    identityKey: group.identityKey,
    matcherRevision: group.matcherRevision,
    catalogReleaseId: CatalogReleaseId(group.catalogReleaseId),
    groupingFingerprint: group.groupingFingerprint,
    etag: ReviewItemEtag(fingerprintCanonical(etagModel as unknown as ContractJsonValue)),
    candidateState: input.candidateState,
    evidenceCount: group.evidence.length,
    evidenceRefs,
    allowedResolutions: allowedResolutionsFor(group.reason),
  };
};
