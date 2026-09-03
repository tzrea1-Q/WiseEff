import pg from "pg";

import type {
  CatalogCurrentGuardFailureCode,
  CatalogReleasePin,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import type { TrustedInvocationContext } from "./command";

export type GuardSqlState = "PCA01" | "PCA02" | "PCA03" | "PCA04" | "PCA05";

export type RegistrationFailure =
  | {
      readonly kind: "release-drift";
      readonly code: Extract<CatalogCurrentGuardFailureCode, "PCAT-GUARD-RELEASE-MISMATCH">;
      readonly sqlstate: "PCA01";
      readonly expected: CatalogReleasePin;
    }
  | {
      readonly kind: "subject-not-published";
      readonly code: Extract<CatalogCurrentGuardFailureCode, "PCAT-GUARD-SUBJECT-NOT-PUBLISHED">;
      readonly sqlstate: "PCA02";
      readonly subjectId: string;
    }
  | {
      readonly kind: "subject-retired";
      readonly code: Extract<CatalogCurrentGuardFailureCode, "PCAT-GUARD-SUBJECT-RETIRED">;
      readonly sqlstate: "PCA03";
      readonly subjectId: string;
    }
  | {
      readonly kind: "catalog-drift";
      readonly code: Extract<CatalogCurrentGuardFailureCode, "PCAT-GUARD-DRIFT">;
      readonly sqlstate: "PCA04";
    }
  | {
      readonly kind: "synchronization-busy";
      readonly code: Extract<CatalogCurrentGuardFailureCode, "PCAT-GUARD-SYNCHRONIZATION-BUSY">;
      readonly sqlstate: "PCA05";
      readonly retryable: true;
    }
  | {
      readonly kind: "placement-conflict";
      readonly registrationId: string;
      readonly placementId: string;
    }
  | {
      readonly kind: "revision-conflict";
      readonly idempotencyKey: string;
      readonly storedFingerprint: string;
      readonly attemptedFingerprint: string;
    }
  | {
      readonly kind: "auto-restore-forbidden";
      readonly registrationId: SubjectRegistrationId;
    }
  | {
      readonly kind: "restore-required";
      readonly registrationId: SubjectRegistrationId;
    }
  | {
      readonly kind: "permission-denied";
      readonly actorKind: TrustedInvocationContext["actorKind"];
      readonly method: string;
    }
  | {
      readonly kind: "invalid-command";
      readonly reason: string;
    }
  | {
      readonly kind: "registration-not-found";
      readonly registrationId: string;
    }
  | {
      readonly kind: "invalid-placement-parent";
      readonly destinationModuleId: string;
    };

export const mapGuardDatabaseError = (
  error: unknown,
  expected: CatalogReleasePin,
  subjectId: string,
): RegistrationFailure | null => {
  if (!(error instanceof pg.DatabaseError)) return null;
  switch (error.code) {
    case "PCA01":
      return {
        kind: "release-drift",
        code: "PCAT-GUARD-RELEASE-MISMATCH",
        sqlstate: "PCA01",
        expected,
      };
    case "PCA02":
      return {
        kind: "subject-not-published",
        code: "PCAT-GUARD-SUBJECT-NOT-PUBLISHED",
        sqlstate: "PCA02",
        subjectId,
      };
    case "PCA03":
      return {
        kind: "subject-retired",
        code: "PCAT-GUARD-SUBJECT-RETIRED",
        sqlstate: "PCA03",
        subjectId,
      };
    case "PCA04":
      return {
        kind: "catalog-drift",
        code: "PCAT-GUARD-DRIFT",
        sqlstate: "PCA04",
      };
    case "PCA05":
      return {
        kind: "synchronization-busy",
        code: "PCAT-GUARD-SYNCHRONIZATION-BUSY",
        sqlstate: "PCA05",
        retryable: true,
      };
    default:
      return null;
  }
};

export const mapWriterDatabaseError = (
  error: unknown,
  expected: CatalogReleasePin,
  subjectId: string,
): RegistrationFailure | null => {
  const guard = mapGuardDatabaseError(error, expected, subjectId);
  if (guard) return guard;
  if (!(error instanceof pg.DatabaseError)) return null;
  if (error.code === "23505") {
    return {
      kind: "placement-conflict",
      registrationId: subjectId,
      placementId: error.constraint ?? "unique-violation",
    };
  }
  if (error.code === "23514" && error.constraint === "subject_placement_kind_ck") {
    return {
      kind: "invalid-placement-parent",
      destinationModuleId: subjectId,
    };
  }
  if (error.code === "23503") {
    return { kind: "invalid-command", reason: "foreign-key" };
  }
  return null;
};
