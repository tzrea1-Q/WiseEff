import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  apiFailureReasons,
  catalogCurrentGuardFailureCodes,
  catalogDriftViolationCodes,
  catalogReleaseViolationCodes,
  catalogUpgradeFailureCodes,
  comparisonVerificationFailureCodes,
  comparisonVerificationGateIds,
  comparatorFailureCodes,
  databaseVerificationFailureCodes,
  databaseVerificationGateIds,
  migrationVerificationFailureCodes,
  migrationVerificationGateIds,
  parameterCatalogFailureFamilies,
  privilegeVerificationFailureCodes,
  privilegeVerificationGateIds,
  reportFailureCodes,
  type CatalogKernelError
} from "./index";

const describeKernelFailure = (failure: CatalogKernelError): string => {
  switch (failure.kind) {
    case "invalid-release":
      return failure.phase;
    case "drift":
      return failure.scope;
    case "release-mismatch":
      return failure.expected.id;
    case "digest-conflict":
      return failure.releaseId;
    case "unsupported-lineage":
      return failure.reason;
    case "synchronization-busy":
      return String(failure.retryable);
    case "historical-release-unavailable":
      return failure.pin.id;
    case "switch-back-forbidden":
      return failure.reason;
    case "invalid-selector":
      return failure.field;
    case "permission-denied":
      return failure.operation;
    case "storage-failure":
      return failure.operation;
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
};

const inventedKernelOperationFailure: CatalogKernelError = {
  kind: "permission-denied",
  // @ts-expect-error Kernel failure operations must use the frozen operation union.
  operation: "inventedKernelOperation"
};

void inventedKernelOperationFailure;

describe("parameter catalog stable failures", () => {
  it("keeps the Catalog Kernel failure union exhaustive", () => {
    const failure: CatalogKernelError = {
      kind: "release-mismatch",
      expected: {
        id: CatalogReleaseId("crel_expected"),
        digest: CatalogReleaseDigest("sha256:expected")
      },
      actual: null
    };

    expect(describeKernelFailure(failure)).toBe("crel_expected");
    expect(
      describeKernelFailure({
        kind: "permission-denied",
        operation: "loadCurrentCatalog"
      })
    ).toBe("loadCurrentCatalog");
  });

  it("freezes release-validation and materialization-drift codes", () => {
    expect(catalogReleaseViolationCodes).toEqual([
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
    ]);
    expect(catalogDriftViolationCodes).toEqual([
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
    ]);
  });

  it("freezes cross-module guard, API, comparator, and verification identifiers", () => {
    expect(catalogCurrentGuardFailureCodes).toEqual([
      "PCAT-GUARD-RELEASE-MISMATCH",
      "PCAT-GUARD-SUBJECT-NOT-PUBLISHED",
      "PCAT-GUARD-SUBJECT-RETIRED",
      "PCAT-GUARD-DRIFT",
      "PCAT-GUARD-SYNCHRONIZATION-BUSY"
    ]);
    expect(apiFailureReasons).toEqual([
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
    ]);
    expect(comparatorFailureCodes).toEqual([
      "PCAT-CMP-CORPUS-COVERAGE",
      "PCAT-CMP-UNEXPLAINED-DIFFERENCE",
      "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      "PCAT-CMP-REPORT-INTEGRITY"
    ]);
    expect(databaseVerificationGateIds).toEqual([
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
    ]);
    expect(databaseVerificationFailureCodes).toEqual([
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
    ]);
    expect(migrationVerificationGateIds).toEqual([
      "PCAT-DB-M01",
      "PCAT-DB-M02",
      "PCAT-DB-M03",
      "PCAT-DB-M04"
    ]);
    expect(migrationVerificationFailureCodes).toEqual([
      "PCAT-MIG-PACKAGE-INVENTORY-DRIFT",
      "PCAT-MIG-APPLIED-FILE-MISSING",
      "PCAT-MIG-HISTORICAL-ALIAS-INVALID",
      "PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH"
    ]);
    expect(privilegeVerificationGateIds).toEqual(["PCAT-DB-P01", "PCAT-DB-P02"]);
    expect(privilegeVerificationFailureCodes).toEqual([
      "PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS",
      "PCAT-PRIV-LEGACY-WRITER-BYPASS"
    ]);
    expect(comparisonVerificationGateIds).toEqual([
      "PCAT-CMP-D01",
      "PCAT-CMP-D02",
      "PCAT-CMP-D03",
      "PCAT-CMP-D04",
      "PCAT-CMP-D05",
      "PCAT-CMP-D06",
      "PCAT-CMP-D07",
      "PCAT-CMP-D08",
      "PCAT-CMP-D09"
    ]);
    expect(comparisonVerificationFailureCodes).toEqual([
      "PCAT-CMP-D01-DEFINITION-SEMANTICS",
      "PCAT-CMP-D02-SUBJECT-IDENTITY",
      "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
      "PCAT-CMP-D04-BINDING-HISTORY",
      "PCAT-CMP-D05-PROJECT-VALUE-PIN",
      "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
      "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
      "PCAT-CMP-D08-SOURCE-WRITEBACK",
      "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"
    ]);
    expect(reportFailureCodes).toEqual(["PCAT-REPORT-NONDETERMINISTIC"]);
    expect(catalogUpgradeFailureCodes).toEqual([
      "PCAT-UPG-CANDIDATE-DIGEST-MISMATCH"
    ]);
    expect(parameterCatalogFailureFamilies).toEqual([
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
    ]);
  });

  it("freezes every exported failure and verification registry", () => {
    for (const registry of [
      catalogReleaseViolationCodes,
      catalogDriftViolationCodes,
      catalogCurrentGuardFailureCodes,
      apiFailureReasons,
      databaseVerificationGateIds,
      databaseVerificationFailureCodes,
      migrationVerificationGateIds,
      migrationVerificationFailureCodes,
      privilegeVerificationGateIds,
      privilegeVerificationFailureCodes,
      comparisonVerificationGateIds,
      comparisonVerificationFailureCodes,
      comparatorFailureCodes,
      reportFailureCodes,
      catalogUpgradeFailureCodes,
      parameterCatalogFailureFamilies
    ]) {
      expect(Object.isFrozen(registry)).toBe(true);
    }
  });
});
