import { z } from "zod";

const contractString = z.string().min(1);
const stringArray = z.array(contractString);
const pointer = z.string().startsWith("/");

const stableIdentityRuleSchema = z
  .object({
    documentKind: z.enum(["subject", "alias", "definition"]),
    idPointer: pointer,
    naturalKeyPointers: z.array(pointer),
    immutableValuePointers: z.array(pointer),
    uniquePerRelease: z.boolean(),
  })
  .strict();

export const stableCatalogRulesSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    s0IdContract: z
      .object({
        mergedImplementationSha: contractString,
        packageEntrypoint: contractString,
        serializationGolden: z
          .object({
            path: contractString,
            gitBlobOid: contractString,
            byteLength: z.number().int().nonnegative(),
            rawSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          })
          .strict(),
        constructors: z
          .object({
            compatible: z.literal("parseCanonicalCompatibleSelector"),
            nodeName: z.literal("parseCanonicalNodeName"),
            propertyKey: z.literal("parseCanonicalPropertyKey"),
          })
          .strict(),
        enumRegistries: z
          .object({
            driverNatures: z.literal("driverNatures"),
            driverInstanceCardinalities: z.literal(
              "driverInstanceCardinalities",
            ),
          })
          .strict(),
      })
      .strict(),
    idFormat: z
      .object({
        type: z.literal("string"),
        minLength: z.number().int().positive(),
        trimmed: z.boolean(),
        controlFree: z.boolean(),
      })
      .strict(),
    closedEnums: z
      .object({
        catalogSubjectKinds: stringArray,
        catalogSubjectSelectorKinds: stringArray,
        driverNatures: stringArray,
        driverInstanceCardinalities: stringArray,
        definitionLifecycles: stringArray,
        subjectLifecycles: stringArray,
      })
      .strict(),
    manifestRules: z
      .object({
        exactSourceSet: z.boolean(),
        exactDocumentSet: z.boolean(),
        sourceMatchPointers: z.array(pointer),
        documentMatchPointers: z.array(
          z
            .object({
              manifestPointer: pointer,
              documentPointer: pointer,
            })
            .strict(),
        ),
        sourceDocumentDigest: z
          .object({
            algorithm: z.literal("sha256"),
            bytes: z.literal("exact-source-bytes"),
            inventoryPointer: pointer,
            sourcePathPointer: pointer,
            sourceMediaTypePointer: pointer,
            sourceEncodingPointer: pointer,
            sourceBytesPointer: pointer,
            manifestPointer: pointer,
            manifestPathPointer: pointer,
            manifestMediaTypePointer: pointer,
            manifestDigestPointer: pointer,
            mediaType: z.literal("application/yaml"),
            encoding: z.literal("base64"),
          })
          .strict(),
        publicationTime: z
          .object({
            pointer,
            format: z.literal("rfc3339-utc-seconds"),
            source: z.literal("compiler-reviewed-release-metadata"),
            forbidInstallationOrSynchronizationClock: z.literal(true),
          })
          .strict(),
        normalizedDocumentDigest: z
          .object({
            algorithm: z.literal("sha256"),
            canonicalization: z.literal("parameter-catalog-contract-serialize"),
            digestPointer: pointer,
            contentPointer: pointer,
          })
          .strict(),
        releaseAggregateDigest: z
          .object({
            algorithm: z.literal("sha256"),
            canonicalization: z.literal("parameter-catalog-contract-serialize"),
            digestPointer: pointer,
            modelPointers: z.array(pointer),
            sortedCollections: z.array(
              z
                .object({
                  pointer,
                  keyPointers: z.array(pointer),
                  comparator: z.literal("ecmascript-utf16-code-unit"),
                })
                .strict(),
            ),
          })
          .strict(),
      })
      .strict(),
    definitionRevisionRules: z
      .object({
        algorithm: z.literal("sha256"),
        canonicalization: z.literal("parameter-catalog-contract-serialize"),
        revisionPointer: pointer,
        digestPointer: pointer,
        contentPointers: z.array(pointer),
        transitionRules: z
          .object({
            definitionIdPointer: pointer,
            revisionIdPointer: pointer,
            revisionNumberPointer: pointer,
            contentDigestPointer: pointer,
            unchangedContentRequiresSameRevision: z.boolean(),
            changedContentRequiresFreshRevisionId: z.boolean(),
            changedContentRevisionIncrement: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    valueSchemaRules: z
      .object({
        schemaPointer: pointer,
        dialect: z.literal("https://json-schema.org/draft/2020-12/schema"),
        requireValidSchema: z.boolean(),
        referencePolicy: z.literal(
          "forbid-all-json-schema-2020-12-reference-keywords",
        ),
        forbiddenReferenceKeywords: stringArray,
        traversal: z
          .object({
            strategy: z.literal("iterative-depth-first"),
            rootDepth: z.literal(0),
            maxDepth: z.number().int().nonnegative(),
            maxContainerNodes: z.number().int().positive(),
            limitViolation: contractString,
          })
          .strict(),
      })
      .strict(),
    definitionLifecycleRules: z
      .object({
        definitionIdPointer: pointer,
        lifecyclePointer: pointer,
        successorDefinitionIdPointer: pointer,
        deprecatedLifecycle: z.literal("deprecated"),
        requireExistingSuccessor: z.boolean(),
        forbidSelfSuccessor: z.boolean(),
        successorGraph: z
          .object({
            strategy: z.literal("iterative-indexed"),
            requireAcyclic: z.boolean(),
            terminalLifecycle: z.literal("active"),
            cycleViolation: contractString,
            terminalViolation: contractString,
          })
          .strict(),
      })
      .strict(),
    lineageRules: z
      .object({
        targetReleasePointer: pointer,
        releaseCollectionPointer: pointer,
        releaseIdPointer: pointer,
        releaseDigestPointer: pointer,
        releaseVersionPointer: pointer,
        releaseSequencePointer: pointer,
        predecessorIdPointer: pointer,
        predecessorDigestPointer: pointer,
        requireAcyclic: z.boolean(),
        requireConnectedFromTarget: z.boolean(),
        requireGapFreeSequence: z.boolean(),
        requirePredecessorDigestMatch: z.boolean(),
        requireUniqueReleaseVersion: z.boolean(),
        requireUniqueReleaseDigest: z.boolean(),
        traversal: z
          .object({
            strategy: z.literal("iterative-indexed"),
            releaseIndex: z.literal("release-id"),
            documentIndex: z.literal("release-id/document-kind/document-id"),
            revisionHistoryIndex: z.literal("definition-id/revision-id"),
          })
          .strict(),
      })
      .strict(),
    identityRules: z.array(stableIdentityRuleSchema),
    selectorRules: z
      .object({
        canonicalSubjectIdPointer: pointer,
        subjectKindPointer: pointer,
        canonicalKindPointer: pointer,
        canonicalValuePointer: pointer,
        aliasKindPointer: pointer,
        aliasValuePointer: pointer,
        ownedDocumentRules: z.array(
          z
            .object({
              documentKind: z.enum(["alias", "definition"]),
              ownerSubjectIdPointer: pointer,
              selectorKindPointer: pointer,
            })
            .strict(),
        ),
        selectorKindBySubjectKind: z
          .object({
            driver: z.literal("driver-compatible"),
            "node-type": z.literal("node-type-name"),
          })
          .strict(),
        requirePermanentCanonicalOwnership: z.boolean(),
        forbidAliasCanonicalCollision: z.boolean(),
      })
      .strict(),
    retirementRules: z
      .object({
        releaseIdPointer: pointer,
        documentRules: z.array(
          z
            .object({
              documentKind: z.enum(["subject", "alias"]),
              idPointer: pointer,
              lifecyclePointer: pointer,
              selectorPointer: pointer,
              semanticKindPointer: pointer,
            })
            .strict(),
        ),
        tombstonePointer: pointer,
        withdrawnByReleaseIdPointer: pointer,
        previousSelectorPointer: pointer,
        successorIdPointer: pointer,
        requireActualRetirementRelease: z.boolean(),
        requireExactPredecessorSelector: z.boolean(),
        preserveOriginalPreviousSelector: z.boolean(),
        requirePublishedPredecessorForRetirement: z.boolean(),
        requireActiveSameKindSuccessor: z.boolean(),
      })
      .strict(),
    membershipRules: z
      .object({
        requirePredecessorSubjects: z.boolean(),
        requirePredecessorAliases: z.boolean(),
        requirePredecessorDefinitions: z.boolean(),
        activeAliasRequiresActiveSubject: z.boolean(),
        requireAliasSubject: z.boolean(),
        requireDefinitionSubject: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type StableCatalogRules = z.infer<typeof stableCatalogRulesSchema>;

export const parseStableCatalogRules = (value: unknown): StableCatalogRules =>
  stableCatalogRulesSchema.parse(value);
