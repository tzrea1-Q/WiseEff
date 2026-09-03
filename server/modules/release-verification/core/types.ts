import type {
  VerificationDecision,
  VerificationGateStatus,
  VerificationMode,
  VerificationPurpose,
} from "../../parameter-catalog-contract/index";

export type {
  VerificationDecision,
  VerificationGateStatus,
  VerificationMode,
  VerificationPurpose,
};

export type VerificationPlanId = string & { readonly __brand: "VerificationPlanId" };
export type VerificationAttemptId = string & { readonly __brand: "VerificationAttemptId" };
export type VerificationReportId = string & { readonly __brand: "VerificationReportId" };
export type VerificationApprovalId = string & { readonly __brand: "VerificationApprovalId" };
export type VerificationPlanDigest = string & { readonly __brand: "VerificationPlanDigest" };
export type VerificationReportDigest = string & { readonly __brand: "VerificationReportDigest" };
export type VerificationAttemptDigest = string & { readonly __brand: "VerificationAttemptDigest" };
export type GateRegistryDigest = string & { readonly __brand: "GateRegistryDigest" };

export const VerificationPlanId = (value: string): VerificationPlanId =>
  value as VerificationPlanId;
export const VerificationAttemptId = (value: string): VerificationAttemptId =>
  value as VerificationAttemptId;
export const VerificationReportId = (value: string): VerificationReportId =>
  value as VerificationReportId;
export const VerificationApprovalId = (value: string): VerificationApprovalId =>
  value as VerificationApprovalId;
export const VerificationPlanDigest = (value: string): VerificationPlanDigest =>
  value as VerificationPlanDigest;
export const VerificationReportDigest = (value: string): VerificationReportDigest =>
  value as VerificationReportDigest;
export const VerificationAttemptDigest = (value: string): VerificationAttemptDigest =>
  value as VerificationAttemptDigest;
export const GateRegistryDigest = (value: string): GateRegistryDigest =>
  value as GateRegistryDigest;

export type VerificationSubject = {
  readonly targetId: string;
  readonly deploymentClass: string;
  readonly environmentId: string;
};

export type PointerRollbackStatus = "open" | "closed";
export type TrafficIsolationState = "isolated" | "public";

export type VerificationLineage = {
  readonly phaseSnapshot: string;
  readonly predecessorReportDigests: readonly string[];
  readonly p12State: string;
  readonly p13State: string;
  readonly writerRetirementFingerprint: string | null;
  readonly runtimePinGeneration: string | null;
  readonly pointerRollbackStatus: PointerRollbackStatus;
  readonly trafficIsolationState: TrafficIsolationState;
};

export type VerificationPins = {
  readonly artifact: {
    readonly gitSha: string;
    readonly releaseTag: string;
    readonly packageManifestDigest: string;
    readonly apiImageDigest: string;
    readonly workerImageDigest: string;
    readonly webImageDigest: string;
  };
  readonly catalog: {
    readonly releaseId: string;
    readonly releaseDigest: string;
    readonly compiledModelDigest: string;
    readonly materializationFingerprint: string;
  };
  readonly database: {
    readonly targetIdentity: string;
    readonly schemaVersion: string;
    readonly migrationInventoryDigest: string;
  };
  readonly cutover: {
    readonly planDigest: string;
    readonly contractVersion: string;
    readonly sourceSnapshotFingerprint: string;
  };
  readonly mappingArchive: {
    readonly mappingEpoch: string;
    readonly mappingHeadDigest: string;
    readonly archiveManifestDigest: string;
  };
  readonly recovery: {
    readonly recoveryPointId: string;
    readonly recoveryPointDigest: string;
  };
  readonly acceptance: {
    readonly openApiDigest: string;
    readonly browserBundleSha: string;
  };
  readonly target: {
    readonly deploymentId: string;
    readonly hostFingerprint: string;
  };
  readonly verification: {
    readonly contractVersion: string;
    readonly verifierRole: string;
  };
};

export type EvidenceRequirements = {
  readonly recoveryPointDigest: string;
  readonly mappingEpoch: string;
  readonly cutoverPlanDigest: string;
  readonly acceptanceContractDigest: string;
};

