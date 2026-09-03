export {
  canonicalizeP0Graph,
  classifyFrozenP0Graph,
  fingerprintP0Graph,
} from "./classify";
export { classifyPopulatedP0Graph } from "./classifyPopulated";
export type { ClassifierQueryable } from "./classifyPopulated";
export {
  CLASSIFIER_RULE_IDS,
  CLASSIFIER_VERSION,
  DISPOSITION_BY_R_CLASS,
  SAME_KEY_R6_R8_PROPERTY_KEY,
  mappingClassForSourceKind,
} from "./rules";
export {
  MAPPING_CLASSES,
  PRIMARY_DISPOSITIONS,
  R_CLASSES,
} from "./types";
export type {
  ClassificationAssignment,
  ClassificationBlocker,
  ClassificationFailure,
  ClassificationFailureCode,
  ClassificationResult,
  ConservationTotals,
  FrozenP0Graph,
  MappingClass,
  PrimaryDisposition,
  RClass,
} from "./types";
