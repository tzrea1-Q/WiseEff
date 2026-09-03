export {
  fingerprintRegistrationCommand,
  registrationCommandFamily,
  validateRegistrationCommand,
} from "./command";
export type {
  MovePlacementCommand,
  RegisterSubjectCommand,
  RegistrationCommand,
  RegistrationProof,
  RestoreRegistrationCommand,
  RetireRegistrationCommand,
  TrustedInvocationContext,
} from "./command";
export type { RegistrationFailure } from "./failures";
export { createRegistrationService, executeRegistration } from "./service";
export type { RegistrationService } from "./service";
export type { RegistrationMethod, RegistrationResult, Result } from "./result";
export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixRow } from "./threatMatrix";
