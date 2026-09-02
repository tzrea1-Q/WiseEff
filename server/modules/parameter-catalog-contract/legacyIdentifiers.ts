const freezeRegistry = <const Values extends readonly string[]>(
  values: Values
): Values => {
  Object.freeze(values);
  return values;
};

export const legacyLookupIdentifierTypes = freezeRegistry([
  "parameter-spec",
  "parameter-spec-version",
  "project-parameter-binding",
  "project-parameter-binding-revision",
  "parameter-subject",
  "parameter-placement",
  "parameter-module"
]);
export type LegacyLookupIdentifierType =
  (typeof legacyLookupIdentifierTypes)[number];

export const legacyMappingSourceKinds = freezeRegistry([
  "parameter-spec",
  "parameter-spec-version",
  "driver-schema",
  "driver-schema-version",
  "dts-property-spec",
  "parameter-subject",
  "parameter-module",
  "parameter-placement",
  "parameter-module-mapping",
  "parameter-module-dismissed-compatible",
  "driver-schema-overlay",
  "driver-schema-overlay-property",
  "driver-schema-overlay-promotion",
  "dts-config-revision",
  "dts-logical-node",
  "dts-logical-node-revision",
  "dts-node-occurrence",
  "dts-property-occurrence",
  "dts-occurrence-effect",
  "dts-property-occurrence-spec-decision",
  "project-parameter-binding",
  "project-parameter-binding-revision",
  "legacy-flat-parameter-definition",
  "legacy-flat-project-parameter-value",
  "parameter-draft",
  "parameter-submission-round",
  "parameter-submission-item",
  "parameter-change-request",
  "parameter-review-decision",
  "parameter-spec-review-task",
  "parameter-spec-matcher-override",
  "parameter-file-sync-conflict",
  "parameter-import-batch",
  "project-parameter-initialization-draft",
  "project-parameter-initialization-review",
  "parameter-definition-reconciliation-run",
  "parameter-definition-reconciliation-item",
  "parameter-spec-version-cutover-run",
  "parameter-spec-version-cutover-item",
  "parameter-spec-property-key-cutover-run",
  "parameter-spec-property-key-cutover-item",
  "parameter-identity-migration-run",
  "parameter-identity-migration-phase",
  "parameter-identity-cutover",
  "parameter-history-entry",
  "legacy-parameter-migration-evidence",
  "parameter-policy-target",
  "audit-subject-link",
  "unresolved-protected-reference"
]);
export type LegacyMappingSourceKind =
  (typeof legacyMappingSourceKinds)[number];

// Compatibility names retain the original seven-item public contract.
export const legacyIdentifierTypes = legacyLookupIdentifierTypes;
export type LegacyIdentifierType = LegacyLookupIdentifierType;
