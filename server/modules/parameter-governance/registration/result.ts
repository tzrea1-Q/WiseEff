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
  readonly registrationVersion?: string;
  /** Locked lifecycle state before a committed retire/restore, for its transaction audit. */
  readonly previousRegistrationStatus?: RegistrationStatus;
  readonly placementOrigin: PlacementOrigin;
  readonly moduleId: string | null;
  /** Current Placement version for conditional move callers. */
  readonly placementVersion?: string;
  /** Committed before/after facts for an explicitly confirmed two-sided replacement. */
  readonly replacement?: {
    readonly registrationId: SubjectRegistrationId;
    readonly placementId: SubjectPlacementId;
    readonly subjectId: CatalogSubjectId;
    readonly previousModuleId: string;
    readonly moduleId: null;
    readonly placementVersion: string;
    readonly registrationStatus: RegistrationStatus;
    readonly registrationVersion: string;
    readonly previousSourceModuleId: string | null;
  };
  readonly release: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
};

/** Result refs for replacement commands retain the first committed two-sided outcome. */
export function readPlacementReplacementResult(serialized: string): RegistrationResult {
  const value: unknown = JSON.parse(serialized);
  const object = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  const token = (candidate: unknown): candidate is string => typeof candidate === "string" && candidate.length > 0;
  if (!object(value) || !object(value.replacement) || !object(value.release)) {
    throw new Error("Stored placement replacement result is invalid");
  }
  const replacement = value.replacement;
  if (value.outcome !== "committed" ||
      !["registrationId", "placementId", "organizationId", "subjectId", "registrationVersion", "placementVersion", "idempotencyKey", "fingerprint"].every((key) => token(value[key])) ||
      !["active", "retired"].includes(value.registrationStatus as string) ||
      !["explicit", "automatic", "review"].includes(value.registrationMethod as string) ||
      !["auto", "curated"].includes(value.placementOrigin as string) || !token(value.moduleId) ||
      !token(value.release.id) || !token(value.release.digest) || replacement.moduleId !== null ||
      !["registrationId", "placementId", "subjectId", "previousModuleId", "placementVersion", "registrationVersion"].every((key) => token(replacement[key])) ||
      !["active", "retired"].includes(replacement.registrationStatus as string) ||
      !(replacement.previousSourceModuleId === null || token(replacement.previousSourceModuleId))) {
    throw new Error("Stored placement replacement result is invalid");
  }
  return value as RegistrationResult;
}
