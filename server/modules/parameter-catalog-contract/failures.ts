import type {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId
} from "./ids";
import type {
  CatalogReleaseIdentity,
  CatalogReleasePin,
  OptionalValue
} from "./results";

export const catalogReleaseViolationCodes = [
  "manifest-unreadable",
  "entry-missing",
  "entry-unlisted",
  "unsafe-entry-path",
  "file-digest-mismatch",
  "aggregate-digest-mismatch",
  "schema-invalid",
  "normalization-nondeterministic",
  "duplicate-stable-identity",
  "stable-key-reassigned",
  "alias-collision",
  "alias-owner-mismatch",
  "alias-chain-forbidden",
  "predecessor-mismatch",
  "membership-omitted",
  "lifecycle-tombstone-mismatch",
  "definition-snapshot-incomplete",
  "revision-derivation-invalid"
] as const;
export type CatalogReleaseViolationCode = (typeof catalogReleaseViolationCodes)[number];

export interface CatalogReleaseViolation {
  readonly code: CatalogReleaseViolationCode;
  readonly location: OptionalValue<string>;
  readonly subjectId: OptionalValue<CatalogSubjectId>;
  readonly detail: string;
}

export const catalogDriftViolationCodes = [
  "release-identity-mismatch",
  "materialization-fingerprint-mismatch",
  "subject-root-mismatch",
  "subject-membership-mismatch",
  "alias-owner-mismatch",
  "alias-membership-mismatch",
  "definition-identity-mismatch",
  "definition-revision-mismatch",
  "definition-head-mismatch",
  "release-head-provenance-mismatch",
  "unexpected-catalog-row",
  "organization-owned-catalog-row",
  "current-pointer-mismatch"
] as const;
export type CatalogDriftViolationCode = (typeof catalogDriftViolationCodes)[number];

export interface CatalogDriftViolation {
  readonly code: CatalogDriftViolationCode;
  readonly relation: string;
  readonly identity: string;
  readonly detail: string;
}

export type CatalogKernelError =
  | {
      readonly kind: "invalid-release";
      readonly phase: "source" | "compile" | "lineage" | "install-preflight";
      readonly violations: readonly CatalogReleaseViolation[];
    }
  | {
      readonly kind: "drift";
      readonly scope: "current" | "pinned" | "candidate-install";
      readonly expected: CatalogReleasePin;
      readonly actual: CatalogReleaseIdentity | null;
      readonly violations: readonly CatalogDriftViolation[];
    }
  | {
      readonly kind: "release-mismatch";
      readonly expected: CatalogReleasePin;
      readonly actual: CatalogReleaseIdentity | null;
    }
  | {
      readonly kind: "digest-conflict";
      readonly releaseId: CatalogReleaseId;
      readonly expected: CatalogReleaseDigest;
      readonly actual: CatalogReleaseDigest;
    }
  | {
      readonly kind: "unsupported-lineage";
      readonly installed: CatalogReleaseIdentity | null;
      readonly target: CatalogReleaseIdentity;
      readonly reason: "gap" | "wrong-predecessor" | "stale-expected-current";
    }
  | {
      readonly kind: "synchronization-busy";
      readonly retryable: true;
    }
  | {
      readonly kind: "historical-release-unavailable";
      readonly pin: CatalogReleasePin;
    }
  | {
      readonly kind: "switch-back-forbidden";
      readonly reason:
        | "traffic-observed"
        | "candidate-write-observed"
        | "previous-projection-invalid"
        | "migration-incompatible";
    }
  | {
      readonly kind: "invalid-selector";
      readonly field: "driver-compatible" | "node-type-name" | "property-key";
    }
  | { readonly kind: "permission-denied"; readonly operation: string }
  | {
      readonly kind: "storage-failure";
      readonly operation: string;
      readonly retryable: boolean;
    };

export const catalogCurrentGuardFailureCodes = [
  "PCAT-GUARD-RELEASE-MISMATCH",
  "PCAT-GUARD-SUBJECT-NOT-PUBLISHED",
  "PCAT-GUARD-SUBJECT-RETIRED",
  "PCAT-GUARD-DRIFT",
  "PCAT-GUARD-SYNCHRONIZATION-BUSY"
] as const;
export type CatalogCurrentGuardFailureCode =
  (typeof catalogCurrentGuardFailureCodes)[number];

export const apiFailureReasons = [
  "catalog-not-ready",
  "release-drift",
  "subject-not-published",
  "subject-retired",
  "definition-not-found",
  "definition-retired",
  "registration-required",
  "placement-conflict",
  "invalid-placement-parent",
  "observation-ambiguous",
  "proposal-stale",
  "proposal-self-approval-forbidden",
  "revision-conflict",
  "legacy-id-archived",
  "legacy-surface-retired",
  "legacy-id-ambiguous",
  "forbidden",
  "migration-diagnostics-not-public"
] as const;
export type ApiFailureReason = (typeof apiFailureReasons)[number];

export const databaseVerificationGateIds = [
  "PCAT-DB-V01",
  "PCAT-DB-V02",
  "PCAT-DB-V03",
  "PCAT-DB-V04",
  "PCAT-DB-V05",
  "PCAT-DB-V06",
  "PCAT-DB-V07",
  "PCAT-DB-V08",
  "PCAT-DB-V09",
  "PCAT-DB-V10",
  "PCAT-DB-V11",
  "PCAT-DB-V12",
  "PCAT-DB-V13",
  "PCAT-DB-V14",
  "PCAT-DB-V15",
  "PCAT-DB-V16",
  "PCAT-DB-V17"
] as const;
export type DatabaseVerificationGateId = (typeof databaseVerificationGateIds)[number];

