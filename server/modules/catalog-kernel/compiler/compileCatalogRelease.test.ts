import { describe, expect, it } from "vitest";

import {
  catalogCompilerContract,
  catalogCompilerContractFingerprint,
  compileCatalogRelease,
} from "./index";
import {
  fingerprintContractArtifacts,
  stableCatalogRules,
} from "./contractArtifacts";
import {
  parseStableCatalogRules,
  type StableCatalogRules,
} from "./stableRules";
import { validateForCompilation } from "./validation";
import {
  duplicateDefinitionIdentityBundle,
  conflictingDuplicateDefinitionBundle,
  aliasCanonicalCollisionBundle,
  invalidCanonicalPropertyBundle,
  danglingDefinitionSuccessorBundle,
  forbiddenValueSchemaReferenceBundle,
  invalidPublicationTimeBundle,
  invalidRetirementProvenanceBundle,
  invalidValueSchemaBundle,
  lineageGapBundle,
  lifecycleTombstoneMismatchBundle,
  malformedYamlSourceBundle,
  manifestDocumentMissingBundle,
  manifestDocumentUnlistedBundle,
  missingSourceEntryBundle,
  omittedPredecessorAliasBundle,
  reassignedSubjectIdentityBundle,
  reorderCatalogReleaseBundle,
  staleSourceDigestBundle,
  staleAggregateDigestBundle,
  staleNormalizedContentBundle,
  unlistedSourceEntryBundle,
  unrelatedAuthoritativeSourceBundle,
  validCatalogReleaseBundle,
  revisionSequenceGapBundle,
} from "./__fixtures__/catalogReleaseBundle";
import { compiledReleaseGolden } from "./__fixtures__/compiledReleaseGolden";

