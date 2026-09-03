export {
  appendMappingVersion,
  readCurrentMappingHead,
  rewriteMappingVersion,
} from "./map";
export { lookupProtectedIdentity } from "./lookup";
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