export const databaseVerificationFailureCodes = [
  "PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION",
  "PCAT-VRF-V02-CURRENT-REVISION-CARDINALITY",
  "PCAT-VRF-V03-OWNER-SCOPE-MISMATCH",
  "PCAT-VRF-V04-SUBJECT-MEMBERSHIP-MISSING",
  "PCAT-VRF-V05-PLACEMENT-CARDINALITY",
  "PCAT-VRF-V06-BINDING-DEFINITION-MISMATCH",
  "PCAT-VRF-V07-PROJECT-VALUE-REVISION-MISMATCH",
  "PCAT-VRF-V08-PROTECTED-ID-UNMAPPED",
  "PCAT-VRF-V09-SOURCE-CONSERVATION",
  "PCAT-VRF-V10-R6-R8-IDENTITY-MERGE",
  "PCAT-VRF-V11-ARCHIVE-INTEGRITY",
  "PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT",
  "PCAT-VRF-V13-LEGACY-WRITER-REACHABLE",
  "PCAT-VRF-V14-BINDING-TIP-CONSERVATION",
  "PCAT-VRF-V15-AUDIT-CONTINUITY",
  "PCAT-VRF-V16-ORGANIZATION-STRUCTURAL-CATALOG",
  "PCAT-VRF-V17-MODE-RESULT-MISMATCH"
] as const;
export type DatabaseVerificationFailureCode =
  (typeof databaseVerificationFailureCodes)[number];

export const migrationVerificationGateIds = [
  "PCAT-DB-M01",
  "PCAT-DB-M02",
  "PCAT-DB-M03",
  "PCAT-DB-M04"
] as const;
export type MigrationVerificationGateId = (typeof migrationVerificationGateIds)[number];

export const migrationVerificationFailureCodes = [
  "PCAT-MIG-PACKAGE-INVENTORY-DRIFT",
  "PCAT-MIG-APPLIED-FILE-MISSING",
  "PCAT-MIG-HISTORICAL-ALIAS-INVALID",
  "PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH"
] as const;
export type MigrationVerificationFailureCode =
  (typeof migrationVerificationFailureCodes)[number];

export const privilegeVerificationGateIds = ["PCAT-DB-P01", "PCAT-DB-P02"] as const;
export type PrivilegeVerificationGateId = (typeof privilegeVerificationGateIds)[number];

export const privilegeVerificationFailureCodes = [
  "PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS",
  "PCAT-PRIV-LEGACY-WRITER-BYPASS"
] as const;
export type PrivilegeVerificationFailureCode =
  (typeof privilegeVerificationFailureCodes)[number];

export const comparisonVerificationGateIds = [
  "PCAT-CMP-D01",
  "PCAT-CMP-D02",
  "PCAT-CMP-D03",
  "PCAT-CMP-D04",
  "PCAT-CMP-D05",
  "PCAT-CMP-D06",
  "PCAT-CMP-D07",
  "PCAT-CMP-D08",
  "PCAT-CMP-D09"
] as const;
export type ComparisonVerificationGateId = (typeof comparisonVerificationGateIds)[number];

export const comparisonVerificationFailureCodes = [
  "PCAT-CMP-D01-DEFINITION-SEMANTICS",
  "PCAT-CMP-D02-SUBJECT-IDENTITY",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
  "PCAT-CMP-D04-BINDING-HISTORY",
  "PCAT-CMP-D05-PROJECT-VALUE-PIN",
  "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
  "PCAT-CMP-D08-SOURCE-WRITEBACK",
  "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"
] as const;
export type ComparisonVerificationFailureCode =
  (typeof comparisonVerificationFailureCodes)[number];

export const comparatorFailureCodes = [
  "PCAT-CMP-CORPUS-COVERAGE",
  "PCAT-CMP-UNEXPLAINED-DIFFERENCE",
  "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
  "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
  "PCAT-CMP-REPORT-INTEGRITY"
] as const;
export type ComparatorFailureCode = (typeof comparatorFailureCodes)[number];

export const reportFailureCodes = ["PCAT-REPORT-NONDETERMINISTIC"] as const;
export type ReportFailureCode = (typeof reportFailureCodes)[number];

export const parameterCatalogFailureFamilies = [
  "PCAT-ART-*",
  "PCAT-MIG-*",
  "PCAT-SCHEMA-*",
  "PCAT-SYNC-*",
  "PCAT-CLASS-*",
  "PCAT-MAP-*",
  "PCAT-REG-*",
  "PCAT-BIND-*",
  "PCAT-ARCH-*",
  "PCAT-VRF-*",
  "PCAT-CMP-*",
  "PCAT-API-*",
  "PCAT-AUTH-*",
  "PCAT-UI-*",
  "PCAT-UPG-*",
  "PCAT-WRITER-*",
  "PCAT-RP-*",
  "PCAT-RESTORE-*",
  "PCAT-RET-*"
] as const;
export type ParameterCatalogFailureFamily =
  (typeof parameterCatalogFailureFamilies)[number];
