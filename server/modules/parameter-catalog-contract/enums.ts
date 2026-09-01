export const catalogSubjectKinds = ["driver", "node-type"] as const;
export type CatalogSubjectKind = (typeof catalogSubjectKinds)[number];

export const subjectLifecycles = ["active", "retired"] as const;
export type SubjectLifecycle = (typeof subjectLifecycles)[number];

export const definitionLifecycles = ["active", "deprecated", "retired"] as const;
export type DefinitionLifecycle = (typeof definitionLifecycles)[number];

export const registrationStatuses = ["active", "retired"] as const;
export type RegistrationStatus = (typeof registrationStatuses)[number];

export const placementOrigins = ["auto", "curated"] as const;
export type PlacementOrigin = (typeof placementOrigins)[number];

export const reviewItemStatuses = ["open", "resolved", "out-of-scope"] as const;
export type ReviewItemStatus = (typeof reviewItemStatuses)[number];

export const reviewReasons = [
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed"
] as const;
export type ReviewReason = (typeof reviewReasons)[number];

export const definitionProposalStatuses = [
  "draft",
  "submitted",
  "accepted",
  "rejected",
  "withdrawn"
] as const;
export type DefinitionProposalStatus = (typeof definitionProposalStatuses)[number];

export const catalogInstallModes = ["bootstrap", "advance"] as const;
export type CatalogInstallMode = (typeof catalogInstallModes)[number];

export const catalogSubjectSelectorKinds = [
  "driver-compatible",
  "node-type-name"
] as const;
export type CatalogSubjectSelectorKind = (typeof catalogSubjectSelectorKinds)[number];

export const verificationPurposes = [
  "pre-activation",
  "post-retirement-runtime",
  "isolated-candidate-acceptance",
  "public-release",
  "legacy-read-sunset",
  "p16-cleanup"
] as const;
export type VerificationPurpose = (typeof verificationPurposes)[number];

export const verificationModes = ["fresh", "populated", "restored", "cleanup"] as const;
export type VerificationMode = (typeof verificationModes)[number];

export const verificationGateStatuses = [
  "passed",
  "failed",
  "not-yet-executable",
  "not-applicable"
] as const;
export type VerificationGateStatus = (typeof verificationGateStatuses)[number];

export const verificationDecisions = ["passed", "blocked"] as const;
export type VerificationDecision = (typeof verificationDecisions)[number];

export const comparisonOutcomes = [
  "exact-equivalent",
  "declared-expected-difference",
  "unexplained-difference",
  "unqueryable/protected-reference-missing"
] as const;
export type ComparisonOutcome = (typeof comparisonOutcomes)[number];

export const legacyRowClasses = [
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
] as const;
export type LegacyRowClass = (typeof legacyRowClasses)[number];

export const cutoverPhases = [
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
] as const;
export type CutoverPhase = (typeof cutoverPhases)[number];

export const legacyRetirementStages = ["R-L0", "R-L1", "R-L2", "R-L3"] as const;
export type LegacyRetirementStage = (typeof legacyRetirementStages)[number];

export const legacyIdentifierTypes = [
  "parameter-spec",
  "parameter-spec-version",
  "project-parameter-binding",
  "project-parameter-binding-revision",
  "parameter-subject",
  "parameter-placement",
  "parameter-module"
] as const;
export type LegacyIdentifierType = (typeof legacyIdentifierTypes)[number];

export const emptyReasons = [
  "no-registrations",
  "no-definitions",
  "no-review-work",
  "no-filter-match"
] as const;
export type EmptyReason = (typeof emptyReasons)[number];

export const catalogVerificationCheckCodes = [
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
] as const;
export type CatalogVerificationCheckCode = (typeof catalogVerificationCheckCodes)[number];
