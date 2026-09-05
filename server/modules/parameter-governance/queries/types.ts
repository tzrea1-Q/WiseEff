import type { CatalogIdSelection } from "../../catalog-kernel/interface";
import type {
  CatalogReleasePin,
  CatalogSubjectId,
  DefinitionProposalStatus,
  ParameterDefinitionId,
  Result as ContractResult,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type GovernanceQueryable = {
  query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<import("pg").QueryResult<T>>;
};

export type GovernanceQueryAuthScope = {
  readonly organizationId: string;
  readonly principalId: string;
};

export const GOVERNANCE_CURRENT_PROJECTION_SEMANTICS = {
  kind: "current-organization-projection",
  catalogReleasePinned: false,
  consistentWithinQueryTransaction: true,
  consistentAcrossBindingUsageQuery: false,
  note:
    "Registration, Placement, Observation, Proposal, and reviewCount are request-time organization state. One GovernanceCatalogQueries method uses one read-only transaction when given a Pool. Binding usage summaries run in a separate domain transaction and must not be labeled a historical strongly-consistent snapshot.",
} as const;

export type GovernanceCurrentProjectionSemantics =
  typeof GOVERNANCE_CURRENT_PROJECTION_SEMANTICS;

export type CatalogQueryEmptyReason =
  | "no-registrations"
  | "no-definitions"
  | "no-review-work"
  | "no-filter-match";

export type CatalogQueryView =
  | "registrations"
  | "definitions"
  | "reviews"
  | "subjects"
  | "observations"
  | "proposals";

export type RegistrationHttpMethod = "explicit" | "automatic" | "review";
export type RegistrationHttpStatus = "active" | "retired";
export type ObservationRecognition = "unknown" | "ambiguous" | "matched" | "retired";

export type GovernancePlacementRecord = {
  readonly id: string;
  readonly displayName: string;
  readonly parentPlacementId: string | null;
};

export type GovernanceRegistrationRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly subjectId: CatalogSubjectId;
  readonly status: RegistrationHttpStatus;
  readonly method: RegistrationHttpMethod;
  readonly placement: GovernancePlacementRecord;
  readonly catalogReleaseId: string;
  readonly etag: string;
};

export type CatalogRegistrationProjection =
  | { readonly status: "unregistered" }
  | {
      readonly status: RegistrationHttpStatus;
      readonly id: string;
      readonly method: RegistrationHttpMethod;
      readonly placement: GovernancePlacementRecord;
    };

export type SubjectRegistrationProjection = {
  readonly subjectId: CatalogSubjectId;
  readonly registration: CatalogRegistrationProjection;
  readonly reviewCount: number;
};

export type RegistrationProjectionPage = {
  readonly semantics: GovernanceCurrentProjectionSemantics;
  readonly projections: readonly SubjectRegistrationProjection[];
};

export type RegistrationList = {
  readonly semantics: GovernanceCurrentProjectionSemantics;
  readonly items: readonly GovernanceRegistrationRecord[];
  readonly nextCursor: string | null;
  readonly emptyReason?: CatalogQueryEmptyReason;
};

export type GovernanceObservationRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly propertyKey: string;
  readonly sourceRef: { readonly kind: string; readonly id: string };
  readonly recognition: ObservationRecognition;
  readonly reviewItemId: string | null;
};

export type ObservationList = {
  readonly semantics: GovernanceCurrentProjectionSemantics;
  readonly items: readonly GovernanceObservationRecord[];
  readonly emptyReason?: CatalogQueryEmptyReason;
};

export type GovernanceProposalRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly status: DefinitionProposalStatus;
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

export type ProposalList = {
  readonly semantics: GovernanceCurrentProjectionSemantics;
  readonly items: readonly GovernanceProposalRecord[];
  readonly emptyReason?: CatalogQueryEmptyReason;
};

export type RegistrationFilter = "active" | "retired" | "unregistered";

export type CatalogDefinitionIndexEntry = {
  readonly id: ParameterDefinitionId;
  readonly subjectId: CatalogSubjectId;
};

export type GovernanceQueryFailure =
  | { readonly kind: "invalid-query"; readonly reason: string }
  | { readonly kind: "not-found"; readonly resource: "registration" | "placement" | "observation" | "proposal" | "organization" }
  | {
      readonly kind: "missing-required-placement";
      readonly registrationId: string;
      readonly subjectId: string;
    }
  | {
      readonly kind: "missing-required-relation";
      readonly resource: "placement-module" | "proposal-revision";
      readonly id: string;
    }
  | { readonly kind: "invalid-cursor"; readonly reason: string }
  | { readonly kind: "timeout"; readonly operation: string }
  | { readonly kind: "dependency-failure"; readonly operation: string }
  | { readonly kind: "query-unavailable"; readonly operation: string };

export type ProjectRegistrationsQuery = {
  readonly organizationId: string;
  readonly subjectIds: readonly CatalogSubjectId[];
  readonly authScope: GovernanceQueryAuthScope;
  readonly observedRelease: CatalogReleasePin;
};

export type RegistrationSelectionQuery = {
  readonly organizationId: string;
  readonly registration?: RegistrationFilter;
  readonly catalogSubjectIds?: readonly CatalogSubjectId[];
  readonly authScope: GovernanceQueryAuthScope;
};

export type DefinitionSelectionQuery = {
  readonly organizationId: string;
  readonly registration?: RegistrationFilter;
  readonly catalogDefinitions: readonly CatalogDefinitionIndexEntry[];
  readonly authScope: GovernanceQueryAuthScope;
};

export type ListRegistrationsQuery = {
  readonly organizationId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
  readonly cursor?: string;
  readonly limit?: number;
};

export type GetRegistrationQuery = {
  readonly organizationId: string;
  readonly registrationId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
};

export type GetPlacementQuery = GetRegistrationQuery;

export type ListObservationsQuery = {
  readonly organizationId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
};

export type GetObservationQuery = {
  readonly organizationId: string;
  readonly observationId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
};

export type ListProposalsQuery = {
  readonly organizationId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
};

export type GetProposalQuery = {
  readonly organizationId: string;
  readonly proposalId: string;
  readonly observedCatalogReleaseId: string;
  readonly authScope: GovernanceQueryAuthScope;
};

export type SubjectIdSelection = CatalogIdSelection<CatalogSubjectId>;
export type DefinitionIdSelection = CatalogIdSelection<ParameterDefinitionId>;