export type GateFamily =
  | "database"
  | "migration"
  | "privilege"
  | "comparison"
  | "api"
  | "browser"
  | "recovery"
  | "writer"
  | "observability"
  | "rollback"
  | "runtime-pin"
  | "lineage"
  | "retirement"
  | "restore";

export type VerificationGateId = string & { readonly __brand: "VerificationGateId" };
export const VerificationGateId = (value: string): VerificationGateId =>
  value as VerificationGateId;

export type GateApplicability =
  | { readonly status: "required-now" }
  | {
      readonly status: "not-yet-executable";
      readonly successorPurpose: VerificationPurpose;
    }
  | { readonly status: "not-applicable"; readonly proof: string };

export type PurposeGateProfileEntry = {
  readonly gateId: VerificationGateId;
  readonly family: GateFamily;
  readonly failureCode: string;
  readonly applicability: GateApplicability;
};

export type VerificationPlan = {
  readonly id: VerificationPlanId;
  readonly digest: VerificationPlanDigest;
  readonly canonicalBytes: string;
  readonly purpose: VerificationPurpose;
  readonly mode: VerificationMode;
  readonly subject: VerificationSubject;
  readonly lineage: VerificationLineage;
  readonly pins: VerificationPins;
  readonly evidenceRequirements: EvidenceRequirements;
  readonly registryDigest: GateRegistryDigest;
  readonly gateSelectionSource: "registry";
  readonly applicabilityProfile: readonly PurposeGateProfileEntry[];
  readonly createdAt: string;
};

export type GateResult = {
  readonly gateId: VerificationGateId;
  readonly status: VerificationGateStatus;
  readonly failureCode: string | null;
  readonly evidenceDigest: string | null;
  readonly successorPurpose: VerificationPurpose | null;
  readonly notApplicableProof: string | null;
};

export type VerificationAttemptSnapshot = {
  readonly id: VerificationAttemptId;
  readonly digest: VerificationAttemptDigest;
  readonly planId: VerificationPlanId;
  readonly planDigest: VerificationPlanDigest;
  readonly purpose: VerificationPurpose;
  readonly results: readonly GateResult[];
  readonly createdAt: string;
};

export type TypedEvidenceRef = {
  readonly gateId: VerificationGateId;
  readonly digest: string;
  readonly producer: string;
};

export type ReleaseVerificationReport = {
  readonly id: VerificationReportId;
  readonly digest: VerificationReportDigest;
  readonly canonicalBytes: string;
  readonly planId: VerificationPlanId;
  readonly planDigest: VerificationPlanDigest;
  readonly attemptId: VerificationAttemptId;
  readonly attemptDigest: VerificationAttemptDigest;
  readonly purpose: VerificationPurpose;
  readonly mode: VerificationMode;
  readonly decision: VerificationDecision;
  readonly results: readonly GateResult[];
  readonly evidenceRefs: readonly TypedEvidenceRef[];
  readonly registryDigest: GateRegistryDigest;
  readonly assembledAt: string;
};

export type ApprovalPrincipalKind = "operator" | "platform-owner";

export type ApprovalCommand = {
  readonly principalKind: ApprovalPrincipalKind | "verifier";
  readonly principalId: string;
  readonly purpose: VerificationPurpose;
};

export type ReleaseApprovalRecord = {
  readonly id: VerificationApprovalId;
  readonly reportId: VerificationReportId;
  readonly reportDigest: VerificationReportDigest;
  readonly purpose: VerificationPurpose;
  readonly principalKind: ApprovalPrincipalKind;
  readonly principalId: string;
  readonly approvedAt: string;
};

export type ReadReportAbsenceReason = "missing" | "unapproved";

export type ReadReportResult =
  | { readonly kind: "present"; readonly report: ReleaseVerificationReport }
  | { readonly kind: "absent"; readonly reason: ReadReportAbsenceReason };

export type PrepareVerificationInput = {
  readonly subject: VerificationSubject;
  readonly purpose: string;
  readonly mode: string;
  readonly lineage: VerificationLineage;
  readonly pins: VerificationPins;
  readonly evidenceRequirements: EvidenceRequirements;
};

export type GateAdapter = (input: {
  readonly gateId: VerificationGateId;
  readonly plan: VerificationPlan;
}) => Promise<GateResult>;
