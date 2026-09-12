import type {
  CatalogActivationReceiptId,
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  ContractJsonValue,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationAuthorizationId,
  PublicationJobId,
  PublicationPolicyRevision,
  Result,
} from "../../parameter-catalog-contract/index";

export type ArtifactSourceKind =
  | "typed-changeset"
  | "vendor-yaml"
  | "repository-bundle"
  | "adopted-preexisting";

export type PublicationAuthorizationEventKind = "approve" | "revoke";

export type PublicationJobStatus =
  | "queued"
  | "running"
  | "active"
  | "needs-rebase"
  | "blocked"
  | "failed-retryable"
  | "failed-terminal"
  | "cancelled";

export type ActivationReceiptKind =
  | "online-publication"
  | "adopted-preexisting"
  | "bootstrap";

export type JsonObject = { readonly [key: string]: ContractJsonValue };

export type CatalogPublicationStoreError =
  | {
      readonly kind: "conflict";
      readonly reason: "artifact-digest-bytes-mismatch" | "idempotency-key-conflict";
    }
  | {
      readonly kind: "not-found";
      readonly entity: "artifact" | "candidate" | "authorization" | "job" | "receipt" | "policy";
    }
  | {
      readonly kind: "constraint-violation";
      readonly sqlstate: string;
      readonly message: string;
    }
  | {
      readonly kind: "permission-denied";
      readonly sqlstate: string;
      readonly message: string;
    }
  | {
      readonly kind: "invalid-input";
      readonly reason: string;
    };

export type CatalogPublicationStoreResult<T> = Result<T, CatalogPublicationStoreError>;

export interface ReleaseArtifactRecord {
  readonly id: CatalogArtifactId;
  readonly artifactDigest: string;
  readonly bytesChecksum: string;
  readonly artifactBytes: Uint8Array;
  readonly sourceKind: ArtifactSourceKind;
  readonly targetReleaseId: CatalogReleaseId;
  readonly targetReleaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId | null;
  readonly predecessorReleaseDigest: CatalogReleaseDigest | null;
  readonly toolchain: JsonObject;
  readonly createdAt: string;
}

export interface PersistArtifactInput {
  readonly id: CatalogArtifactId;
  readonly artifactDigest: string;
  readonly artifactBytes: Uint8Array;
  readonly sourceKind: ArtifactSourceKind;
  readonly targetReleaseId: CatalogReleaseId;
  readonly targetReleaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId | null;
  readonly predecessorReleaseDigest: CatalogReleaseDigest | null;
  readonly toolchain: JsonObject;
}

export interface PublicationCandidateRecord {
  readonly id: CatalogCandidateId;
  readonly artifactId: CatalogArtifactId;
  readonly artifactDigest: string;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalId: DefinitionProposalId | null;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly identityAllocation: JsonObject;
  readonly impactReportDigest: string;
  readonly capabilityContract: JsonObject;
  readonly createdAt: string;
}

export interface PersistCandidateInput {
  readonly id: CatalogCandidateId;
  readonly artifactId: CatalogArtifactId;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalId: DefinitionProposalId | null;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly identityAllocation: JsonObject;
  readonly impactReportDigest: string;
  readonly capabilityContract: JsonObject;
}

export interface PublicationAuthorizationRecord {
  readonly id: PublicationAuthorizationId;
  readonly eventKind: PublicationAuthorizationEventKind;
  readonly candidateId: CatalogCandidateId;
  readonly artifactDigest: string;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly impactReportDigest: string;
  readonly capabilityContractDigest: string;
  readonly policyRevision: PublicationPolicyRevision;
  readonly actorPrincipalId: string;
  readonly approvedAuthorizationId: PublicationAuthorizationId | null;
  readonly createdAt: string;
}

export interface AppendAuthorizationInput {
  readonly id: PublicationAuthorizationId;
  readonly eventKind: PublicationAuthorizationEventKind;
  readonly candidateId: CatalogCandidateId;
  readonly artifactDigest: string;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly impactReportDigest: string;
  readonly capabilityContractDigest: string;
  readonly policyRevision: PublicationPolicyRevision;
  readonly actorPrincipalId: string;
  readonly approvedAuthorizationId: PublicationAuthorizationId | null;
}

export interface PublicationJobRecord {
  readonly id: PublicationJobId;
  readonly candidateId: CatalogCandidateId;
  readonly authorizationId: PublicationAuthorizationId;
  readonly requestScope: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly status: PublicationJobStatus;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
  readonly fencingToken: number;
  readonly attemptCount: number;
  readonly lastErrorClass: string | null;
  readonly lastErrorReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePublicationJobInput {
  readonly id: PublicationJobId;
  readonly candidateId: CatalogCandidateId;
  readonly authorizationId: PublicationAuthorizationId;
  readonly requestScope: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
}

export interface JobExecutionPatch {
  readonly status?: PublicationJobStatus;
  readonly leaseOwner?: string | null;
  readonly leaseUntil?: string | null;
  readonly fencingToken?: number;
  readonly attemptCount?: number;
  readonly lastErrorClass?: string | null;
  readonly lastErrorReason?: string | null;
}

export interface PublicationPolicyRecord {
  readonly revision: PublicationPolicyRevision;
  readonly publicationEnabled: boolean;
  readonly lowRiskSingleActorPublish: boolean;
  readonly capabilityContractRevision: string;
  readonly updatedAt: string;
  readonly updatedByPrincipalId: string;
}

export interface CatalogActivationReceiptRecord {
  readonly id: CatalogActivationReceiptId;
  readonly kind: ActivationReceiptKind;
  readonly releaseId: CatalogReleaseId;
  readonly releaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId | null;
  readonly predecessorReleaseDigest: CatalogReleaseDigest | null;
  readonly verificationDigest: string;
  readonly publicationJobId: PublicationJobId | null;
  readonly authorizationId: PublicationAuthorizationId | null;
  readonly candidateId: CatalogCandidateId | null;
  readonly actorPrincipalId: string;
  readonly adoptionEvidence: JsonObject | null;
  readonly createdAt: string;
}

export interface InsertActivationReceiptInput {
  readonly id: CatalogActivationReceiptId;
  readonly kind: ActivationReceiptKind;
  readonly releaseId: CatalogReleaseId;
  readonly releaseDigest: CatalogReleaseDigest;
  readonly predecessorReleaseId: CatalogReleaseId | null;
  readonly predecessorReleaseDigest: CatalogReleaseDigest | null;
  readonly verificationDigest: string;
  readonly publicationJobId: PublicationJobId | null;
  readonly authorizationId: PublicationAuthorizationId | null;
  readonly candidateId: CatalogCandidateId | null;
  readonly actorPrincipalId: string;
  readonly adoptionEvidence: JsonObject | null;
}
