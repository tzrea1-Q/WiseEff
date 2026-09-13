import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type { BackendPermission } from "../../auth/types";
import type { catalogPublicationCommandByRouteId } from "./mapping";

export type CatalogPublicationRouteId = keyof typeof catalogPublicationCommandByRouteId;

export type CatalogPublicationRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: Record<string, string | string[]>;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly requestId: string;
  readonly body: unknown;
};

export type CatalogPublicationResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
};

export type TrustedPublicationActorKind =
  | "org-admin"
  | "platform-admin"
  | "org-member"
  | "agent"
  | "user";

export type TrustedPublicationScope = {
  readonly principalId: string;
  readonly organizationId: string;
  readonly actorKind: TrustedPublicationActorKind;
  readonly permissions: readonly BackendPermission[];
  readonly trustedActor: TrustedInvocationContext;
};

export type CatalogPublicationAuthResult =
  | { readonly ok: true; readonly scope: TrustedPublicationScope }
  | { readonly ok: false; readonly status: 401 | 403 };

export type PublicationCandidateView = {
  readonly id: string;
  readonly expectedBaseReleaseId: string;
  readonly expectedBaseReleaseDigest: string;
  readonly riskClass: "low" | "high";
  readonly impactSummary: {
    readonly addedDefinitionCount: number;
    readonly changedDefinitionCount: number;
    readonly addedSubjectCount: number;
    readonly addedSubjectIds?: readonly string[];
  };
  readonly capabilityContract: {
    readonly revision: string;
    readonly allowListId: string;
  };
  readonly authorOrganizationId: string;
};

export type PublicationJobView = {
  readonly id: string;
  readonly candidateId: string;
  readonly status:
    | "queued"
    | "running"
    | "active"
    | "needs-rebase"
    | "blocked"
    | "failed-retryable"
    | "failed-terminal"
    | "cancelled";
  readonly attemptCount: number;
  readonly effective: boolean;
  readonly isCurrent: boolean;
  readonly currentness: "active" | "active-superseded" | null;
  readonly failure: { readonly class: string; readonly reason: string } | null;
  readonly authorOrganizationId: string;
};

export type PreviewPublicationCommand = {
  readonly trustedActor: TrustedInvocationContext;
  readonly organizationId: string;
  readonly principalId: string;
  readonly permissions: readonly BackendPermission[];
  readonly actorKind: TrustedPublicationActorKind;
  readonly catalogReleaseId: string;
  readonly changeSet: unknown;
  readonly proposalId?: string;
  readonly proposalRevisionId?: string;
};

export type PublishPublicationCommand = {
  readonly trustedActor: TrustedInvocationContext;
  readonly organizationId: string;
  readonly principalId: string;
  readonly permissions: readonly BackendPermission[];
  readonly actorKind: TrustedPublicationActorKind;
  readonly catalogReleaseId: string;
  readonly candidateId: string;
  readonly idempotencyKey: string;
};

export type CatalogPublicationFailure = {
  readonly kind:
    | "not-found"
    | "forbidden"
    | "unauthenticated"
    | "validation"
    | "reason";
  readonly reason?: string;
  readonly field?: string;
  readonly httpStatus?: number;
};

export type CatalogPublicationPorts = {
  readonly authenticate: (
    request: CatalogPublicationRequest,
  ) => Promise<CatalogPublicationAuthResult>;
  readonly currentRelease: () => Promise<CatalogReleasePin | null>;
  readonly previewCandidate: (
    command: PreviewPublicationCommand,
  ) => Promise<{ ok: true; value: PublicationCandidateView } | { ok: false; error: CatalogPublicationFailure }>;
  readonly getCandidate: (input: {
    readonly candidateId: string;
    readonly organizationId: string;
    readonly actorKind: TrustedPublicationActorKind;
  }) => Promise<{ ok: true; value: PublicationCandidateView } | { ok: false; error: CatalogPublicationFailure }>;
  readonly publishCandidate: (
    command: PublishPublicationCommand,
  ) => Promise<{ ok: true; value: PublicationJobView; replayed: boolean } | { ok: false; error: CatalogPublicationFailure }>;
  readonly getPublication: (input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly actorKind: TrustedPublicationActorKind;
  }) => Promise<{ ok: true; value: PublicationJobView } | { ok: false; error: CatalogPublicationFailure }>;
};
