import { describe, expect, it } from "vitest";

import {
  catalogInstallModes,
  catalogSubjectSelectorKinds,
  catalogVerificationCheckCodes,
  comparisonOutcomes,
  cutoverPhases,
  definitionProposalStatuses,
  definitionLifecycles,
  emptyReasons,
  legacyIdentifierTypes,
  legacyRetirementStages,
  legacyRowClasses,
  placementOrigins,
  registrationStatuses,
  reviewItemStatuses,
  reviewReasons,
  subjectLifecycles,
  verificationDecisions,
  verificationGateStatuses,
  verificationModes,
  verificationPurposes,
  type CatalogSubjectKind,
  catalogSubjectKinds
} from "./index";

const driverKind: CatalogSubjectKind = "driver";

// @ts-expect-error Subject kinds are a closed wire literal set.
const inventedSubjectKind: CatalogSubjectKind = "device";

void driverKind;
void inventedSubjectKind;

const describeSubjectKind = (kind: CatalogSubjectKind): string => {
  switch (kind) {
    case "driver":
      return "Driver";
    case "node-type":
      return "NodeType";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

describe("parameter catalog closed literals", () => {
  it("keeps canonical subject and lifecycle values closed", () => {
    expect(catalogSubjectKinds).toEqual(["driver", "node-type"]);
    expect(subjectLifecycles).toEqual(["active", "retired"]);
    expect(definitionLifecycles).toEqual(["active", "deprecated", "retired"]);
    expect(registrationStatuses).toEqual(["active", "retired"]);
    expect(placementOrigins).toEqual(["auto", "curated"]);
    expect(reviewItemStatuses).toEqual(["open", "resolved", "out-of-scope"]);
    expect(reviewReasons).toEqual([
      "unknown",
      "ambiguous",
      "placement-conflict",
      "retired-registration-observed"
    ]);
    expect(definitionProposalStatuses).toEqual([
      "draft",
      "submitted",
      "accepted",
      "rejected",
      "withdrawn"
    ]);
    expect(describeSubjectKind("node-type")).toBe("NodeType");
  });

  it("freezes verification, comparison, retirement, and empty-state literals", () => {
    expect(verificationPurposes).toEqual([
      "pre-activation",
      "post-retirement-runtime",
      "isolated-candidate-acceptance",
      "public-release",
      "legacy-read-sunset",
      "p16-cleanup"
    ]);
    expect(verificationModes).toEqual(["fresh", "populated", "restored", "cleanup"]);
    expect(verificationGateStatuses).toEqual([
      "passed",
      "failed",
      "not-yet-executable",
      "not-applicable"
    ]);
    expect(verificationDecisions).toEqual(["passed", "blocked"]);
    expect(comparisonOutcomes).toEqual([
      "exact-equivalent",
      "declared-expected-difference",
      "unexplained-difference",
      "unqueryable/protected-reference-missing"
    ]);
    expect(legacyRowClasses).toEqual([
      "R0",
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
      "R8",
      "R9",
      "R10"
    ]);
    expect(emptyReasons).toEqual([
      "no-registrations",
      "no-definitions",
      "no-review-work",
      "no-filter-match"
    ]);
    expect(cutoverPhases).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
      "P9",
      "P10",
      "P11",
      "P12",
      "P13",
      "P14",
      "P15",
      "P16"
    ]);
    expect(legacyRetirementStages).toEqual(["R-L0", "R-L1", "R-L2", "R-L3"]);
    expect(legacyIdentifierTypes).toEqual([
      "parameter-spec",
      "parameter-spec-version",
      "project-parameter-binding",
      "project-parameter-binding-revision",
      "parameter-subject",
      "parameter-placement",
      "parameter-module"
    ]);
    expect(catalogInstallModes).toEqual(["bootstrap", "advance"]);
    expect(catalogSubjectSelectorKinds).toEqual([
      "driver-compatible",
      "node-type-name"
    ]);
    expect(catalogVerificationCheckCodes).toEqual([
      "compiled-release",
      "release-lineage",
      "subject-memberships",
      "alias-memberships",
      "definition-revisions",
      "definition-heads",
      "release-head-provenance",
      "current-pointer",
      "materialization-fingerprint",
      "organization-structural-absence"
    ]);
  });

  it("freezes every exported enum registry without a mutable canonical copy", () => {
    for (const registry of [
      catalogSubjectKinds,
      subjectLifecycles,
      definitionLifecycles,
      registrationStatuses,
      placementOrigins,
      reviewItemStatuses,
      reviewReasons,
      definitionProposalStatuses,
      catalogInstallModes,
      catalogSubjectSelectorKinds,
      verificationPurposes,
      verificationModes,
      verificationGateStatuses,
      verificationDecisions,
      comparisonOutcomes,
      legacyRowClasses,
      cutoverPhases,
      legacyRetirementStages,
      legacyIdentifierTypes,
      emptyReasons,
      catalogVerificationCheckCodes
    ]) {
      expect(Object.isFrozen(registry)).toBe(true);
    }
    expect(() =>
      (catalogSubjectKinds as unknown as string[]).push("invented-subject-kind")
    ).toThrow(TypeError);
  });
});
