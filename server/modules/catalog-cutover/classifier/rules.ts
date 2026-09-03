import type { LegacyMappingSourceKind } from "../../parameter-catalog-contract/index";
import type {
  ClassifierRuleId,
  MappingClass,
  PrimaryDisposition,
  RClass,
} from "./types";
import { R_CLASSES } from "./types";

export const CLASSIFIER_VERSION = "1.0.0";

export const CLASSIFIER_RULE_IDS = {
  R0: "PCAT-CLASS-R0-CONTRADICTORY-OR-CROSS-OWNER",
  R1: "PCAT-CLASS-R1-DISPOSABLE-SCAFFOLD",
  R2: "PCAT-CLASS-R2-PROVABLE-DRIVERSCHEMA-ROOT",
  R3: "PCAT-CLASS-R3-AMBIGUOUS-DRIVERSCHEMA-ROOT",
  R4: "PCAT-CLASS-R4-COMPLETE-DRIVER-DTS-PROPERTY",
  R5: "PCAT-CLASS-R5-COMPLETE-NODETYPE-DTS-PROPERTY",
  R6: "PCAT-CLASS-R6-UNLINKED-DTS-PROPERTY-SURFACE",
  R7: "PCAT-CLASS-R7-LEGACY-ACTIVE-NON-DTS",
  R8: "PCAT-CLASS-R8-LEGACY-DRAFT-PROPOSAL",
  R9: "PCAT-CLASS-R9-SUPERSEDED-OR-HISTORICAL",
  R10: "PCAT-CLASS-R10-RESIDUAL-UNKNOWN",
} as const satisfies { readonly [K in RClass]: ClassifierRuleId };

export const DISPOSITION_BY_R_CLASS = {
  R0: "blocked",
  R1: "archived",
  R2: "mapped",
  R3: "review-evidence",
  R4: "mapped",
  R5: "mapped",
  R6: "review-evidence",
  R7: "archived",
  R8: "definition-proposal",
  R9: "mapped",
  R10: "archived",
} as const satisfies { readonly [K in RClass]: PrimaryDisposition };

export const STRUCTURAL_DTS_PROPERTY_KEYS = Object.freeze([
  "compatible",
  "device_type",
  "gpio-controller",
  "interrupt-controller",
  "linux,phandle",
  "phandle",
  "ranges",
  "reg",
  "status",
  "#address-cells",
  "#gpio-cells",
  "#interrupt-cells",
  "#size-cells",
]);

const STRUCTURAL_KEY_SET = new Set(STRUCTURAL_DTS_PROPERTY_KEYS);

export const isStructuralDtsPropertyKey = (propertyKey: string): boolean => {
  const trimmed = propertyKey.trim();
  if (trimmed.startsWith("#")) {
    return true;
  }
  return STRUCTURAL_KEY_SET.has(trimmed.toLowerCase());
};

const SCAFFOLDING_MODULE_NAME =
  /^(spmi\d*|amba(-bus)?|i2c@[0-9a-fA-F]+|pmic@[0-9a-fA-F]+|gic(-v?\d+)?|gpio\d*|batt)$/iu;

export const isLegacyScaffoldingModuleName = (name: string): boolean =>
  SCAFFOLDING_MODULE_NAME.test(name);

export const SAME_KEY_R6_R8_PROPERTY_KEY = "synthetic.legacy-twin";

export const mappingClassForSourceKind = (
  sourceKind: LegacyMappingSourceKind,
): MappingClass => {
  switch (sourceKind) {
    case "parameter-spec":
    case "parameter-spec-version":
    case "driver-schema":
    case "driver-schema-version":
    case "dts-property-spec":
      return "formal-definition";
    case "parameter-subject":
      return "formal-subject";
    case "parameter-module":
    case "parameter-placement":
    case "parameter-module-mapping":
    case "parameter-module-dismissed-compatible":
      return "module-placement";
    case "driver-schema-overlay":
    case "driver-schema-overlay-property":
    case "driver-schema-overlay-promotion":
      return "overlay-publication";
    case "dts-config-revision":
    case "dts-logical-node":
    case "dts-logical-node-revision":
    case "dts-node-occurrence":
    case "dts-property-occurrence":
    case "dts-occurrence-effect":
    case "dts-property-occurrence-spec-decision":
      return "observation-match";
    case "project-parameter-binding":
    case "project-parameter-binding-revision":
      return "binding-value";
    case "legacy-flat-parameter-definition":
    case "legacy-flat-project-parameter-value":
      return "legacy-semantic-store";
    case "parameter-draft":
    case "parameter-submission-round":
    case "parameter-submission-item":
    case "parameter-change-request":
    case "parameter-review-decision":
    case "parameter-spec-review-task":
    case "parameter-spec-matcher-override":
      return "draft-review";
    case "parameter-file-sync-conflict":
    case "parameter-import-batch":
    case "project-parameter-initialization-draft":
    case "project-parameter-initialization-review":
      return "file-import-initialization";
    case "parameter-definition-reconciliation-run":
    case "parameter-definition-reconciliation-item":
    case "parameter-spec-version-cutover-run":
    case "parameter-spec-version-cutover-item":
    case "parameter-spec-property-key-cutover-run":
    case "parameter-spec-property-key-cutover-item":
    case "parameter-identity-migration-run":
    case "parameter-identity-migration-phase":
    case "parameter-identity-cutover":
    case "parameter-history-entry":
    case "legacy-parameter-migration-evidence":
      return "migration-history";
    case "parameter-policy-target":
    case "audit-subject-link":
    case "unresolved-protected-reference":
      return "policy-audit-protected";
  }
};

export const emptyClassCounts = (): { [K in RClass]: number } => {
  const counts = {} as { [K in RClass]: number };
  for (const rClass of R_CLASSES) {
    counts[rClass] = 0;
  }
  return counts;
};
