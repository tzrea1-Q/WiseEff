export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixId, ThreatMatrixRow } from "./threatMatrix";
export { createReleaseVerificationService } from "./service";
export type { ReleaseVerificationService } from "./service";
export {
  RELEASE_VERIFICATION_GATES,
  auxiliaryVerificationGateIds,
  apiVerificationGateIds,
  browserVerificationGateIds,
  closedGateIds,
  gateApplicability,
  gateRegistryDigest,
  purposeProfile,
  MISSING_APPLICABLE_GATE_FAILURE,
} from "./gateRegistry";
export { verificationLockKeys, prepareLockMaterial, subjectKey } from "./lock";
export { VERIFICATION_CORE_MIGRATION } from "./migrationName";
export type { VerificationRefusal, VerificationRefusalKind } from "./errors";
export type {
  ApprovalCommand,
  ApprovalPrincipalKind,
  EvidenceRequirements,
  GateAdapter,
  GateEvidenceDigest,
  GateResult,
  PrepareVerificationInput,
  PurposeGateProfileEntry,
  ReadReportAbsenceReason,
  ReadReportResult,
  ReleaseApprovalRecord,
  ReleaseVerificationReport,
  RetentionDeadlineInputs,
  TypedEvidenceRef,
  VerificationAttemptSnapshot,
  VerificationLineage,
  VerificationPins,
  VerificationPlan,
  VerificationSubject,
  WriterReachability,
} from "./types";
