import type {
  CatalogReleaseId,
  CatalogReleasePin,
  LegacyRowClass,
  Result,
  ReviewEvidenceId,
  ReviewItemEtag,
  ReviewItemId,
  ReviewReason,
  ReviewResolutionType,
} from "../../parameter-catalog-contract/index";

export type { Result };

export type ReviewQueueTrustedContext =
  | {
      readonly actorKind: "org-admin";
      readonly principalId: string;
      readonly organizationId: string;
    }
  | {
      readonly actorKind: "org-member";
      readonly principalId: string;
      readonly organizationId: string;
    }
  | {
      readonly actorKind: "platform-admin";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "trusted-system";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "agent";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "anonymous";
    };

export type ReviewEvidencePayload = {
  readonly [key: string]: unknown;
};

export type StoredReviewEvidenceBody = {
  readonly sourceIdentity: string;
  readonly catalogReleaseId: string;
  readonly matcherRevision: string;
  readonly matcherOutput: string;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly sourceGraphRef: string | null;
  readonly payload: ReviewEvidencePayload;
};

export type ReviewEvidenceRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly reason: ReviewReason;
  readonly candidateSafeDigest: string;
  readonly rClass: LegacyRowClass | null;
  readonly sourceGraphRef: string | null;
  readonly evidence: StoredReviewEvidenceBody;
};

export type ExistingOpenReviewItem = {
  readonly id: string;
  readonly groupingFingerprint: string;
};

export type GroupReviewEvidenceOptions = {
  readonly existingOpenItems?: readonly ExistingOpenReviewItem[];
};

export type ReviewCandidateState =
  | {
      readonly status: "current";
      readonly capturedRelease: CatalogReleasePin;
    }
  | {
      readonly status: "stale";
      readonly capturedRelease: CatalogReleasePin;
      readonly currentRelease: CatalogReleasePin | null;
    };

export type ReviewEvidenceRef = {
  readonly id: ReviewEvidenceId;
  readonly candidateSafeDigest: string;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
};

export type ReviewQueueItem = {
  readonly id: ReviewItemId;
  readonly organizationId: string;
  readonly status: "open";
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly identityKey: string;
  readonly matcherRevision: string;
  readonly catalogReleaseId: CatalogReleaseId;
  readonly groupingFingerprint: string;
  readonly etag: ReviewItemEtag;
  readonly candidateState: ReviewCandidateState;
  readonly evidenceCount: number;
  readonly evidenceRefs: readonly ReviewEvidenceRef[];
  readonly allowedResolutions: readonly ReviewResolutionType[];
};

export type ReviewQueueList = {
  readonly items: readonly ReviewQueueItem[];
  readonly catalogRelease: CatalogReleasePin;
  readonly emptyReason?: "no-review-work";
};

export type ListReviewQueueQuery = {
  readonly organizationId: string;
  readonly capturedRelease: CatalogReleasePin;
  readonly context: ReviewQueueTrustedContext;
};

export type GetReviewItemQuery = ListReviewQueueQuery & {
  readonly reviewItemId: ReviewItemId;
};

export type ReviewQueueFailure =
  | {
      readonly kind: "permission-denied";
      readonly actorKind: ReviewQueueTrustedContext["actorKind"];
    }
  | {
      readonly kind: "stale-candidate";
      readonly capturedRelease: CatalogReleasePin;
      readonly currentRelease: CatalogReleasePin | null;
    }
  | {
      readonly kind: "duplicate-group";
      readonly organizationId: string;
      readonly groupingFingerprint: string;
    }
  | {
      readonly kind: "review-item-not-found";
      readonly reviewItemId: string;
    }
  | {
      readonly kind: "invalid-query";
      readonly reason: string;
    };

export type GroupedReview = {
  readonly groupingFingerprint: string;
  readonly identityKey: string;
  readonly organizationId: string;
  readonly matcherRevision: string;
  readonly catalogReleaseId: string;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly evidence: readonly ReviewEvidenceRecord[];
  readonly existingItemId: string | null;
};

export type ProjectReviewQueueItemInput = {
  readonly capturedRelease: CatalogReleasePin;
  readonly candidateState: ReviewCandidateState;
  readonly persisted: {
    readonly id: ReviewItemId;
    readonly etagVersion: number;
  };
};

export type ReviewQueueReader = {
  list(
    query: ListReviewQueueQuery,
  ): Promise<Result<ReviewQueueList, ReviewQueueFailure>>;
  get(
    query: GetReviewItemQuery,
  ): Promise<Result<ReviewQueueItem, ReviewQueueFailure>>;
};
