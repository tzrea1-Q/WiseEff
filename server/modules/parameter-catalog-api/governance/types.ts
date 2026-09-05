import type { PlacementIntent } from "../../parameter-catalog-contract/index";
import type {
  RegistrationCommand,
  TrustedInvocationContext as RegistrationTrustedContext,
} from "../../parameter-governance/registration/command";
import type { RegistrationFailure } from "../../parameter-governance/registration/failures";
import type { RegistrationResult } from "../../parameter-governance/registration/result";
import type {
  GetReviewItemQuery,
  ListReviewQueueQuery,
  ReviewQueueFailure,
  ReviewQueueItem,
  ReviewQueueList,
} from "../../parameter-governance/review/types";
import type { ResolveReviewItemCommand } from "../../parameter-governance/resolveReviewItem/command";
import type { GovernanceFailure } from "../../parameter-governance/resolveReviewItem/failures";
import type { ReviewResolutionResult } from "../../parameter-governance/resolveReviewItem/result";
import type { ProposalCommand } from "../../parameter-governance/proposals/command";
import type { ProposalFailure } from "../../parameter-governance/proposals/failures";
import type { ProposalResult } from "../../parameter-governance/proposals/result";
import type { CatalogReleasePin, Result } from "../../parameter-catalog-contract/index";
import type { catalogGovernanceCommandByRouteId } from "./mapping";

export type CatalogGovernanceRouteId = keyof typeof catalogGovernanceCommandByRouteId;

export type CatalogGovernanceRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, string | string[]>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly requestId: string;
  readonly body: unknown;
};

export type CatalogGovernanceResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
};

export type TrustedGovernanceActorKind =
  | "org-admin"
  | "platform-admin"
  | "org-member"
  | "agent"
  | "user";

export type TrustedGovernanceScope = {
  readonly principalId: string;
  readonly organizationId: string;
  readonly actorKind: TrustedGovernanceActorKind;
  readonly canReadGovernance: boolean;
  readonly canMutateOrganization: boolean;
  readonly canReviewProposals: boolean;
  readonly defaultDestinationModuleId: string;
  readonly defaultSubjectKind: "driver" | "node-type";
};

export type CatalogGovernanceAuthResult =
  | { readonly ok: true; readonly scope: TrustedGovernanceScope }
  | { readonly ok: false; readonly status: 401 | 403 };

export type RegistrationRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly subjectId: string;
  readonly status: "active" | "retired";
  readonly method: "explicit" | "automatic" | "review";
  readonly placement: {
    readonly id: string;
    readonly displayName: string;
    readonly parentPlacementId: string | null;
  };
  readonly catalogReleaseId: string;
  readonly etag: string;
};

export type ObservationRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly propertyKey: string;
  readonly sourceRef: { readonly kind: string; readonly id: string };
  readonly recognition: "unknown" | "ambiguous" | "matched" | "retired";
  readonly reviewItemId: string | null;
};

export type ProposalRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly status: "draft" | "submitted" | "accepted" | "rejected" | "withdrawn";
  readonly etag: string;
  readonly version: number;
  readonly base: {
    readonly catalogReleaseId: string;
    readonly definitionId: string | null;
    readonly definitionRevisionId: string | null;
  };
  readonly requestedChange: { readonly kind: string; readonly [key: string]: unknown };
  readonly submittedByPersonId: string | null;
  readonly acceptedByPersonId: string | null;
  readonly publicationIntentRef: string | null;
};

export type CatalogGovernanceQueryScope = {
  readonly organizationId: string;
  readonly catalogReleaseId: string;
  readonly principalId?: string;
};

export type CatalogGovernancePorts = {
  readonly authenticate: (
    request: CatalogGovernanceRequest,
  ) => Promise<CatalogGovernanceAuthResult>;
  readonly currentRelease: () => Promise<CatalogReleasePin | null>;
  readonly executeRegistration: (
    command: RegistrationCommand,
  ) => Promise<Result<RegistrationResult, RegistrationFailure>>;
  readonly resolveReviewItem: (
    command: ResolveReviewItemCommand,
  ) => Promise<Result<ReviewResolutionResult, GovernanceFailure>>;
  readonly executeProposal: (
    command: ProposalCommand,
  ) => Promise<Result<ProposalResult, ProposalFailure>>;
  readonly listReviewQueue: (
    query: ListReviewQueueQuery,
  ) => Promise<Result<ReviewQueueList, ReviewQueueFailure>>;
  readonly getReviewItem: (
    query: GetReviewItemQuery,
  ) => Promise<Result<ReviewQueueItem, ReviewQueueFailure>>;
  readonly resolveSubjectKind?: (
    subjectId: string,
  ) => Promise<"driver" | "node-type" | null>;
  readonly resolveDestinationModuleId?: (input: {
    readonly organizationId: string;
    readonly subjectKind: "driver" | "node-type";
    readonly placement: PlacementIntent;
  }) => Promise<string | null>;
  readonly listRegistrations: (
    input: CatalogGovernanceQueryScope,
  ) => Promise<readonly RegistrationRecord[]>;
  readonly getRegistration: (
    input: CatalogGovernanceQueryScope & { readonly registrationId: string },
  ) => Promise<RegistrationRecord | null>;
  readonly getPlacement: (
    input: CatalogGovernanceQueryScope & { readonly registrationId: string },
  ) => Promise<RegistrationRecord["placement"] | null>;
  readonly listObservations: (
    input: CatalogGovernanceQueryScope,
  ) => Promise<readonly ObservationRecord[]>;
  readonly getObservation: (
    input: CatalogGovernanceQueryScope & { readonly observationId: string },
  ) => Promise<ObservationRecord | null>;
  readonly listProposals: (
    input: CatalogGovernanceQueryScope,
  ) => Promise<readonly ProposalRecord[]>;
  readonly getProposal: (
    input: CatalogGovernanceQueryScope & { readonly proposalId: string },
  ) => Promise<ProposalRecord | null>;
};

export type { PlacementIntent, RegistrationTrustedContext };
