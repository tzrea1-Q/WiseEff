import type {
  CatalogReleasePin,
  CatalogSubjectId,
  PlacementOrigin,
  RegistrationStatus,
  Result as ContractResult,
  SubjectPlacementId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type RegistrationMethod = "explicit" | "automatic" | "review";

export type RegistrationResult = {
  readonly outcome: "committed" | "replayed";
  readonly registrationId: SubjectRegistrationId;
  readonly placementId: SubjectPlacementId;
  readonly organizationId: string;
  readonly subjectId: CatalogSubjectId;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationMethod: RegistrationMethod;
  readonly placementOrigin: PlacementOrigin;
  readonly moduleId: string;
  readonly release: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
};
