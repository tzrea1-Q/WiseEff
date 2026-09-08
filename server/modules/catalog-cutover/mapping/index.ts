export {
  appendMappingVersion,
  readCurrentMappingHead,
  rewriteMappingVersion,
} from "./map";
export { lookupProtectedIdentity } from "./lookup";
export { readMappingInventory, readMappingSnapshot, readProtectedIdentityInventory, mappingHeadDigest, MappingInventoryError } from "./snapshot";
export type { MappingInventoryHead, MappingSourceIdentity, MappingSnapshotMember } from "./snapshot";
export { capturePhysicalSourceIdentities, readLegacySourceRegistry, capturePlannedSourceIdentities, registerPlannedSourceIdentities, SourceIdentityRefusal } from "./sourceIdentity";
export { MAPPING_FAILURE_CODES, MAPPING_TARGET_KINDS } from "./types";
export type {
  AppendMappingInput,
  AppendMappingResult,
  LookupProtectedIdentityInput,
  MappingFailure,
  MappingFailureCode,
  MappingHead,
  MappingHeadExpectation,
  MappingOutcome,
  MappingQueryable,
  MappingResult,
  MappingTargetKind,
  MappingVersion,
  ProtectedIdentityKey,
  ProtectedLookupResult,
  ReadMappingHeadInput,
  RewriteMappingVersionInput,
} from "./types";
