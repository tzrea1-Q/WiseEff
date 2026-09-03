import type { LegacyMappingSourceKind } from "../../parameter-catalog-contract/index";

export const R_CLASSES = [
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
  "R10",
] as const;
export type RClass = (typeof R_CLASSES)[number];

export const PRIMARY_DISPOSITIONS = [
  "blocked",
  "mapped",
  "archived",
  "review-evidence",
  "definition-proposal",
] as const;
export type PrimaryDisposition = (typeof PRIMARY_DISPOSITIONS)[number];

export const MAPPING_CLASSES = [
  "formal-definition",
  "formal-subject",
  "module-placement",
  "overlay-publication",
  "observation-match",
  "binding-value",
  "legacy-semantic-store",
  "draft-review",
  "file-import-initialization",
  "migration-history",
  "policy-audit-protected",
] as const;
export type MappingClass = (typeof MAPPING_CLASSES)[number];

export type OwnerScopeKind = "platform" | "organization" | "project";

export type FrozenLegacyIdentity = {
  readonly id: string;
  readonly sourceSystem: string;
  readonly sourceKind: LegacyMappingSourceKind;
  readonly ownerScopeKind: OwnerScopeKind;
  readonly ownerScopeId: string;
  readonly sourceId: string;
};

export type FrozenSpec = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly sourceKind: "dts" | "json" | "manual";
  readonly specificationKey: string;
  readonly attributionSubjectId: string | null;
  readonly definitionLifecycle: "draft" | "active" | "deprecated";
  readonly propertyKey: string | null;
};

export type FrozenSpecVersion = {
  readonly id: string;
  readonly parameterSpecId: string;
  readonly version: number;
  readonly lifecycle: "draft" | "active" | "deprecated";
  readonly versionStatus: "draft" | "active" | "superseded";
};

export type FrozenSubject = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly subjectKind: "driver-registration" | "node-type-definition";
};

export type FrozenDriverRegistration = {
  readonly attributionSubjectId: string;
};

export type FrozenNodeTypeDefinition = {
  readonly attributionSubjectId: string;
};

export type FrozenDriverSchema = {
  readonly id: string;
  readonly parameterSpecId: string;
  readonly organizationId: string | null;
  readonly attributionSubjectId: string | null;
};

export type FrozenDriverSchemaVersion = {
  readonly id: string;
  readonly driverSchemaId: string;
  readonly lifecycle: "draft" | "active" | "deprecated";
};

export type FrozenDtsProperty = {
  readonly id: string;
  readonly parameterSpecId: string;
  readonly driverSchemaId: string | null;
  readonly propertyKey: string;
};

export type FrozenModule = {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: "business" | "driver-group" | "node-type" | "unclassified";
  readonly origin: "curated" | "auto";
  readonly name: string;
  readonly attributionSubjectId: string | null;
};

export type FrozenPlacement = {
  readonly id: string;
  readonly organizationId: string;
  readonly attributionSubjectId: string;
  readonly driverGroupModuleId: string;
};

export type FrozenBinding = {
  readonly id: string;
  readonly organizationId: string;
  readonly parameterSpecId: string;
  readonly moduleId: string;
};

export type FrozenBindingRevision = {
  readonly id: string;
  readonly bindingId: string;
  readonly parameterSpecVersionId: string;
};

export type FrozenP0Graph = {
  readonly catalog: "parameter-catalog-p0-graph";
  readonly identities: readonly FrozenLegacyIdentity[];
  readonly specs: readonly FrozenSpec[];
  readonly specVersions: readonly FrozenSpecVersion[];
  readonly subjects: readonly FrozenSubject[];
  readonly driverRegistrations: readonly FrozenDriverRegistration[];
  readonly nodeTypeDefinitions: readonly FrozenNodeTypeDefinition[];
  readonly driverSchemas: readonly FrozenDriverSchema[];
  readonly driverSchemaVersions: readonly FrozenDriverSchemaVersion[];
  readonly dtsPropertySpecs: readonly FrozenDtsProperty[];
  readonly modules: readonly FrozenModule[];
  readonly placements: readonly FrozenPlacement[];
  readonly bindings: readonly FrozenBinding[];
  readonly bindingRevisions: readonly FrozenBindingRevision[];
};

export type ClassifierRuleId =
  | "PCAT-CLASS-R0-CONTRADICTORY-OR-CROSS-OWNER"
  | "PCAT-CLASS-R1-DISPOSABLE-SCAFFOLD"
  | "PCAT-CLASS-R2-PROVABLE-DRIVERSCHEMA-ROOT"
  | "PCAT-CLASS-R3-AMBIGUOUS-DRIVERSCHEMA-ROOT"
  | "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY"
  | "PCAT-CLASS-R5-COMPLETE-NODETYPE-DTS-PROPERTY"
  | "PCAT-CLASS-R6-UNLINKED-DTS-PROPERTY-SURFACE"
  | "PCAT-CLASS-R7-LEGACY-ACTIVE-NON-DTS"
  | "PCAT-CLASS-R8-LEGACY-DRAFT-PROPOSAL"
  | "PCAT-CLASS-R9-SUPERSEDED-OR-HISTORICAL"
  | "PCAT-CLASS-R10-RESIDUAL-UNKNOWN";

export type ClassificationAssignment = {
  readonly identityId: string;
  readonly sourceKind: LegacyMappingSourceKind;
  readonly sourceId: string;
  readonly ownerScopeKind: OwnerScopeKind;
  readonly ownerScopeId: string;
  readonly rClass: RClass;
  readonly ruleId: ClassifierRuleId;
  readonly disposition: PrimaryDisposition;
  readonly mappingClass: MappingClass;
  readonly propertyKey: string | null;
};

export type ClassificationBlocker = {
  readonly identityId: string;
  readonly rClass: "R0";
  readonly ruleId: "PCAT-CLASS-R0-CONTRADICTORY-OR-CROSS-OWNER";
  readonly disposition: "blocked";
  readonly invariant: string;
  readonly graphFingerprint: string;
};

export type ConservationTotals = {
  readonly inputCount: number;
  readonly classifiedCount: number;
  readonly duplicatePrimaryCount: number;
  readonly classCounts: { readonly [K in RClass]: number };
  readonly dispositionCounts: { readonly [K in PrimaryDisposition]: number };
  readonly conserved: boolean;
};

export type ClassificationResult = {
  readonly classifierVersion: string;
  readonly graphFingerprint: string;
  readonly conservation: ConservationTotals;
  readonly blockers: readonly ClassificationBlocker[];
  readonly assignments: readonly ClassificationAssignment[];
};

export type ClassificationFailureCode =
  | "PCAT-CLASS-SOURCE-CONSERVATION"
  | "PCAT-CLASS-DUPLICATE-PRIMARY"
  | "PCAT-CLASS-GRAPH-INVALID";

export type ClassificationFailure = {
  readonly code: ClassificationFailureCode;
  readonly detail: string;
};
