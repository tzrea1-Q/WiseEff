import { describe, expect, it } from "vitest";

import {
  legacyIdentifierTypes,
  legacyLookupIdentifierTypes,
  legacyMappingSourceKinds,
  type LegacyLookupIdentifierType,
  type LegacyMappingSourceKind
} from "./index";

const publicLookupKind: LegacyLookupIdentifierType = "parameter-spec";
const internalMappingKind: LegacyMappingSourceKind = "driver-schema";

// @ts-expect-error Public lookup kinds have no catch-all.
const inventedLookupKind: LegacyLookupIdentifierType = "driver-schema";

// @ts-expect-error Internal mapping kinds have no catch-all.
const inventedMappingKind: LegacyMappingSourceKind = "legacy-row";

void publicLookupKind;
void internalMappingKind;
void inventedLookupKind;
void inventedMappingKind;

describe("legacy parameter identifier registries", () => {
  it("keeps the public lookup registry at exactly seven kinds", () => {
    expect(legacyLookupIdentifierTypes).toEqual([
      "parameter-spec",
      "parameter-spec-version",
      "project-parameter-binding",
      "project-parameter-binding-revision",
      "parameter-subject",
      "parameter-placement",
      "parameter-module"
    ]);
    expect(legacyIdentifierTypes).toBe(legacyLookupIdentifierTypes);
    expect(Object.isFrozen(legacyLookupIdentifierTypes)).toBe(true);
  });

  it("keeps the internal mapping registry at exactly 49 named kinds", () => {
    expect(legacyMappingSourceKinds).toEqual([
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
    expect(legacyMappingSourceKinds).toHaveLength(49);
    expect(legacyMappingSourceKinds).not.toBe(legacyLookupIdentifierTypes);
    expect(Object.isFrozen(legacyMappingSourceKinds)).toBe(true);
  });
});
