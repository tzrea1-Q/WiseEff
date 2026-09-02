const freezeRegistry = <const Values extends readonly unknown[]>(values: Values): Values => {
  Object.freeze(values);
  return values;
};

export const catalogSubjectKinds = freezeRegistry(["driver", "node-type"]);
export type CatalogSubjectKind = (typeof catalogSubjectKinds)[number];

export const driverNatures = freezeRegistry([
  "physical-device",
  "logical-service"
]);
export type DriverNature = (typeof driverNatures)[number];

export const driverInstanceCardinalities = freezeRegistry([
  "multiple",
  "singleton-per-project"
]);
export type DriverInstanceCardinality =
  (typeof driverInstanceCardinalities)[number];

export const subjectLifecycles = freezeRegistry(["active", "retired"]);
export type SubjectLifecycle = (typeof subjectLifecycles)[number];

export const definitionLifecycles = freezeRegistry(["active", "deprecated", "retired"]);
export type DefinitionLifecycle = (typeof definitionLifecycles)[number];

export const registrationStatuses = freezeRegistry(["active", "retired"]);
export type RegistrationStatus = (typeof registrationStatuses)[number];

export const placementOrigins = freezeRegistry(["auto", "curated"]);
export type PlacementOrigin = (typeof placementOrigins)[number];

export const reviewItemStatuses = freezeRegistry(["open", "resolved", "out-of-scope"]);
export type ReviewItemStatus = (typeof reviewItemStatuses)[number];

export const reviewReasons = freezeRegistry([
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed"
]);
export type ReviewReason = (typeof reviewReasons)[number];

export const definitionProposalStatuses = freezeRegistry([
  "draft",
  "submitted",
  "accepted",
  "rejected",
  "withdrawn"
]);
export type DefinitionProposalStatus = (typeof definitionProposalStatuses)[number];

export const catalogInstallModes = freezeRegistry(["bootstrap", "advance"]);
export type CatalogInstallMode = (typeof catalogInstallModes)[number];

export const catalogSubjectSelectorKinds = freezeRegistry([
  "driver-compatible",
  "node-type-name"
]);
export type CatalogSubjectSelectorKind = (typeof catalogSubjectSelectorKinds)[number];

export const verificationPurposes = freezeRegistry([
  "pre-activation",
  "post-retirement-runtime",
  "isolated-candidate-acceptance",
  "public-release",
  "legacy-read-sunset",
  "p16-cleanup"
]);
export type VerificationPurpose = (typeof verificationPurposes)[number];

export const verificationModes = freezeRegistry([
  "fresh",
  "populated",
  "restored",
  "cleanup"
]);
export type VerificationMode = (typeof verificationModes)[number];

export const verificationGateStatuses = freezeRegistry([
  "passed",
  "failed",
  "not-yet-executable",
  "not-applicable"
]);
export type VerificationGateStatus = (typeof verificationGateStatuses)[number];

export const verificationDecisions = freezeRegistry(["passed", "blocked"]);
export type VerificationDecision = (typeof verificationDecisions)[number];

export const comparisonOutcomes = freezeRegistry([
  "exact-equivalent",
  "declared-expected-difference",
  "unexplained-difference",
  "unqueryable/protected-reference-missing"
]);
export type ComparisonOutcome = (typeof comparisonOutcomes)[number];

export const legacyRowClasses = freezeRegistry([
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
export type LegacyRowClass = (typeof legacyRowClasses)[number];

export const cutoverPhases = freezeRegistry([
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
export type CutoverPhase = (typeof cutoverPhases)[number];

export const legacyRetirementStages = freezeRegistry(["R-L0", "R-L1", "R-L2", "R-L3"]);
export type LegacyRetirementStage = (typeof legacyRetirementStages)[number];

export const emptyReasons = freezeRegistry([
  "no-registrations",
  "no-definitions",
  "no-review-work",
  "no-filter-match"
]);
export type EmptyReason = (typeof emptyReasons)[number];

export const catalogVerificationCheckCodes = freezeRegistry([
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
export type CatalogVerificationCheckCode = (typeof catalogVerificationCheckCodes)[number];
