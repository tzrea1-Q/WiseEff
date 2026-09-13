import type {
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalRevisionId,
  PublicationAuthorizationId,
  PublicationPolicyRevision,
  Result,
} from "../../parameter-catalog-contract/index";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type {
  ArtifactSourceKind,
  PublicationAuthorizationRecord,
  PublicationCandidateRecord,
  PublicationPolicyRecord,
} from "../persistence/types";

/**
 * CP-05 activation lock order. Invert this and revoke-vs-activate can deadlock
 * or publish after a committed revoke. This module never takes the catalog
 * exclusive lock and never UPDATE insert-only authorization tables.
 *
 * 1. parameter_catalog.acquire_current_pointer_lock_exclusive()
 * 2. catalog_publication.acquire_publication_guard_lock()
 * 3. re-validate authorization (verifyAuthorizationForActivation)
 * 4. materialize / receipt / heads
 */
export const CATALOG_PUBLICATION_LOCK_ORDER = [
  "parameter_catalog.acquire_current_pointer_lock_exclusive()",
  "catalog_publication.acquire_publication_guard_lock()",
] as const;

export const CATALOG_PUBLICATION_CAPABILITIES = [
  "catalog:author",
  "catalog:publish",
  "catalog:review-high-risk",
] as const;

export type CatalogPublicationCapability = (typeof CATALOG_PUBLICATION_CAPABILITIES)[number];

export type PublicationRiskClass = "low" | "high";

export type PublicationAuthorizationReason =
  | "publication-not-authorized"
  | "publication-capability-missing"
  | "publication-self-approval-forbidden"
  | "publication-policy-disabled"
  | "publication-frozen"
  | "candidate-stale"
  | "candidate-tampered"
  | "publication-authorization-revoked"
  | "unsupported-catalog-capability"
  | "artifact-missing";

export type PublicationAuthorizationFailure = {
  readonly reason: PublicationAuthorizationReason;
  readonly detail?: string;
};

export type PublicationAuthorizationResult<T> = Result<T, PublicationAuthorizationFailure>;

export type ImpactOperationFact =
  | {
      readonly op: "create-definition";
      readonly supported: boolean;
    }
  | {
      readonly op: "create-subject-with-definitions";
    }
  | {
      readonly op: "revise-definition";
      readonly class: "documentation" | "semantic";
    }
  | {
      readonly op: "unknown";
      readonly tag: string;
    };

/**
 * Server-owned impact facts. Duplicates the CP-03 fact shape without importing
 * the Builder. Client riskClass / approved flags are untrusted and ignored.
 */
export type ImpactFacts = {
  readonly authorPrincipalId: string;
  readonly operations: readonly ImpactOperationFact[];
  readonly introducesNewSubject: boolean;
  readonly changesSelector: boolean;
  readonly changesAlias: boolean;
  readonly changesFallback: boolean;
  readonly tightensExistingContract: boolean;
  readonly changesUnitOrSemantic: boolean;
  readonly retiresIdentity: boolean;
  readonly unknownImpact: boolean;
  readonly sourceKind: ArtifactSourceKind;
};

export type AuthorizationCandidateTuple = {
  readonly candidateId: CatalogCandidateId;
  readonly artifactDigest: string;
  readonly expectedBaseReleaseId: CatalogReleaseId;
  readonly expectedBaseReleaseDigest: CatalogReleaseDigest;
  readonly proposalRevisionId: DefinitionProposalRevisionId | null;
  readonly impactReportDigest: string;
  readonly capabilityContractDigest: string;
};

export type UntrustedPublicationRequest = {
  readonly role?: unknown;
  readonly organization?: unknown;
  readonly riskClass?: unknown;
  readonly approved?: unknown;
};

export type AuthorizePublishInput = {
  readonly trustedActor: TrustedInvocationContext;
  readonly candidate: AuthorizationCandidateTuple;
  readonly impactFacts: ImpactFacts;
  readonly policyRevision: PublicationPolicyRevision;
  readonly untrustedRequest?: UntrustedPublicationRequest;
};

export type RevokeAuthorizationInput = {
  readonly trustedActor: TrustedInvocationContext;
  readonly candidateId: CatalogCandidateId;
  readonly approvedAuthorizationId: PublicationAuthorizationId;
  readonly lockMode?: "none" | "publication-guard";
};

export type VerifyAuthorizationForActivationInput = {
  readonly candidateId: CatalogCandidateId;
  readonly authorizationId: PublicationAuthorizationId;
  readonly trustedActor: TrustedInvocationContext;
  readonly impactFacts?: ImpactFacts;
  readonly lockMode?: "none" | "publication-guard";
};

export type AuthorizedPublication = {
  readonly authorization: PublicationAuthorizationRecord;
  readonly candidate: PublicationCandidateRecord;
  readonly policy: PublicationPolicyRecord;
  readonly riskClass: PublicationRiskClass;
};

export type VerifiedPublicationAuthorization = {
  readonly authorization: PublicationAuthorizationRecord;
  readonly candidate: PublicationCandidateRecord;
  readonly policy: PublicationPolicyRecord;
  readonly riskClass: PublicationRiskClass;
};

export type RevokedPublicationAuthorization = {
  readonly revocation: PublicationAuthorizationRecord;
  readonly approvedAuthorizationId: PublicationAuthorizationId;
};

export const EPHEMERAL_POLICY_REVISION_CONFIRMATION = "ephemeral-test-only" as const;

export type RevisePublicationPolicyInput = {
  readonly trustedActor: TrustedInvocationContext;
  readonly publicationEnabled: boolean;
  readonly lowRiskSingleActorPublish: boolean;
  readonly capabilityContractRevision: string;
  readonly isolatedInstanceConfirmation: typeof EPHEMERAL_POLICY_REVISION_CONFIRMATION;
};