describe("compileCatalogRelease", () => {
  type Mutable<Value> = Value extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
      : Value;

  const withRules = (
    mutate: (rules: Mutable<StableCatalogRules>) => void,
  ): StableCatalogRules => {
    const rules = structuredClone(
      stableCatalogRules,
    ) as Mutable<StableCatalogRules>;
    mutate(rules);
    return rules;
  };

  const validationDetails = (
    bundle: Parameters<typeof validateForCompilation>[0],
    rules: StableCatalogRules,
  ): readonly string[] => {
    const validation = validateForCompilation(bundle, rules);
    return [
      ...validation.source,
      ...validation.compile,
      ...validation.lineage,
    ].map((entry) => entry.detail);
  };

  it("emits byte-identical output when bundle enumeration order changes", () => {
    const bundle = validCatalogReleaseBundle();
    const reordered = reorderCatalogReleaseBundle(bundle);

    const first = compileCatalogRelease(bundle);
    const second = compileCatalogRelease(reordered);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.bytes).toBe(first.value.bytes);
    expect(second.value.compiledReleaseDigest).toBe(
      first.value.compiledReleaseDigest,
    );
    expect(second.value.toolchainDigest).toBe(first.value.toolchainDigest);
  });

  it("publishes a closed compiler contract bound to the S1-BND artifacts", () => {
    expect(catalogCompilerContract).toMatchObject({
      contractVersion: "1.0.0",
      input: {
        bundleSchemaVersion: "1.0.0",
        s1BundleContractArtifactDigest: expect.stringMatching(
          /^sha256:[0-9a-f]{64}$/u,
        ),
      },
      output: {
        modelSchemaVersion: "1.0.0",
        includesExactSourceBytes: false,
      },
    });
    expect(catalogCompilerContractFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
    expect(Object.isFrozen(catalogCompilerContract)).toBe(true);
    expect(Object.isFrozen(stableCatalogRules)).toBe(true);
    expect(Object.isFrozen(stableCatalogRules.identityRules)).toBe(true);
  });

  it("returns an immutable compiled projection without raw source bytes", () => {
    const bundle = validCatalogReleaseBundle();
    const result = compileCatalogRelease(bundle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.model.compilerContractFingerprint).toBe(
      catalogCompilerContractFingerprint,
    );
    expect(
      result.value.model.releases.every((release) => !("sources" in release)),
    ).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.model.releases[0]?.documents[0])).toBe(
      true,
    );
    expect(Object.isFrozen(bundle.releases[0]?.documents[0])).toBe(false);

    const bytes = result.value.bytes;
    Object.defineProperty(bundle, "targetReleaseId", {
      value: "crel_tampered",
    });
    expect(result.value.bytes).toBe(bytes);
  });

  it("rejects normalized declarations that were not derived from exact YAML", () => {
    const result = compileCatalogRelease(unrelatedAuthoritativeSourceBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("source");
    expect(result.error.violations).toContainEqual(
      expect.objectContaining({
        code: "normalization-nondeterministic",
        detail: "source-document-authority-mismatch",
      }),
    );
  });

  it("frames contract artifacts so newline-boundary collisions differ", () => {
    const splitAfterNewline = fingerprintContractArtifacts([
      { path: "a", bytes: "left\n" },
      { path: "b", bytes: "right" },
    ]);
    const splitBeforeNewline = fingerprintContractArtifacts([
      { path: "a", bytes: "left" },
      { path: "b", bytes: "\nright" },
    ]);

    expect(splitAfterNewline).not.toBe(splitBeforeNewline);
  });

  it("drives every semantic rule group from the typed S1-BND rules artifact", () => {
    const cases: readonly {
      readonly name: string;
      readonly bundle: Parameters<typeof validateForCompilation>[0];
      readonly detail: string;
      readonly rules: StableCatalogRules;
    }[] = [
      {
        name: "manifestRules",
        bundle: manifestDocumentUnlistedBundle(),
        detail: "document-entry-not-listed-by-manifest",
        rules: withRules((rules) => {
          rules.manifestRules.exactDocumentSet = false;
        }),
      },
      {
        name: "definitionRevisionRules",
        bundle: revisionSequenceGapBundle(),
        detail: "definition-revision-sequence-gap",
        rules: withRules((rules) => {
          rules.definitionRevisionRules.transitionRules.changedContentRevisionIncrement = 2;
        }),
      },
      {
        name: "valueSchemaRules",
        bundle: forbiddenValueSchemaReferenceBundle(),
        detail: "definition-value-schema-ref-forbidden",
        rules: withRules((rules) => {
          rules.valueSchemaRules.forbiddenReferenceKeywords = [];
        }),
      },
      {
        name: "definitionLifecycleRules",
        bundle: danglingDefinitionSuccessorBundle(),
        detail: "definition-successor-missing",
        rules: withRules((rules) => {
          rules.definitionLifecycleRules.requireExistingSuccessor = false;
        }),
      },
      {
        name: "lineageRules",
        bundle: lineageGapBundle(),
        detail: "release-sequence-gap",
        rules: withRules((rules) => {
          rules.lineageRules.requireGapFreeSequence = false;
        }),
      },
      {
        name: "identityRules",
        bundle: duplicateDefinitionIdentityBundle(),
        detail: "definition-id-duplicate-in-release",
        rules: withRules((rules) => {
          for (const rule of rules.identityRules) rule.uniquePerRelease = false;
        }),
      },
      {
        name: "selectorRules",
        bundle: aliasCanonicalCollisionBundle(),
        detail: "alias-canonical-selector-collision",
        rules: withRules((rules) => {
          rules.selectorRules.forbidAliasCanonicalCollision = false;
        }),
      },
      {
        name: "retirementRules",
        bundle: invalidRetirementProvenanceBundle(),
        detail: "retirement-previous-selector-mismatch",
        rules: withRules((rules) => {
          rules.retirementRules.requireExactPredecessorSelector = false;
          rules.retirementRules.preserveOriginalPreviousSelector = false;
        }),
      },
      {
        name: "membershipRules",
        bundle: omittedPredecessorAliasBundle(),
        detail: "predecessor-alias-membership-omitted",
        rules: withRules((rules) => {
          rules.membershipRules.requirePredecessorAliases = false;
        }),
      },
    ];

    for (const entry of cases) {
      expect(
        validationDetails(entry.bundle, stableCatalogRules),
        `${entry.name} baseline`,
      ).toContain(entry.detail);
      expect(
        validationDetails(entry.bundle, entry.rules),
        `${entry.name} override`,
      ).not.toContain(entry.detail);
    }
  });

  it("fails closed when any stable semantic rule group drifts out of the artifact", () => {
    const groups = [
      "manifestRules",
      "definitionRevisionRules",
      "valueSchemaRules",
      "definitionLifecycleRules",
      "lineageRules",
      "identityRules",
      "selectorRules",
      "retirementRules",
      "membershipRules",
    ] as const;

    for (const group of groups) {
      const drifted = structuredClone(stableCatalogRules) as unknown as Record<
        string,
        unknown
      >;
      delete drifted[group];
      expect(() => parseStableCatalogRules(drifted), group).toThrow();
    }
  });

  it("matches the compiler contract golden fingerprint and output digest", () => {
    const result = compileCatalogRelease(validCatalogReleaseBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect({
      compilerContractFingerprint: catalogCompilerContractFingerprint,
      compiledReleaseDigest: result.value.compiledReleaseDigest,
      toolchainDigest: result.value.toolchainDigest,
      materializationFingerprint: result.value.materializationFingerprint,
      byteLength: Buffer.byteLength(result.value.bytes, "utf8"),
    }).toEqual(compiledReleaseGolden);
  });

  it("returns deterministic definition and revision violations for duplicate identity", () => {
    const original = compileCatalogRelease(duplicateDefinitionIdentityBundle());
    const reordered = compileCatalogRelease(
      reorderCatalogReleaseBundle(duplicateDefinitionIdentityBundle()),
    );

    expect(original).toEqual({
      ok: false,
      error: {
        kind: "invalid-release",
        phase: "compile",
        violations: [
          {
            code: "duplicate-stable-identity",
            location: {
              kind: "present",
              value: "release:crel_acme_2/definition:drev_acme_power_iin_max_1",
            },
            subjectId: {
              kind: "present",
              value: "csub_acme_power",
            },
            detail: "definition-revision-id-duplicate-in-release",
          },
          {
            code: "duplicate-stable-identity",
            location: {
              kind: "present",
              value: "release:crel_acme_2/definition:pdef_acme_power_iin_max",
            },
            subjectId: {
              kind: "present",
              value: "csub_acme_power",
            },
            detail: "definition-id-duplicate-in-release",
          },
        ],
      },
    });
    expect(reordered).toEqual(original);
  });

  it("orders conflicting duplicate evidence independently of enumeration order", () => {
    const bundle = conflictingDuplicateDefinitionBundle();
    expect(compileCatalogRelease(reorderCatalogReleaseBundle(bundle))).toEqual(
      compileCatalogRelease(bundle),
    );
  });

  it("returns a deterministic predecessor violation for a sequence gap", () => {
    expect(compileCatalogRelease(lineageGapBundle())).toEqual({
      ok: false,
      error: {
        kind: "invalid-release",
        phase: "lineage",
        violations: [
          {
            code: "predecessor-mismatch",
            location: { kind: "present", value: "release:crel_acme_2" },
            subjectId: { kind: "absent" },
            detail: "release-sequence-gap",
          },
        ],
      },
    });
  });

  it("fails closed on missing, unlisted, or digest-mismatched source entries", () => {
    const cases = [
      {
        bundle: missingSourceEntryBundle(),
        expected: {
          code: "entry-missing",
          location: {
            kind: "present",
            value:
              "release:crel_acme_2/source:schemas/dts/vendor/acme-power.yaml",
          },
          subjectId: { kind: "absent" },
          detail: "manifest-source-entry-missing",
        },
      },
      {
        bundle: unlistedSourceEntryBundle(),
        expected: {
          code: "entry-unlisted",
          location: {
            kind: "present",
            value:
              "release:crel_acme_2/source:schemas/dts/vendor/unlisted.yaml",
          },
          subjectId: { kind: "absent" },
          detail: "source-entry-not-listed-by-manifest",
        },
      },
      {
        bundle: staleSourceDigestBundle(),
        expected: {
          code: "file-digest-mismatch",
          location: {
            kind: "present",
            value:
              "release:crel_acme_2/source:schemas/dts/vendor/acme-power.yaml",
          },
          subjectId: { kind: "absent" },
          detail: "exact-source-bytes-digest-mismatch",
        },
      },
    ] as const;

    for (const { bundle, expected } of cases) {
      const result = compileCatalogRelease(bundle);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.phase).toBe("source");
      expect(result.error.violations).toEqual([expected]);
    }
  });

  it("detects every stale content digest in deterministic contract order", () => {
    const result = compileCatalogRelease(staleNormalizedContentBundle());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("source");
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toEqual([
      {
        code: "normalization-nondeterministic",
        detail: "source-document-authority-mismatch",
      },
    ]);
  });

  it("binds the aggregate digest to compiler/toolchain inputs", () => {
    const result = compileCatalogRelease(staleAggregateDigestBundle());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("compile");
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toEqual([
      {
        code: "aggregate-digest-mismatch",
        detail: "release-aggregate-digest-mismatch",
      },
    ]);
  });

  it("consumes the S0-ID canonical property constructor without normalizing", () => {
    const result = compileCatalogRelease(invalidCanonicalPropertyBundle());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("compile");
    expect(result.error.violations).toEqual([
      {
        code: "schema-invalid",
        location: {
          kind: "present",
          value:
            "release:crel_acme_2/definition:pdef_acme_power_iin_max/propertyKey",
        },
        subjectId: { kind: "present", value: "csub_acme_power" },
        detail: "definition-property-key-structural-property",
      },
      {
        code: "stable-key-reassigned",
        location: {
          kind: "present",
          value: "release:crel_acme_2/definition:pdef_acme_power_iin_max",
        },
        subjectId: { kind: "present", value: "csub_acme_power" },
        detail: "definition-id-reassigned",
      },
    ]);
  });

  it("repeats the S1-BND closed schema check before compilation", () => {
    const malformed = {
      ...validCatalogReleaseBundle(),
      inventedSecondAuthority: true,
    } as unknown as Parameters<typeof compileCatalogRelease>[0];

    expect(compileCatalogRelease(malformed)).toEqual({
      ok: false,
      error: {
        kind: "invalid-release",
        phase: "compile",
        violations: [
          {
            code: "schema-invalid",
            location: { kind: "present", value: "bundle" },
            subjectId: { kind: "absent" },
            detail: "catalog-release-bundle-schema-invalid",
          },
        ],
      },
    });
  });

  it("parses every exact YAML source and fails closed on malformed bytes", () => {
    expect(compileCatalogRelease(malformedYamlSourceBundle())).toEqual({
      ok: false,
      error: {
        kind: "invalid-release",
        phase: "source",
        violations: [
          {
            code: "manifest-unreadable",
            location: {
              kind: "present",
              value:
                "release:crel_acme_2/source:schemas/dts/vendor/acme-power.yaml",
            },
            subjectId: { kind: "absent" },
            detail: "source-yaml-unreadable",
          },
        ],
      },
    });
  });

  it("rejects a stable Subject ID rebound to another canonical key", () => {
    const result = compileCatalogRelease(reassignedSubjectIdentityBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toContainEqual({
      code: "stable-key-reassigned",
      detail: "subject-id-reassigned",
    });
  });

  it("rejects predecessor membership omission", () => {
    const result = compileCatalogRelease(omittedPredecessorAliasBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("lineage");
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toContainEqual({
      code: "membership-omitted",
      detail: "predecessor-alias-membership-omitted",
    });
  });

  it("rejects an Alias claiming a canonical selector", () => {
    const result = compileCatalogRelease(aliasCanonicalCollisionBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toContainEqual({
      code: "alias-collision",
      detail: "alias-canonical-selector-collision",
    });
  });

  it("rejects lifecycle and tombstone disagreement before schema fallback", () => {
    const result = compileCatalogRelease(lifecycleTombstoneMismatchBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toContainEqual({
      code: "lifecycle-tombstone-mismatch",
      detail: "active-subject-has-tombstone",
    });
  });

  it("rejects a changed Definition that skips a revision number", () => {
    const result = compileCatalogRelease(revisionSequenceGapBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("lineage");
    expect(
      result.error.violations.map(({ code, detail }) => ({ code, detail })),
    ).toContainEqual({
      code: "revision-derivation-invalid",
      detail: "definition-revision-sequence-gap",
    });
  });

  it("requires the manifest and compiled document inventories to match exactly", () => {
    const missing = compileCatalogRelease(manifestDocumentMissingBundle());
    const unlisted = compileCatalogRelease(manifestDocumentUnlistedBundle());

    expect(missing.ok).toBe(false);
    expect(unlisted.ok).toBe(false);
    if (missing.ok || unlisted.ok) return;
    expect(missing.error.phase).toBe("source");
    expect(missing.error.violations).toContainEqual({
      code: "entry-missing",
      location: {
        kind: "present",
        value: "release:crel_acme_2/alias:cali_acme_power_v1",
      },
      subjectId: { kind: "absent" },
      detail: "manifest-document-content-missing",
    });
    expect(unlisted.error.phase).toBe("source");
    expect(unlisted.error.violations).toContainEqual({
      code: "entry-unlisted",
      location: {
        kind: "present",
        value: "release:crel_acme_2/alias:cali_acme_power_v1",
      },
      subjectId: { kind: "present", value: "csub_acme_power" },
      detail: "document-entry-not-listed-by-manifest",
    });
  });

  it("rejects calendar-invalid publication metadata", () => {
    const result = compileCatalogRelease(invalidPublicationTimeBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("source");
    expect(result.error.violations).toContainEqual({
      code: "manifest-unreadable",
      location: { kind: "present", value: "release:crel_acme_2" },
      subjectId: { kind: "absent" },
      detail: "release-published-at-noncanonical",
    });
  });

  it("enforces the frozen value-schema reference and validity policy", () => {
    const forbidden = compileCatalogRelease(
      forbiddenValueSchemaReferenceBundle(),
    );
    const invalid = compileCatalogRelease(invalidValueSchemaBundle());

    expect(forbidden.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    if (forbidden.ok || invalid.ok) return;
    expect(forbidden.error.violations).toContainEqual(
      expect.objectContaining({
        code: "definition-snapshot-incomplete",
        detail: "definition-value-schema-ref-forbidden",
      }),
    );
    expect(invalid.error.violations).toContainEqual(
      expect.objectContaining({
        code: "definition-snapshot-incomplete",
        detail: "definition-value-schema-invalid",
      }),
    );
  });

  it("rejects dangling Definition successors", () => {
    const result = compileCatalogRelease(danglingDefinitionSuccessorBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.violations).toContainEqual(
      expect.objectContaining({
        code: "definition-snapshot-incomplete",
        detail: "definition-successor-missing",
      }),
    );
  });

  it("binds retirement tombstones to the predecessor selector", () => {
    const result = compileCatalogRelease(invalidRetirementProvenanceBundle());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.phase).toBe("lineage");
    expect(result.error.violations).toContainEqual(
      expect.objectContaining({
        code: "lifecycle-tombstone-mismatch",
        detail: "retirement-previous-selector-mismatch",
      }),
    );
  });
});
