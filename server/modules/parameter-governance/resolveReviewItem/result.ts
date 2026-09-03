import type {
  CatalogReleasePin,
  CatalogSubjectId,
  DefinitionProposalId,
  ReviewItemEtag,
  ReviewItemId,
  ReviewItemStatus,
  ReviewResolutionId,
  ReviewResolutionType,
  Result as ContractResult,
  SubjectPlacementId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type ReviewResolutionResult = {
  readonly outcome: "committed" | "replayed";
  readonly reviewItemId: ReviewItemId;
  readonly resolutionId: ReviewResolutionId;
  readonly resolutionType: ReviewResolutionType;
  readonly organizationId: string;
  readonly status: Extract<ReviewItemStatus, "resolved" | "out-of-scope">;
  readonly etag: ReviewItemEtag;
  readonly beforeEtag: ReviewItemEtag;
  readonly release: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly successAuditRef: string;
  readonly registrationId?: SubjectRegistrationId;
  readonly placementId?: SubjectPlacementId;
  readonly subjectId?: CatalogSubjectId;
  readonly proposalId?: DefinitionProposalId;
};
