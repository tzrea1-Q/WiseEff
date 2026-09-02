import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  catalogSubjectKinds,
  catalogSubjectSelectorKinds,
  definitionLifecycles,
  driverInstanceCardinalities,
  driverNatures,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  serializeContract,
  subjectLifecycles,
  type ContractJsonValue,
} from "../../../server/modules/parameter-catalog-contract/index";

type JsonObject = Record<string, unknown>;

interface ValidateFunction {
  (value: unknown): boolean;
  errors?: unknown;
}

interface AjvInstance {
  addSchema(schema: JsonObject): AjvInstance;
  compile(schema: JsonObject): ValidateFunction;
}

interface StableIdentityRule {
  documentKind: "subject" | "alias" | "definition";
  idPointer: string;
  naturalKeyPointers: string[];
  immutableValuePointers: string[];
  uniquePerRelease: boolean;
}

interface StableIdRules {
  schemaVersion: string;
  s0IdContract: {
    mergedImplementationSha: string;
    packageEntrypoint: string;
    serializationGolden: {
      path: string;
      gitBlobOid: string;
      byteLength: number;
      rawSha256: string;
    };
    constructors: {
      compatible: "parseCanonicalCompatibleSelector";
      nodeName: "parseCanonicalNodeName";
      propertyKey: "parseCanonicalPropertyKey";
    };
    enumRegistries: {
      driverNatures: "driverNatures";
      driverInstanceCardinalities: "driverInstanceCardinalities";
    };
  };
  idFormat: {
    type: "string";
    minLength: number;
    trimmed: boolean;
    controlFree: boolean;
  };
  closedEnums: {
    catalogSubjectKinds: string[];
    catalogSubjectSelectorKinds: string[];
    driverNatures: string[];
    driverInstanceCardinalities: string[];
    definitionLifecycles: string[];
    subjectLifecycles: string[];
  };
  manifestRules: {
    exactSourceSet: boolean;
    exactDocumentSet: boolean;
    sourceMatchPointers: string[];
    documentMatchPointers: Array<{
      manifestPointer: string;
      documentPointer: string;
    }>;
    sourceDocumentDigest: {
      algorithm: "sha256";
      bytes: "exact-source-bytes";
      inventoryPointer: string;
      sourcePathPointer: string;
      sourceMediaTypePointer: string;
      sourceEncodingPointer: string;
      sourceBytesPointer: string;
      manifestPointer: string;
      manifestPathPointer: string;
      manifestMediaTypePointer: string;
      manifestDigestPointer: string;
      mediaType: "application/yaml";
      encoding: "base64";
    };
    publicationTime: {
      pointer: string;
      format: "rfc3339-utc-seconds";
      source: "compiler-reviewed-release-metadata";
      forbidInstallationOrSynchronizationClock: true;
    };
    normalizedDocumentDigest: {
      algorithm: "sha256";
      canonicalization: "parameter-catalog-contract-serialize";
      digestPointer: string;
      contentPointer: string;
    };
    releaseAggregateDigest: {
      algorithm: "sha256";
      canonicalization: "parameter-catalog-contract-serialize";
      digestPointer: string;
      modelPointers: string[];
      sortedCollections: Array<{
        pointer: string;
        keyPointers: string[];
        comparator: "ecmascript-utf16-code-unit";
      }>;
    };
  };
  definitionRevisionRules: {
    algorithm: "sha256";
    canonicalization: "parameter-catalog-contract-serialize";
    revisionPointer: string;
    digestPointer: string;
    contentPointers: string[];
    transitionRules: {
      definitionIdPointer: string;
      revisionIdPointer: string;
      revisionNumberPointer: string;
      contentDigestPointer: string;
      unchangedContentRequiresSameRevision: boolean;
      changedContentRequiresFreshRevisionId: boolean;
      changedContentRevisionIncrement: number;
    };
  };
  valueSchemaRules: {
    schemaPointer: string;
    dialect: "https://json-schema.org/draft/2020-12/schema";
    requireValidSchema: boolean;
    referencePolicy: "forbid-all-json-schema-2020-12-reference-keywords";
    forbiddenReferenceKeywords: string[];
    traversal: {
      strategy: "iterative-depth-first";
      rootDepth: 0;
      maxDepth: number;
      maxContainerNodes: number;
      limitViolation: string;
    };
  };
  definitionLifecycleRules: {
    definitionIdPointer: string;
    lifecyclePointer: string;
    successorDefinitionIdPointer: string;
    deprecatedLifecycle: "deprecated";
    requireExistingSuccessor: boolean;
    forbidSelfSuccessor: boolean;
    successorGraph: {
      strategy: "iterative-indexed";
      requireAcyclic: true;
      terminalLifecycle: "active";
      cycleViolation: string;
      terminalViolation: string;
    };
  };
  lineageRules: {
    targetReleasePointer: string;
    releaseCollectionPointer: string;
    releaseIdPointer: string;
    releaseDigestPointer: string;
    releaseVersionPointer: string;
    releaseSequencePointer: string;
    predecessorIdPointer: string;
    predecessorDigestPointer: string;
    requireAcyclic: boolean;
    requireConnectedFromTarget: boolean;
    requireGapFreeSequence: boolean;
    requirePredecessorDigestMatch: boolean;
    requireUniqueReleaseVersion: boolean;
    requireUniqueReleaseDigest: boolean;
    traversal: {
      strategy: "iterative-indexed";
      releaseIndex: "release-id";
      documentIndex: "release-id/document-kind/document-id";
      revisionHistoryIndex: "definition-id/revision-id";
    };
  };
  identityRules: StableIdentityRule[];
  selectorRules: {
    canonicalSubjectIdPointer: string;
    subjectKindPointer: string;
    canonicalKindPointer: string;
    canonicalValuePointer: string;
    aliasKindPointer: string;
    aliasValuePointer: string;
    ownedDocumentRules: Array<{
      documentKind: "alias" | "definition";
      ownerSubjectIdPointer: string;
      selectorKindPointer: string;
    }>;
    selectorKindBySubjectKind: {
      driver: "driver-compatible";
      "node-type": "node-type-name";
    };
    requirePermanentCanonicalOwnership: boolean;
    forbidAliasCanonicalCollision: boolean;
  };
  retirementRules: {
    releaseIdPointer: string;
    documentRules: Array<{
      documentKind: "subject" | "alias";
      idPointer: string;
      lifecyclePointer: string;
      selectorPointer: string;
      semanticKindPointer: string;
    }>;
    tombstonePointer: string;
    withdrawnByReleaseIdPointer: string;
    previousSelectorPointer: string;
    successorIdPointer: string;
    requireActualRetirementRelease: boolean;
    requireExactPredecessorSelector: boolean;
    preserveOriginalPreviousSelector: boolean;
    requirePublishedPredecessorForRetirement: boolean;
    requireActiveSameKindSuccessor: boolean;
  };
  membershipRules: {
    requirePredecessorSubjects: boolean;
    requirePredecessorAliases: boolean;
    requirePredecessorDefinitions: boolean;
    activeAliasRequiresActiveSubject: boolean;
    requireAliasSubject: boolean;
    requireDefinitionSubject: boolean;
  };
}

interface BundleDocument {
  source: {
    path: string;
    mediaType: "application/yaml";
    digest: string;
  };
  kind: "subject" | "alias" | "definition";
  normalizedDigest: string;
  content: JsonObject;
}

interface SourceInventoryEntry {
  path: string;
  mediaType: "application/yaml";
  encoding: "base64";
  bytes: string;
}

interface ReleaseNode {
  manifest: {
    schemaVersion: string;
    release: {
      id: string;
      version: string;
      sequence: number;
      publishedAt: string;
      digest: string;
      predecessor: null | { id: string; digest: string };
    };
    toolchain: {
      compiler: string;
      jsonSchemaDialect: string;
      sourceFormat: string;
    };
    files: Array<{
      path: string;
      mediaType: "application/yaml";
      digest: string;
    }>;
    documents: Array<{
      sourcePath: string;
      kind: BundleDocument["kind"];
      documentId: string;
      normalizedDigest: string;
    }>;
  };
  sources: SourceInventoryEntry[];
  documents: BundleDocument[];
}

interface CatalogReleaseBundle {
  schemaVersion: string;
  targetReleaseId: string;
  releases: ReleaseNode[];
}

const localRequire = createRequire(import.meta.url);
const Ajv2020 = localRequire("ajv/dist/2020").default as new (
  options: Record<string, unknown>,
) => AjvInstance;

const readJson = <Value>(relativePath: string): Value =>
  JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as Value;

const catalogReleaseSchema = readJson<JsonObject>(
  "./catalog-release.schema.json",
);
const manifestSchema = readJson<JsonObject>("./manifest.schema.json");
const stableIdRules = readJson<StableIdRules>("./stable-id-rules.json");
const generatedSchemaBytes = readFileSync(
  resolve("docs/generated/parameter-catalog-bundle.schema.json"),
  "utf8",
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(manifestSchema);
const validateSchema = ajv.compile(catalogReleaseSchema);

const pointerValue = (value: unknown, pointer: string): unknown => {
  if (pointer === "") return value;
  return pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, token) => {
      if (current === null || typeof current !== "object") return undefined;
      return (current as JsonObject)[token];
    }, value);
};

const inspectValueSchema = (
  value: unknown,
  rule: StableIdRules["valueSchemaRules"],
): { complexityExceeded: boolean; forbiddenReference: boolean } => {
  const stack: Array<{ depth: number; value: unknown }> = [
    { depth: rule.traversal.rootDepth, value },
  ];
  let containerNodes = 0;
  const forbiddenKeywords = new Set(rule.forbiddenReferenceKeywords);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (current.value === null || typeof current.value !== "object") continue;
    containerNodes += 1;
    if (
      current.depth > rule.traversal.maxDepth ||
      containerNodes > rule.traversal.maxContainerNodes
    ) {
      return { complexityExceeded: true, forbiddenReference: false };
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        stack.push({ depth: current.depth + 1, value: entry });
      }
      continue;
    }
    for (const [key, entry] of Object.entries(current.value as JsonObject)) {
      if (forbiddenKeywords.has(key)) {
        return { complexityExceeded: false, forbiddenReference: true };
      }
      stack.push({ depth: current.depth + 1, value: entry });
    }
  }

  return { complexityExceeded: false, forbiddenReference: false };
};

const stableKey = (value: unknown): string =>
  serializeContract(value as ContractJsonValue).trimEnd();

const compareContractKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const normalizedReleaseModel = (node: ReleaseNode): JsonObject => {
  const rule = stableIdRules.manifestRules.releaseAggregateDigest;
  return Object.fromEntries(
    rule.modelPointers.map((pointer) => {
      const value = structuredClone(pointerValue(node, pointer));
      const sorting = rule.sortedCollections.find(
        (candidate) => candidate.pointer === pointer,
      );
      if (!sorting || !Array.isArray(value)) return [pointer, value];
      return [
        pointer,
        value.toSorted((left, right) =>
          compareContractKeys(
            stableKey(
              sorting.keyPointers.map((pointer) => pointerValue(left, pointer)),
            ),
            stableKey(
              sorting.keyPointers.map((pointer) =>
                pointerValue(right, pointer),
              ),
            ),
          ),
        ),
      ];
    }),
  );
};

const releaseAggregateDigest = (node: ReleaseNode): string =>
  `sha256:${createHash("sha256")
    .update(
      serializeContract(normalizedReleaseModel(node) as ContractJsonValue),
    )
    .digest("hex")}`;

const isCanonicalPublicationTime = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().replace(".000Z", "Z") === value
  );
};

const definitionRevisionContentModel = (
  document: BundleDocument,
): JsonObject => {
  const rule = stableIdRules.definitionRevisionRules;
  const revision = pointerValue(document, rule.revisionPointer);
  const entries: Array<[string, unknown]> = [];
  for (const pointer of rule.contentPointers) {
    const value = pointerValue(revision, pointer);
    if (value !== undefined) entries.push([pointer, structuredClone(value)]);
  }
  return Object.fromEntries(entries);
};

const definitionRevisionContentDigest = (document: BundleDocument): string =>
  `sha256:${createHash("sha256")
    .update(
      serializeContract(
        definitionRevisionContentModel(document) as ContractJsonValue,
      ),
    )
    .digest("hex")}`;

const validateStableRules = (bundle: CatalogReleaseBundle): string[] => {
  const violations: string[] = [];
  const lineage = stableIdRules.lineageRules;
  const releases = pointerValue(
    bundle,
    lineage.releaseCollectionPointer,
  ) as ReleaseNode[];
  const targetReleaseId = pointerValue(bundle, lineage.targetReleasePointer);
  const releasesById = new Map<string, ReleaseNode>();
  const releaseVersions = new Map<string, string>();
  const releaseDigests = new Map<string, string>();
  const documentsByReleaseId = new Map<
    string,
    Map<BundleDocument["kind"], Map<unknown, BundleDocument>>
  >();

  for (const node of releases) {
    const releaseId = pointerValue(node, lineage.releaseIdPointer) as string;
    const releaseVersion = pointerValue(
      node,
      lineage.releaseVersionPointer,
    ) as string;
    const releaseDigest = pointerValue(
      node,
      lineage.releaseDigestPointer,
    ) as string;
    if (releasesById.has(releaseId)) violations.push("release-id-unique");
    if (
      lineage.requireUniqueReleaseVersion &&
      releaseVersions.has(releaseVersion) &&
      releaseVersions.get(releaseVersion) !== releaseId
    ) {
      violations.push("release-version-unique");
    }
    if (
      lineage.requireUniqueReleaseDigest &&
      releaseDigests.has(releaseDigest) &&
      releaseDigests.get(releaseDigest) !== releaseId
    ) {
      violations.push("release-digest-unique");
    }
    releasesById.set(releaseId, node);
    releaseVersions.set(releaseVersion, releaseId);
    releaseDigests.set(releaseDigest, releaseId);
    if (
      !isCanonicalPublicationTime(
        pointerValue(
          node,
          stableIdRules.manifestRules.publicationTime.pointer,
        ),
      )
    ) {
      violations.push("manifest-content-exact");
    }
    const documentsByKind = new Map<
      BundleDocument["kind"],
      Map<unknown, BundleDocument>
    >();
    for (const document of node.documents) {
      let documentsById = documentsByKind.get(document.kind);
      if (!documentsById) {
        documentsById = new Map();
        documentsByKind.set(document.kind, documentsById);
      }
      documentsById.set(pointerValue(document, "/content/id"), document);
    }
    documentsByReleaseId.set(releaseId, documentsByKind);

    if (stableIdRules.manifestRules.exactSourceSet) {
      const sourceRule = stableIdRules.manifestRules.sourceDocumentDigest;
      const sourceInventoryEntries = pointerValue(
        node,
        sourceRule.inventoryPointer,
      ) as SourceInventoryEntry[];
      const manifestFiles = pointerValue(
        node,
        sourceRule.manifestPointer,
      ) as ReleaseNode["manifest"]["files"];
      const listed = new Map(
        manifestFiles.map(
          (file) =>
            [
              String(pointerValue(file, sourceRule.manifestPathPointer)),
              file,
            ] as const,
        ),
      );
      const inventoried = new Map(
        sourceInventoryEntries.map(
          (source) =>
            [
              String(pointerValue(source, sourceRule.sourcePathPointer)),
              source,
            ] as const,
        ),
      );
      const bundledSourcePaths = new Set(
        node.documents.map((document) => document.source.path),
      );
      if (
        listed.size !== manifestFiles.length ||
        inventoried.size !== sourceInventoryEntries.length ||
        listed.size !== inventoried.size ||
        listed.size !== bundledSourcePaths.size
      ) {
        violations.push("manifest-content-exact");
      } else {
        for (const [path, file] of listed) {
          const source = inventoried.get(path);
          if (
            source === undefined ||
            pointerValue(source, sourceRule.sourceMediaTypePointer) !==
              pointerValue(file, sourceRule.manifestMediaTypePointer) ||
            pointerValue(source, sourceRule.sourceEncodingPointer) !==
              sourceRule.encoding
          ) {
            violations.push("manifest-content-exact");
            break;
          }
          const exactBytes = Buffer.from(
            String(pointerValue(source, sourceRule.sourceBytesPointer)),
            sourceRule.encoding,
          );
          if (
            exactBytes.toString(sourceRule.encoding) !==
            pointerValue(source, sourceRule.sourceBytesPointer)
          ) {
            violations.push("manifest-content-exact");
            break;
          }
          const actualDigest = `sha256:${createHash("sha256")
            .update(exactBytes)
            .digest("hex")}`;
          if (
            actualDigest !==
            pointerValue(file, sourceRule.manifestDigestPointer)
          ) {
            violations.push("manifest-content-exact");
            break;
          }
        }
        for (const document of node.documents) {
          const file = listed.get(document.source.path);
          if (
            file === undefined ||
            stableIdRules.manifestRules.sourceMatchPointers.some((pointer) => {
              const filePointer = pointer.replace(/^\/source/, "");
              return (
                pointerValue(file, filePointer) !==
                pointerValue(document, pointer)
              );
            })
          ) {
            violations.push("manifest-content-exact");
            break;
          }
        }
      }
    }

    if (stableIdRules.manifestRules.exactDocumentSet) {
      const listed = new Map(
        node.manifest.documents.map(
          (document) =>
            [`${document.kind}:${document.documentId}`, document] as const,
        ),
      );
      const bundled = new Map(
        node.documents.map(
          (document) =>
            [
              `${document.kind}:${String(pointerValue(document, "/content/id"))}`,
              document,
            ] as const,
        ),
      );
      if (
        listed.size !== node.manifest.documents.length ||
        bundled.size !== node.documents.length ||
        listed.size !== bundled.size
      ) {
        violations.push("manifest-content-exact");
      } else {
        for (const [key, document] of bundled) {
          const descriptor = listed.get(key);
          if (
            descriptor === undefined ||
            stableIdRules.manifestRules.documentMatchPointers.some(
              ({ documentPointer, manifestPointer }) =>
                pointerValue(document, documentPointer) !==
                pointerValue(descriptor, manifestPointer),
            )
          ) {
            violations.push("manifest-content-exact");
            break;
          }
        }
      }
    }

    const digestRule = stableIdRules.manifestRules.normalizedDocumentDigest;
    for (const document of node.documents) {
      const canonicalContent = serializeContract(
        pointerValue(document, digestRule.contentPointer) as ContractJsonValue,
      );
      const actualDigest = `sha256:${createHash("sha256")
        .update(canonicalContent)
        .digest("hex")}`;
      if (pointerValue(document, digestRule.digestPointer) !== actualDigest) {
        violations.push("document-digest-mismatch");
      }
      if (
        document.kind === "definition" &&
        pointerValue(
          document,
          stableIdRules.definitionRevisionRules.digestPointer,
        ) !== definitionRevisionContentDigest(document)
      ) {
        violations.push("definition-revision-content-digest-mismatch");
      }
      if (document.kind === "definition") {
        const valueSchemaRule = stableIdRules.valueSchemaRules;
        const valueSchema = pointerValue(
          document,
          valueSchemaRule.schemaPointer,
        );
        const inspection = inspectValueSchema(valueSchema, valueSchemaRule);
        if (inspection.complexityExceeded) {
          violations.push(valueSchemaRule.traversal.limitViolation);
        } else if (inspection.forbiddenReference) {
          violations.push("definition-value-schema-ref-forbidden");
        } else if (valueSchemaRule.requireValidSchema) {
          const declaredDialect = pointerValue(valueSchema, "/$schema");
          if (
            declaredDialect !== undefined &&
            declaredDialect !== valueSchemaRule.dialect
          ) {
            violations.push("definition-value-schema-invalid");
          } else {
            try {
              const valueSchemaAjv = new Ajv2020({
                allErrors: true,
                strict: true,
              });
              valueSchemaAjv.compile(valueSchema as JsonObject);
            } catch {
              violations.push("definition-value-schema-invalid");
            }
          }
        }
      }
    }

    const aggregateRule = stableIdRules.manifestRules.releaseAggregateDigest;
    if (
      pointerValue(node, aggregateRule.digestPointer) !==
      releaseAggregateDigest(node)
    ) {
      violations.push("release-aggregate-digest-mismatch");
    }
  }

  if (
    typeof targetReleaseId !== "string" ||
    !releasesById.has(targetReleaseId)
  ) {
    violations.push("target-release-present");
  }

  if (lineage.requireAcyclic) {
    const traversalState = new Map<string, "visiting" | "visited">();
    for (const startReleaseId of releasesById.keys()) {
      if (traversalState.get(startReleaseId) === "visited") continue;
      const path: string[] = [];
      let releaseId: string | undefined = startReleaseId;
      while (releaseId !== undefined) {
        const node = releasesById.get(releaseId);
        if (!node) break;
        const state = traversalState.get(releaseId);
        if (state === "visiting") {
          violations.push("release-lineage-acyclic");
          break;
        }
        if (state === "visited") break;
        traversalState.set(releaseId, "visiting");
        path.push(releaseId);
        const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
        releaseId =
          typeof predecessorId === "string" ? predecessorId : undefined;
      }
      for (const pathReleaseId of path) {
        traversalState.set(pathReleaseId, "visited");
      }
    }
  }

  const targetAncestors = new Set<string>();
  const lineageFromTarget: ReleaseNode[] = [];
  let cursor =
    typeof targetReleaseId === "string" ? targetReleaseId : undefined;
  while (cursor !== undefined && !targetAncestors.has(cursor)) {
    targetAncestors.add(cursor);
    const node = releasesById.get(cursor);
    if (node === undefined) {
      violations.push("release-lineage-connected");
      break;
    }
    lineageFromTarget.push(node);
    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    if (predecessorId === undefined) break;
    if (typeof predecessorId !== "string") {
      violations.push("release-lineage-connected");
      break;
    }
    const predecessor = releasesById.get(predecessorId);
    if (predecessor === undefined) {
      violations.push("release-lineage-connected");
      break;
    }
    if (lineage.requireGapFreeSequence) {
      const sequence = pointerValue(
        node,
        lineage.releaseSequencePointer,
      ) as number;
      const predecessorSequence = pointerValue(
        predecessor,
        lineage.releaseSequencePointer,
      ) as number;
      if (predecessorSequence + 1 !== sequence)
        violations.push("release-sequence-gap");
    }
    if (
      lineage.requirePredecessorDigestMatch &&
      pointerValue(node, lineage.predecessorDigestPointer) !==
        pointerValue(predecessor, lineage.releaseDigestPointer)
    ) {
      violations.push("predecessor-digest-mismatch");
    }
    cursor = predecessorId;
  }
  if (
    lineage.requireConnectedFromTarget &&
    targetAncestors.size !== releasesById.size
  ) {
    violations.push("release-lineage-connected");
  }
  const lineageFromRoot = lineageFromTarget.toReversed();
  const revisionTransition =
    stableIdRules.definitionRevisionRules.transitionRules;
  const publishedRevisionIdsByDefinition = new Map<unknown, Set<unknown>>();
  const reusedChangedRevisionKeys = new Set<string>();
  for (const node of lineageFromRoot) {
    const releaseId = pointerValue(node, lineage.releaseIdPointer);
    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    const predecessorDefinitions =
      typeof predecessorId === "string"
        ? documentsByReleaseId.get(predecessorId)?.get("definition")
        : undefined;
    const definitions =
      typeof releaseId === "string"
        ? documentsByReleaseId.get(releaseId)?.get("definition")
        : undefined;
    for (const definition of definitions?.values() ?? []) {
      const definitionId = pointerValue(
        definition,
        revisionTransition.definitionIdPointer,
      );
      const revisionId = pointerValue(
        definition,
        revisionTransition.revisionIdPointer,
      );
      let publishedRevisionIds =
        publishedRevisionIdsByDefinition.get(definitionId);
      if (!publishedRevisionIds) {
        publishedRevisionIds = new Set();
        publishedRevisionIdsByDefinition.set(
          definitionId,
          publishedRevisionIds,
        );
      }
      const predecessorDefinition = predecessorDefinitions?.get(definitionId);
      const contentChanged =
        predecessorDefinition !== undefined &&
        pointerValue(definition, revisionTransition.contentDigestPointer) !==
          pointerValue(
            predecessorDefinition,
            revisionTransition.contentDigestPointer,
          );
      if (contentChanged && publishedRevisionIds.has(revisionId)) {
        reusedChangedRevisionKeys.add(stableKey([releaseId, definitionId]));
      }
      publishedRevisionIds.add(revisionId);
    }
  }

  for (const identityRule of stableIdRules.identityRules) {
    const idToBinding = new Map<string, string>();
    const bindingToId = new Map<string, string>();
    for (const node of releases) {
      const releaseIds = new Set<string>();
      const releaseNaturalKeys = new Set<string>();
      for (const document of node.documents.filter(
        (candidate) => candidate.kind === identityRule.documentKind,
      )) {
        const id = pointerValue(document, identityRule.idPointer);
        const naturalKey = stableKey(
          identityRule.naturalKeyPointers.map((pointer) =>
            pointerValue(document, pointer),
          ),
        );
        const immutableValue = stableKey(
          identityRule.immutableValuePointers.map((pointer) =>
            pointerValue(document, pointer),
          ),
        );
        if (typeof id !== "string") continue;
        if (identityRule.uniquePerRelease && releaseIds.has(id)) {
          violations.push(
            `${identityRule.documentKind}-id-duplicate-in-release`,
          );
        }
        if (
          identityRule.uniquePerRelease &&
          releaseNaturalKeys.has(naturalKey)
        ) {
          violations.push(
            `${identityRule.documentKind}-natural-key-duplicate-in-release`,
          );
        }
        releaseIds.add(id);
        releaseNaturalKeys.add(naturalKey);
        const binding = `${naturalKey}\n${immutableValue}`;
        if (idToBinding.has(id) && idToBinding.get(id) !== binding) {
          violations.push(`${identityRule.documentKind}-id-reassigned`);
        }
        if (bindingToId.has(naturalKey) && bindingToId.get(naturalKey) !== id) {
          violations.push(
            `${identityRule.documentKind}-natural-key-reassigned`,
          );
        }
        idToBinding.set(id, binding);
        bindingToId.set(naturalKey, id);
      }
    }
  }

  const selectorRules = stableIdRules.selectorRules;
  const canonicalSelectorOwners = new Map<string, string>();
  const aliasSelectorOwners = new Map<string, string>();
  for (const node of releases) {
    for (const subject of node.documents.filter(
      (document) => document.kind === "subject",
    )) {
      const selectorKey = stableKey([
        pointerValue(subject, selectorRules.canonicalKindPointer),
        pointerValue(subject, selectorRules.canonicalValuePointer),
      ]);
      const subjectId = pointerValue(
        subject,
        selectorRules.canonicalSubjectIdPointer,
      );
      if (
        selectorRules.requirePermanentCanonicalOwnership &&
        typeof subjectId === "string" &&
        canonicalSelectorOwners.has(selectorKey) &&
        canonicalSelectorOwners.get(selectorKey) !== subjectId
      ) {
        violations.push("canonical-selector-owner-conflict");
      }
      if (typeof subjectId === "string") {
        canonicalSelectorOwners.set(selectorKey, subjectId);
      }
    }
    for (const alias of node.documents.filter(
      (document) => document.kind === "alias",
    )) {
      const selectorKey = stableKey([
        pointerValue(alias, selectorRules.aliasKindPointer),
        pointerValue(alias, selectorRules.aliasValuePointer),
      ]);
      const subjectId = pointerValue(alias, "/content/subjectId");
      if (
        typeof subjectId === "string" &&
        aliasSelectorOwners.has(selectorKey) &&
        aliasSelectorOwners.get(selectorKey) !== subjectId
      ) {
        violations.push("alias-selector-owner-conflict");
      }
      if (typeof subjectId === "string") {
        aliasSelectorOwners.set(selectorKey, subjectId);
      }
    }
  }
  if (
    selectorRules.forbidAliasCanonicalCollision &&
    [...aliasSelectorOwners.keys()].some((selector) =>
      canonicalSelectorOwners.has(selector),
    )
  ) {
    violations.push("alias-canonical-selector-collision");
  }

  for (const node of releases) {
    const subjectKind = new Map(
      node.documents
        .filter((document) => document.kind === "subject")
        .map((document) => [
          pointerValue(document, selectorRules.canonicalSubjectIdPointer),
          pointerValue(document, selectorRules.subjectKindPointer),
        ]),
    );
    for (const ownedRule of selectorRules.ownedDocumentRules) {
      for (const document of node.documents.filter(
        (candidate) => candidate.kind === ownedRule.documentKind,
      )) {
        const ownerKind = subjectKind.get(
          pointerValue(document, ownedRule.ownerSubjectIdPointer),
        );
        if (
          (ownerKind === "driver" || ownerKind === "node-type") &&
          pointerValue(document, ownedRule.selectorKindPointer) !==
            selectorRules.selectorKindBySubjectKind[ownerKind]
        ) {
          violations.push("owned-selector-kind-mismatch");
        }
      }
    }
    const subjectLifecycle = new Map(
      node.documents
        .filter((document) => document.kind === "subject")
        .map((document) => [document.content.id, document.content.lifecycle]),
    );
    if (
      stableIdRules.membershipRules.requireAliasSubject &&
      node.documents
        .filter((document) => document.kind === "alias")
        .some((document) => !subjectLifecycle.has(document.content.subjectId))
    ) {
      violations.push("alias-subject-missing");
    }
    if (
      stableIdRules.membershipRules.requireDefinitionSubject &&
      node.documents
        .filter((document) => document.kind === "definition")
        .some((document) => !subjectLifecycle.has(document.content.subjectId))
    ) {
      violations.push("definition-subject-missing");
    }
    if (
      stableIdRules.membershipRules.activeAliasRequiresActiveSubject &&
      node.documents
        .filter((document) => document.kind === "alias")
        .some(
          (document) =>
            document.content.lifecycle === "active" &&
            subjectLifecycle.get(document.content.subjectId) !== "active",
        )
    ) {
      violations.push("active-alias-requires-active-subject");
    }

    const definitionLifecycleRules = stableIdRules.definitionLifecycleRules;
    const currentReleaseId = pointerValue(node, lineage.releaseIdPointer);
    const definitionsById =
      typeof currentReleaseId === "string"
        ? (documentsByReleaseId.get(currentReleaseId)?.get("definition") ??
          new Map())
        : new Map();
    for (const definition of definitionsById.values()) {
      if (
        pointerValue(definition, definitionLifecycleRules.lifecyclePointer) !==
        definitionLifecycleRules.deprecatedLifecycle
      ) {
        continue;
      }
      const definitionId = pointerValue(
        definition,
        definitionLifecycleRules.definitionIdPointer,
      );
      const successorDefinitionId = pointerValue(
        definition,
        definitionLifecycleRules.successorDefinitionIdPointer,
      );
      if (
        definitionLifecycleRules.forbidSelfSuccessor &&
        successorDefinitionId === definitionId
      ) {
        violations.push("definition-successor-invalid");
      } else if (
        definitionLifecycleRules.requireExistingSuccessor &&
        !definitionsById.has(successorDefinitionId)
      ) {
        violations.push("definition-successor-missing");
      }
    }
    const successorGraph = definitionLifecycleRules.successorGraph;
    const successorOutcomes = new Map<
      unknown,
      "active-terminal" | "cycle" | "missing" | "terminal-invalid"
    >();
    for (const definition of definitionsById.values()) {
      if (
        pointerValue(definition, definitionLifecycleRules.lifecyclePointer) !==
        definitionLifecycleRules.deprecatedLifecycle
      ) {
        continue;
      }
      const startDefinitionId = pointerValue(
        definition,
        definitionLifecycleRules.definitionIdPointer,
      );
      if (successorOutcomes.has(startDefinitionId)) continue;
      const path: unknown[] = [];
      const pathIndexes = new Map<unknown, number>();
      let definitionId: unknown = startDefinitionId;
      let outcome: "active-terminal" | "cycle" | "missing" | "terminal-invalid";
      while (true) {
        const knownOutcome = successorOutcomes.get(definitionId);
        if (knownOutcome) {
          outcome = knownOutcome;
          break;
        }
        if (pathIndexes.has(definitionId)) {
          outcome = "cycle";
          break;
        }
        const currentDefinition = definitionsById.get(definitionId);
        if (!currentDefinition) {
          outcome = "missing";
          break;
        }
        const lifecycle = pointerValue(
          currentDefinition,
          definitionLifecycleRules.lifecyclePointer,
        );
        if (lifecycle !== definitionLifecycleRules.deprecatedLifecycle) {
          outcome =
            lifecycle === successorGraph.terminalLifecycle
              ? "active-terminal"
              : "terminal-invalid";
          break;
        }
        pathIndexes.set(definitionId, path.length);
        path.push(definitionId);
        definitionId = pointerValue(
          currentDefinition,
          definitionLifecycleRules.successorDefinitionIdPointer,
        );
      }
      for (const pathDefinitionId of path) {
        successorOutcomes.set(pathDefinitionId, outcome);
      }
      if (outcome === "cycle" && successorGraph.requireAcyclic) {
        violations.push(successorGraph.cycleViolation);
      } else if (outcome === "terminal-invalid") {
        violations.push(successorGraph.terminalViolation);
      }
    }

    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    const predecessor =
      typeof predecessorId === "string"
        ? releasesById.get(predecessorId)
        : undefined;
    const retirementRules = stableIdRules.retirementRules;
    for (const documentRule of retirementRules.documentRules) {
      const predecessorById =
        typeof predecessorId === "string"
          ? (documentsByReleaseId
              .get(predecessorId)
              ?.get(documentRule.documentKind) ?? new Map())
          : new Map();
      for (const document of node.documents.filter(
        (candidate) => candidate.kind === documentRule.documentKind,
      )) {
        if (
          pointerValue(document, documentRule.lifecyclePointer) !== "retired"
        ) {
          continue;
        }
        const predecessorDocument = predecessorById.get(
          pointerValue(document, documentRule.idPointer),
        );
        if (predecessorDocument === undefined) {
          if (retirementRules.requirePublishedPredecessorForRetirement) {
            violations.push("retirement-predecessor-missing");
          }
          continue;
        }
        const predecessorWasRetired =
          pointerValue(predecessorDocument, documentRule.lifecyclePointer) ===
          "retired";
        const expectedRetirementRelease = predecessorWasRetired
          ? pointerValue(
              predecessorDocument,
              retirementRules.withdrawnByReleaseIdPointer,
            )
          : pointerValue(node, retirementRules.releaseIdPointer);
        if (
          retirementRules.requireActualRetirementRelease &&
          pointerValue(
            document,
            retirementRules.withdrawnByReleaseIdPointer,
          ) !== expectedRetirementRelease
        ) {
          violations.push("retirement-release-mismatch");
        }
        if (
          retirementRules.requireExactPredecessorSelector &&
          pointerValue(document, retirementRules.previousSelectorPointer) !==
            (predecessorWasRetired &&
            retirementRules.preserveOriginalPreviousSelector
              ? pointerValue(
                  predecessorDocument,
                  retirementRules.previousSelectorPointer,
                )
              : pointerValue(predecessorDocument, documentRule.selectorPointer))
        ) {
          violations.push("retirement-previous-selector-mismatch");
        }
        const successorId = pointerValue(
          document,
          retirementRules.successorIdPointer,
        );
        if (
          !retirementRules.requireActiveSameKindSuccessor ||
          successorId === undefined
        ) {
          continue;
        }
        const successorCandidates = node.documents.filter(
          (candidate) => pointerValue(candidate, "/content/id") === successorId,
        );
        if (successorCandidates.length === 0) {
          violations.push("retirement-successor-missing");
          continue;
        }
        const sameKindSuccessor = successorCandidates.find(
          (candidate) =>
            candidate.kind === documentRule.documentKind &&
            pointerValue(candidate, documentRule.semanticKindPointer) ===
              pointerValue(document, documentRule.semanticKindPointer),
        );
        if (sameKindSuccessor === undefined) {
          violations.push("retirement-successor-kind-mismatch");
          continue;
        }
        if (
          sameKindSuccessor === document ||
          pointerValue(sameKindSuccessor, documentRule.lifecyclePointer) !==
            "active"
        ) {
          violations.push("retirement-successor-invalid");
        }
      }
    }
    if (predecessor === undefined) continue;
    const predecessorDefinitions =
      documentsByReleaseId.get(predecessorId as string)?.get("definition") ??
      new Map();
    for (const definition of node.documents.filter(
      (document) => document.kind === "definition",
    )) {
      const definitionId = pointerValue(
        definition,
        revisionTransition.definitionIdPointer,
      );
      const predecessorDefinition = predecessorDefinitions.get(definitionId);
      if (predecessorDefinition === undefined) continue;
      const currentRevisionId = pointerValue(
        definition,
        revisionTransition.revisionIdPointer,
      );
      const predecessorRevisionId = pointerValue(
        predecessorDefinition,
        revisionTransition.revisionIdPointer,
      );
      const currentRevisionNumber = pointerValue(
        definition,
        revisionTransition.revisionNumberPointer,
      );
      const predecessorRevisionNumber = pointerValue(
        predecessorDefinition,
        revisionTransition.revisionNumberPointer,
      );
      const contentChanged =
        pointerValue(definition, revisionTransition.contentDigestPointer) !==
        pointerValue(
          predecessorDefinition,
          revisionTransition.contentDigestPointer,
        );
      if (
        !contentChanged &&
        revisionTransition.unchangedContentRequiresSameRevision &&
        (currentRevisionId !== predecessorRevisionId ||
          currentRevisionNumber !== predecessorRevisionNumber)
      ) {
        violations.push("definition-revision-created-without-content-change");
      }
      if (!contentChanged) continue;
      if (
        revisionTransition.changedContentRequiresFreshRevisionId &&
        reusedChangedRevisionKeys.has(
          stableKey([
            pointerValue(node, lineage.releaseIdPointer),
            definitionId,
          ]),
        )
      ) {
        violations.push("definition-revision-id-reused-for-content-change");
      }
      if (
        typeof currentRevisionNumber === "number" &&
        typeof predecessorRevisionNumber === "number" &&
        currentRevisionNumber !==
          predecessorRevisionNumber +
            revisionTransition.changedContentRevisionIncrement
      ) {
        violations.push("definition-revision-sequence-gap");
      }
    }
    for (const [kind, required, violation] of [
      [
        "subject",
        stableIdRules.membershipRules.requirePredecessorSubjects,
        "predecessor-subject-membership-complete",
      ],
      [
        "alias",
        stableIdRules.membershipRules.requirePredecessorAliases,
        "predecessor-alias-membership-complete",
      ],
      [
        "definition",
        stableIdRules.membershipRules.requirePredecessorDefinitions,
        "predecessor-definition-snapshot-complete",
      ],
    ] as const) {
      if (!required) continue;
      const predecessorIds = new Set(
        predecessor.documents
          .filter((document) => document.kind === kind)
          .map((document) => document.content.id),
      );
      const currentIds = new Set(
        node.documents
          .filter((document) => document.kind === kind)
          .map((document) => document.content.id),
      );
      if ([...predecessorIds].some((id) => !currentIds.has(id))) {
        violations.push(violation);
      }
    }
  }

  return [...new Set(violations)].sort();
};

const validateCanonicalIdentities = (
  bundle: CatalogReleaseBundle,
): string[] => {
  const violations: string[] = [];
  for (const release of bundle.releases) {
    for (const subject of release.documents.filter(
      (document) => document.kind === "subject",
    )) {
      const selectorKind = pointerValue(subject, "/content/selector/kind");
      const selectorValue = pointerValue(subject, "/content/selector/value");
      const result =
        selectorKind === "driver-compatible"
          ? parseCanonicalCompatibleSelector(selectorValue)
          : selectorKind === "node-type-name"
            ? parseCanonicalNodeName(selectorValue)
            : null;
      if (result === null) continue;
      if (!result.ok) {
        violations.push(`subject-selector-${result.error}`);
      }
    }
    for (const alias of release.documents.filter(
      (document) => document.kind === "alias",
    )) {
      const selectorKind = pointerValue(alias, "/content/selectorKind");
      const selectorValue = pointerValue(alias, "/content/normalizedSelector");
      const result =
        selectorKind === "driver-compatible"
          ? parseCanonicalCompatibleSelector(selectorValue)
          : selectorKind === "node-type-name"
            ? parseCanonicalNodeName(selectorValue)
            : null;
      if (result !== null && !result.ok) {
        violations.push(`alias-selector-${result.error}`);
      }
    }
    for (const definition of release.documents.filter(
      (document) => document.kind === "definition",
    )) {
      const result = parseCanonicalPropertyKey(
        pointerValue(definition, "/content/propertyKey"),
      );
      if (!result.ok) {
        violations.push(`definition-property-key-${result.error}`);
      }
    }
  }
  return [...new Set(violations)].sort();
};

const validateBundle = (bundle: CatalogReleaseBundle): string[] => {
  const canonicalIdentityViolations = validateCanonicalIdentities(bundle);
  if (!validateSchema(bundle)) {
    return [
      ...new Set([...canonicalIdentityViolations, "schema-invalid"]),
    ].sort();
  }
  return [
    ...new Set([
      ...canonicalIdentityViolations,
      ...validateStableRules(bundle),
    ]),
  ].sort();
};

const sha256 = (marker: string): string => `sha256:${marker.repeat(64)}`;

const exactYamlBytes = (path: string): Buffer =>
  Buffer.from(
    [
      "$schema: https://devicetree.org/meta-schemas/core.yaml#",
      `$id: https://wiseeff.dev/catalog-test/${path}`,
      `title: Catalog contract fixture for ${path}`,
      "type: object",
      "additionalProperties: true",
      "",
    ].join("\n"),
    "utf8",
  );

const sourceDigest = (path: string): string =>
  `sha256:${createHash("sha256").update(exactYamlBytes(path)).digest("hex")}`;

const sourceInventory = (path: string): SourceInventoryEntry => ({
  path,
  mediaType: "application/yaml",
  encoding: "base64",
  bytes: exactYamlBytes(path).toString("base64"),
});

const yamlSource = (path: string): BundleDocument["source"] => ({
  path,
  mediaType: "application/yaml",
  digest: sourceDigest(path),
});

const releaseDocuments = (): BundleDocument[] => {
  const documents: BundleDocument[] = [
    {
      source: yamlSource("schemas/dts/vendor/wiseeff/sc8562.yaml"),
      kind: "subject",
      normalizedDigest: sha256("1"),
      content: {
        id: "csub_01KSC8562",
        kind: "driver",
        canonicalKey: "driver:sc8562",
        lifecycle: "active",
        selector: {
          kind: "driver-compatible",
          value: "southchip,sc8562",
          provenance: { source: "schemas/dts/vendor/wiseeff/sc8562.yaml" },
        },
        subtype: {
          nature: "physical-device",
          cardinality: { kind: "multiple" },
        },
        tombstone: null,
      },
    },
    {
      source: yamlSource("schemas/dts/vendor/wiseeff/sc8562.yaml"),
      kind: "alias",
      normalizedDigest: sha256("2"),
      content: {
        id: "cali_01KSC8551",
        subjectId: "csub_01KSC8562",
        selectorKind: "driver-compatible",
        normalizedSelector: "southchip,sc8551",
        lifecycle: "active",
        selectorProvenance: { source: "catalog-review" },
        tombstone: null,
      },
    },
    {
      source: yamlSource("schemas/dts/vendor/wiseeff/sc8562.yaml"),
      kind: "definition",
      normalizedDigest: sha256("3"),
      content: {
        id: "pdef_01KVIN",
        subjectId: "csub_01KSC8562",
        propertyKey: "input_voltage_limit",
        revision: {
          id: "drev_01KVIN3",
          number: 1,
          contentDigest: sha256("4"),
          lifecycle: "active",
          displayName: "Input voltage limit",
          documentation: "Maximum accepted input voltage.",
          valueSchema: { type: "integer", minimum: 0 },
          matching: {
            sourceProperty: "input-voltage-limit",
            selectorKind: "driver-compatible",
          },
        },
      },
    },
  ];

  for (const document of documents) {
    if (document.kind !== "definition") continue;
    const revision = pointerValue(
      document,
      stableIdRules.definitionRevisionRules.revisionPointer,
    ) as JsonObject;
    revision.contentDigest = definitionRevisionContentDigest(document);
  }

  return documents.map((document) => ({
    ...document,
    normalizedDigest: `sha256:${createHash("sha256")
      .update(serializeContract(document.content as ContractJsonValue))
      .digest("hex")}`,
  }));
};

const releaseNode = (
  id: string,
  version: string,
  sequence: number,
  predecessor: null | { id: string; digest: string },
): ReleaseNode => {
  const documents = releaseDocuments();
  const node: ReleaseNode = {
    manifest: {
      schemaVersion: "1.0.0",
      release: {
        id,
        version,
        sequence,
        publishedAt:
          sequence === 1 ? "2026-09-01T00:00:00Z" : "2026-09-01T00:01:00Z",
        digest: sha256("0"),
        predecessor,
      },
      toolchain: {
        compiler: "wiseeff-catalog-compiler@1",
        jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
        sourceFormat: "wiseeff-catalog-release@1",
      },
      files: [
        {
          path: documents[0].source.path,
          mediaType: documents[0].source.mediaType,
          digest: documents[0].source.digest,
        },
      ],
      documents: documents.map((document) => ({
        sourcePath: document.source.path,
        kind: document.kind,
        documentId: String(pointerValue(document, "/content/id")),
        normalizedDigest: document.normalizedDigest,
      })),
    },
    sources: [sourceInventory(documents[0].source.path)],
    documents,
  };
  node.manifest.release.digest = releaseAggregateDigest(node);
  return node;
};

const validBundle = (): CatalogReleaseBundle => {
  const first = releaseNode("crel_01", "1.0.0", 1, null);
  const second = releaseNode("crel_02", "1.1.0", 2, {
    id: first.manifest.release.id,
    digest: first.manifest.release.digest,
  });
  return {
    schemaVersion: "1.0.0",
    targetReleaseId: second.manifest.release.id,
    releases: [first, second],
  };
};

const refreshDocumentAndReleaseDigests = (
  release: ReleaseNode,
  document: BundleDocument,
): void => {
  const previousNormalizedDigest = document.normalizedDigest;
  document.normalizedDigest = `sha256:${createHash("sha256")
    .update(serializeContract(document.content as ContractJsonValue))
    .digest("hex")}`;
  const manifestFile = release.manifest.files.find(
    (file) => file.path === document.source.path,
  );
  if (!manifestFile) {
    throw new Error(
      `missing manifest file ${document.source.path}:${document.kind}`,
    );
  }
  const manifestDocument = release.manifest.documents.find(
    (candidate) =>
      candidate.kind === document.kind &&
      candidate.sourcePath === document.source.path &&
      candidate.normalizedDigest === previousNormalizedDigest,
  );
  if (!manifestDocument) {
    throw new Error(
      `missing manifest document ${document.kind}:${String(pointerValue(document, "/content/id"))}`,
    );
  }
  manifestDocument.documentId = String(pointerValue(document, "/content/id"));
  manifestDocument.normalizedDigest = document.normalizedDigest;
  release.manifest.release.digest = releaseAggregateDigest(release);
};

const addDocumentToRelease = (
  release: ReleaseNode,
  document: BundleDocument,
): void => {
  document.normalizedDigest = `sha256:${createHash("sha256")
    .update(serializeContract(document.content as ContractJsonValue))
    .digest("hex")}`;
  release.documents.push(document);
  if (
    !release.manifest.files.some((file) => file.path === document.source.path)
  ) {
    release.manifest.files.push({
      path: document.source.path,
      mediaType: document.source.mediaType,
      digest: document.source.digest,
    });
    release.sources.push(sourceInventory(document.source.path));
  }
  release.manifest.documents.push({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: String(pointerValue(document, "/content/id")),
    normalizedDigest: document.normalizedDigest,
  });
  release.manifest.release.digest = releaseAggregateDigest(release);
};

const asNodeTypeBundle = (selectorValue: unknown): CatalogReleaseBundle => {
  const bundle = validBundle();
  for (const release of bundle.releases) {
    const subject = release.documents.find(
      (document) => document.kind === "subject",
    );
    const alias = release.documents.find(
      (document) => document.kind === "alias",
    );
    const definition = release.documents.find(
      (document) => document.kind === "definition",
    );
    if (!subject || !alias || !definition) {
      throw new Error("missing NodeType fixture");
    }
    subject.content.kind = "node-type";
    subject.content.canonicalKey = "node-type:sc8562";
    subject.content.selector = {
      kind: "node-type-name",
      value: selectorValue,
      provenance: { source: "catalog-review" },
    };
    subject.content.subtype = {};
    alias.content.selectorKind = "node-type-name";
    alias.content.normalizedSelector = "sc8551";
    const revision = definition.content.revision as JsonObject;
    revision.matching = {
      ...(revision.matching as JsonObject),
      selectorKind: "node-type-name",
    };
    revision.contentDigest = definitionRevisionContentDigest(definition);
    refreshDocumentAndReleaseDigests(release, subject);
    refreshDocumentAndReleaseDigests(release, alias);
    refreshDocumentAndReleaseDigests(release, definition);
  }
  const predecessor = bundle.releases[1].manifest.release.predecessor;
  if (!predecessor) throw new Error("missing NodeType predecessor");
  predecessor.digest = bundle.releases[0].manifest.release.digest;
  bundle.releases[1].manifest.release.digest = releaseAggregateDigest(
    bundle.releases[1],
  );
  return bundle;
};

const bundledConsumerSchema = (): JsonObject => {
  const manifestDefinition = structuredClone(manifestSchema);
  delete manifestDefinition.$schema;

  const replaceManifestReference = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceManifestReference);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, entry]) => [
        key,
        key === "$ref" && entry === manifestSchema.$id
          ? "#/$defs/manifest"
          : replaceManifestReference(entry),
      ]),
    );
  };

  const bundled = replaceManifestReference(catalogReleaseSchema) as JsonObject;
  bundled.$defs = {
    ...(bundled.$defs as JsonObject),
    manifest: manifestDefinition,
    stableIdRules: {
      const: stableIdRules,
      description: "Normative pre-compile stable identity and lineage rules.",
    },
  };
  return bundled;
};

describe("immutable Catalog Release bundle contract", () => {
  it("requires exact raw YAML bytes and immutable publication time in every release", () => {
    expect(
      pointerValue(catalogReleaseSchema, "/$defs/releaseNode/required"),
    ).toContain("sources");
    expect(
      pointerValue(manifestSchema, "/$defs/releaseIdentity/required"),
    ).toContain("publishedAt");
    expect(
      stableIdRules.manifestRules.releaseAggregateDigest.modelPointers,
    ).toContain("/manifest/release/publishedAt");
    expect(
      stableIdRules.manifestRules.releaseAggregateDigest.modelPointers,
    ).toContain("/sources");
  });

  it("separates exact YAML source provenance from normalized document digests", () => {
    const bundle = validBundle();
    expect(validateBundle(bundle)).toEqual([]);

    for (const release of bundle.releases) {
      expect(release.manifest.files).toEqual([
        {
          path: "schemas/dts/vendor/wiseeff/sc8562.yaml",
          mediaType: "application/yaml",
          digest: sourceDigest("schemas/dts/vendor/wiseeff/sc8562.yaml"),
        },
      ]);
      expect(release.sources).toEqual([
        sourceInventory("schemas/dts/vendor/wiseeff/sc8562.yaml"),
      ]);
      for (const document of release.documents) {
        expect(document.source).toEqual(release.manifest.files[0]);
        expect(document.normalizedDigest).not.toBe(document.source.digest);
      }
    }

    const mismatchedSource = validBundle();
    mismatchedSource.releases[1].documents[0].source.digest = sha256("f");
    expect(validateBundle(mismatchedSource)).toContain(
      "manifest-content-exact",
    );

    const mismatchedNormalizedDocument = validBundle();
    mismatchedNormalizedDocument.releases[1].documents[0].content.canonicalKey =
      "driver:tampered";
    expect(validateBundle(mismatchedNormalizedDocument)).toContain(
      "document-digest-mismatch",
    );

    const mutatedBytes = validBundle();
    const mutatedSource = mutatedBytes.releases[1].sources[0];
    const exactBytes = Buffer.from(mutatedSource.bytes, "base64");
    exactBytes[exactBytes.length - 2] ^= 1;
    mutatedSource.bytes = exactBytes.toString("base64");
    mutatedBytes.releases[1].manifest.release.digest = releaseAggregateDigest(
      mutatedBytes.releases[1],
    );
    expect(validateSchema(mutatedBytes)).toBe(true);
    expect(validateBundle(mutatedBytes)).toContain("manifest-content-exact");

    const staleDigest = validBundle();
    const staleRelease = staleDigest.releases[1];
    staleRelease.manifest.files[0].digest = sha256("f");
    for (const document of staleRelease.documents) {
      document.source.digest = sha256("f");
    }
    staleRelease.manifest.release.digest = releaseAggregateDigest(staleRelease);
    expect(validateSchema(staleDigest)).toBe(true);
    expect(validateBundle(staleDigest)).toContain("manifest-content-exact");

    const duplicatePathWithDifferentBytes = validBundle();
    const duplicateRelease = duplicatePathWithDifferentBytes.releases[1];
    duplicateRelease.sources.push({
      ...duplicateRelease.sources[0],
      bytes: Buffer.from("title: conflicting YAML bytes\n", "utf8").toString(
        "base64",
      ),
    });
    duplicateRelease.manifest.release.digest =
      releaseAggregateDigest(duplicateRelease);
    expect(validateSchema(duplicatePathWithDifferentBytes)).toBe(true);
    expect(validateBundle(duplicatePathWithDifferentBytes)).toContain(
      "manifest-content-exact",
    );

    const nonCanonicalBase64 = validBundle();
    nonCanonicalBase64.releases[1].sources[0].bytes = "Zh==";
    nonCanonicalBase64.releases[1].manifest.release.digest =
      releaseAggregateDigest(nonCanonicalBase64.releases[1]);
    expect(validateSchema(nonCanonicalBase64)).toBe(true);
    expect(validateBundle(nonCanonicalBase64)).toContain(
      "manifest-content-exact",
    );
  });

  it("binds canonical compiler-reviewed publication time into release identity", () => {
    const bundle = validBundle();
    expect(validateBundle(bundle)).toEqual([]);
    expect(
      bundle.releases.map((release) => release.manifest.release.publishedAt),
    ).toEqual(["2026-09-01T00:00:00Z", "2026-09-01T00:01:00Z"]);
    expect(stableIdRules.manifestRules.publicationTime).toEqual({
      pointer: "/manifest/release/publishedAt",
      format: "rfc3339-utc-seconds",
      source: "compiler-reviewed-release-metadata",
      forbidInstallationOrSynchronizationClock: true,
    });

    const missing = validBundle() as unknown as JsonObject;
    delete (
      (missing.releases as ReleaseNode[])[1].manifest.release as Partial<
        ReleaseNode["manifest"]["release"]
      >
    ).publishedAt;
    expect(validateBundle(missing as unknown as CatalogReleaseBundle)).toEqual([
      "schema-invalid",
    ]);

    const nonCanonical = validBundle();
    nonCanonical.releases[1].manifest.release.publishedAt =
      "2026-09-01T08:01:00+08:00";
    expect(validateBundle(nonCanonical)).toEqual(["schema-invalid"]);

    const invalidCalendarDate = validBundle();
    invalidCalendarDate.releases[1].manifest.release.publishedAt =
      "2026-02-31T00:01:00Z";
    invalidCalendarDate.releases[1].manifest.release.digest =
      releaseAggregateDigest(invalidCalendarDate.releases[1]);
    expect(validateSchema(invalidCalendarDate)).toBe(true);
    expect(validateBundle(invalidCalendarDate)).toContain(
      "manifest-content-exact",
    );

    const tampered = validBundle();
    tampered.releases[1].manifest.release.publishedAt = "2026-09-01T00:02:00Z";
    expect(validateBundle(tampered)).toContain(
      "release-aggregate-digest-mismatch",
    );
  });

  it("accepts a closed, complete bundle through the public schema and stable-rule seam", () => {
    const bundle = validBundle();

    expect(
      validateBundle(bundle),
      JSON.stringify(validateSchema.errors),
    ).toEqual([]);
    expect(stableIdRules.closedEnums).toEqual({
      catalogSubjectKinds: [...catalogSubjectKinds],
      catalogSubjectSelectorKinds: [...catalogSubjectSelectorKinds],
      driverNatures: [...driverNatures],
      driverInstanceCardinalities: [...driverInstanceCardinalities],
      definitionLifecycles: [...definitionLifecycles],
      subjectLifecycles: [...subjectLifecycles],
    });
    expect(
      pointerValue(
        catalogReleaseSchema,
        "/$defs/driverSubtype/properties/nature/enum",
      ),
    ).toEqual([...driverNatures]);
    expect(
      pointerValue(
        catalogReleaseSchema,
        "/$defs/driverSubtype/properties/cardinality/properties/kind/enum",
      ),
    ).toEqual([...driverInstanceCardinalities]);
  });

  it("pins the exact merged S0-ID constructors, enums, and golden fingerprint", () => {
    expect(stableIdRules.s0IdContract).toEqual({
      mergedImplementationSha: "9b3ba7df7e21f5589684bc92c872da593ad4c246",
      packageEntrypoint: "server/modules/parameter-catalog-contract/index.ts",
      serializationGolden: {
        path: "server/modules/parameter-catalog-contract/__fixtures__/serialization-golden.json",
        gitBlobOid: "c856ec070286a32c59ff13d8aef545139435c96c",
        byteLength: 1528,
        rawSha256:
          "0979a58a624cf160181425de92816fb1dd8bb285ea27896ba1f95287f6143d75",
      },
      constructors: {
        compatible: "parseCanonicalCompatibleSelector",
        nodeName: "parseCanonicalNodeName",
        propertyKey: "parseCanonicalPropertyKey",
      },
      enumRegistries: {
        driverNatures: "driverNatures",
        driverInstanceCardinalities: "driverInstanceCardinalities",
      },
    });

    const generated = JSON.parse(generatedSchemaBytes) as JsonObject;
    expect(
      pointerValue(generated, "/$defs/stableIdRules/const/s0IdContract"),
    ).toEqual(stableIdRules.s0IdContract);
  });

  it("rejects malformed lifecycle/tombstone pairs and invented fields before compile", () => {
    const malformed = validBundle();
    const subject = malformed.releases[1].documents[0].content;
    subject.lifecycle = "retired";
    subject.tombstone = null;
    subject.inventedCurrentFlag = true;

    expect(validateBundle(malformed)).toEqual(["schema-invalid"]);
  });

  it("rejects non-canonical relative paths before compile", () => {
    for (const path of [
      "schemas/dts/vendor/wiseeff//sc8562.yaml",
      "schemas/dts/vendor/wiseeff/sc8562.yaml/",
      "schemas/dts/vendor/wiseeff/./sc8562.yaml",
      "./schemas/dts/vendor/wiseeff/sc8562.yaml",
      "schemas/dts/vendor/wiseeff/../sc8562.yaml",
    ]) {
      const malformed = validBundle();
      const release = malformed.releases[1];
      release.documents[0].source.path = path;
      release.manifest.files[0].path = path;
      release.manifest.documents[0].sourcePath = path;
      release.sources[0].path = path;
      release.manifest.release.digest = releaseAggregateDigest(release);

      expect(validateBundle(malformed), path).toEqual(["schema-invalid"]);
    }
  });

  it("rejects missing and unlisted bundle content before compile", () => {
    const missing = validBundle();
    missing.releases[1].documents.pop();
    expect(validateBundle(missing)).toContain("manifest-content-exact");

    const unlisted = validBundle();
    unlisted.releases[1].documents.push({
      ...structuredClone(unlisted.releases[1].documents[0]),
      source: yamlSource("schemas/dts/vendor/wiseeff/unlisted.yaml"),
    });
    expect(validateBundle(unlisted)).toContain("manifest-content-exact");
  });

  it("rejects document content whose declared digest no longer matches canonical bytes", () => {
    const tampered = validBundle();
    tampered.releases[1].documents[0].content.canonicalKey = "driver:tampered";

    expect(validateBundle(tampered)).toContain("document-digest-mismatch");
  });

  it("recomputes DefinitionRevision content digests from persisted revision content", () => {
    const tampered = validBundle();
    const release = tampered.releases[1];
    const definition = release.documents.find(
      (document) => document.kind === "definition",
    );
    if (!definition) throw new Error("missing definition fixture");
    const revision = definition.content.revision as JsonObject;
    revision.documentation = "Changed without issuing a new content digest.";
    refreshDocumentAndReleaseDigests(release, definition);

    expect(validateBundle(tampered)).toContain(
      "definition-revision-content-digest-mismatch",
    );

    const rewritten = validBundle();
    const rewrittenRelease = rewritten.releases[1];
    const rewrittenDefinition = rewrittenRelease.documents.find(
      (document) => document.kind === "definition",
    );
    if (!rewrittenDefinition) throw new Error("missing definition fixture");
    const rewrittenRevision = rewrittenDefinition.content
      .revision as JsonObject;
    rewrittenRevision.documentation =
      "Changed under the same revision identity.";
    rewrittenRevision.contentDigest =
      definitionRevisionContentDigest(rewrittenDefinition);
    refreshDocumentAndReleaseDigests(rewrittenRelease, rewrittenDefinition);
    expect(validateBundle(rewritten)).toContain("definition-id-reassigned");
  });

  it("advances DefinitionRevision exactly once only when persisted content changes", () => {
    const rewriteDefinition = (
      bundle: CatalogReleaseBundle,
      input: { documentation?: string; id: string; number: number },
    ): void => {
      const release = bundle.releases[1];
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!definition) throw new Error("missing definition fixture");
      const revision = definition.content.revision as JsonObject;
      if (input.documentation !== undefined) {
        revision.documentation = input.documentation;
      }
      revision.id = input.id;
      revision.number = input.number;
      revision.contentDigest = definitionRevisionContentDigest(definition);
      refreshDocumentAndReleaseDigests(release, definition);
    };

    const validAdvance = validBundle();
    rewriteDefinition(validAdvance, {
      documentation: "One persisted content change.",
      id: "drev_01KVIN4",
      number: 2,
    });
    expect(validateBundle(validAdvance)).toEqual([]);

    const unchangedNewRevision = validBundle();
    rewriteDefinition(unchangedNewRevision, {
      id: "drev_01KVIN4",
      number: 2,
    });
    expect(validateBundle(unchangedNewRevision)).toContain(
      "definition-revision-created-without-content-change",
    );

    const reusedRevisionId = validBundle();
    rewriteDefinition(reusedRevisionId, {
      documentation: "Changed while reusing the predecessor revision ID.",
      id: "drev_01KVIN3",
      number: 2,
    });
    expect(validateBundle(reusedRevisionId)).toContain(
      "definition-revision-id-reused-for-content-change",
    );

    const skippedRevision = validBundle();
    rewriteDefinition(skippedRevision, {
      documentation: "Changed while skipping a revision number.",
      id: "drev_01KVIN5",
      number: 3,
    });
    expect(validateBundle(skippedRevision)).toContain(
      "definition-revision-sequence-gap",
    );

    const backReference = validBundle();
    rewriteDefinition(backReference, {
      documentation: "Changed while pointing back to the predecessor revision.",
      id: "drev_01KVIN3",
      number: 1,
    });
    expect(validateBundle(backReference)).toContain(
      "definition-revision-id-reused-for-content-change",
    );
  });

  it("requires closed self-contained JSON Schema 2020-12 value contracts", () => {
    const bundleWithValueSchema = (
      valueSchema: JsonObject,
    ): CatalogReleaseBundle => {
      const bundle = validBundle();
      const release = bundle.releases[1];
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!definition) throw new Error("missing definition fixture");
      const revision = definition.content.revision as JsonObject;
      revision.id = "drev_01KVIN4";
      revision.number = 2;
      revision.valueSchema = valueSchema;
      revision.contentDigest = definitionRevisionContentDigest(definition);
      refreshDocumentAndReleaseDigests(release, definition);
      return bundle;
    };

    expect(
      validateBundle(
        bundleWithValueSchema({ type: "definitely-not-a-json-schema-type" }),
      ),
    ).toContain("definition-value-schema-invalid");

    for (const valueSchema of [
      { $ref: "#/$defs/missing" },
      { $ref: "https://schemas.example.invalid/unlisted.json" },
      {
        $defs: { cycle: { $ref: "#/$defs/cycle" } },
        $ref: "#/$defs/cycle",
      },
      {
        $dynamicAnchor: "node",
        allOf: [{ $dynamicRef: "#node" }],
      },
    ]) {
      expect(validateBundle(bundleWithValueSchema(valueSchema))).toContain(
        "definition-value-schema-ref-forbidden",
      );
    }

    expect(stableIdRules.valueSchemaRules).toMatchObject({
      referencePolicy: "forbid-all-json-schema-2020-12-reference-keywords",
      forbiddenReferenceKeywords: ["$ref", "$dynamicRef"],
      traversal: {
        strategy: "iterative-depth-first",
        rootDepth: 0,
        maxDepth: 64,
        maxContainerNodes: 4096,
        limitViolation: "definition-value-schema-complexity-limit",
      },
    });

    let tooDeep: JsonObject = { type: "integer" };
    for (let depth = 0; depth < 65; depth += 1) {
      tooDeep = { allOf: [tooDeep] };
    }
    expect(validateBundle(bundleWithValueSchema(tooDeep))).toContain(
      "definition-value-schema-complexity-limit",
    );
  });

  it("requires Deprecated Definition revisions to name a structured successor", () => {
    const deprecatedWithoutSuccessor = validBundle();
    const missingRelease = deprecatedWithoutSuccessor.releases[1];
    const missingDefinition = missingRelease.documents.find(
      (document) => document.kind === "definition",
    );
    if (!missingDefinition) throw new Error("missing definition fixture");
    const missingRevision = missingDefinition.content.revision as JsonObject;
    missingRevision.id = "drev_01KVIN4";
    missingRevision.number = 2;
    missingRevision.lifecycle = "deprecated";
    missingRevision.contentDigest =
      definitionRevisionContentDigest(missingDefinition);
    refreshDocumentAndReleaseDigests(missingRelease, missingDefinition);
    expect(validateBundle(deprecatedWithoutSuccessor)).toEqual([
      "schema-invalid",
    ]);

    const deprecated = validBundle();
    const release = deprecated.releases[1];
    const definition = release.documents.find(
      (document) => document.kind === "definition",
    );
    if (!definition) throw new Error("missing definition fixture");
    const predecessorDefinition = deprecated.releases[0].documents.find(
      (document) => document.kind === "definition",
    );
    if (!predecessorDefinition) {
      throw new Error("missing predecessor Definition fixture");
    }
    const successor = structuredClone(definition);
    successor.source = yamlSource(
      "schemas/dts/vendor/wiseeff/sc8562-input-voltage-limit-v2.yaml",
    );
    successor.content.id = "pdef_01KVIN_SUCCESSOR";
    successor.content.propertyKey = "input_voltage_limit_v2";
    const successorRevision = successor.content.revision as JsonObject;
    successorRevision.id = "drev_01KVIN_SUCCESSOR1";
    successorRevision.number = 1;
    successorRevision.contentDigest =
      definitionRevisionContentDigest(successor);
    addDocumentToRelease(release, successor);

    const revision = definition.content.revision as JsonObject;
    revision.id = "drev_01KVIN4";
    revision.number = 2;
    revision.lifecycle = "deprecated";
    revision.successorDefinitionId = successor.content.id;
    revision.contentDigest = definitionRevisionContentDigest(definition);
    expect(revision.contentDigest).not.toBe(
      (predecessorDefinition.content.revision as JsonObject).contentDigest,
    );
    refreshDocumentAndReleaseDigests(release, definition);
    expect(validateBundle(deprecated)).toEqual([]);

    const staleRevisionIdentity = structuredClone(deprecated);
    const staleRelease = staleRevisionIdentity.releases[1];
    const staleDefinition = staleRelease.documents.find(
      (document) => document.content.id === "pdef_01KVIN",
    );
    if (!staleDefinition) throw new Error("missing stale Definition fixture");
    const staleRevision = staleDefinition.content.revision as JsonObject;
    staleRevision.id = "drev_01KVIN3";
    staleRevision.number = 1;
    refreshDocumentAndReleaseDigests(staleRelease, staleDefinition);
    expect(validateBundle(staleRevisionIdentity)).toContain(
      "definition-revision-id-reused-for-content-change",
    );

    const danglingSuccessor = structuredClone(deprecated);
    const danglingRelease = danglingSuccessor.releases[1];
    const danglingDefinition = danglingRelease.documents.find(
      (document) => document.content.id === "pdef_01KVIN",
    );
    if (!danglingDefinition) throw new Error("missing deprecated fixture");
    const danglingRevision = danglingDefinition.content.revision as JsonObject;
    danglingRevision.successorDefinitionId = "pdef_missing";
    danglingRevision.contentDigest =
      definitionRevisionContentDigest(danglingDefinition);
    refreshDocumentAndReleaseDigests(danglingRelease, danglingDefinition);
    expect(validateBundle(danglingSuccessor)).toContain(
      "definition-successor-missing",
    );

    const selfSuccessor = structuredClone(deprecated);
    const selfRelease = selfSuccessor.releases[1];
    const selfDefinition = selfRelease.documents.find(
      (document) => document.content.id === "pdef_01KVIN",
    );
    if (!selfDefinition) throw new Error("missing deprecated fixture");
    const selfRevision = selfDefinition.content.revision as JsonObject;
    selfRevision.successorDefinitionId = selfDefinition.content.id;
    selfRevision.contentDigest =
      definitionRevisionContentDigest(selfDefinition);
    refreshDocumentAndReleaseDigests(selfRelease, selfDefinition);
    expect(validateBundle(selfSuccessor)).toContain(
      "definition-successor-invalid",
    );

    const activeWithSuccessor = validBundle();
    const activeRelease = activeWithSuccessor.releases[1];
    const activeDefinition = activeRelease.documents.find(
      (document) => document.kind === "definition",
    );
    if (!activeDefinition) throw new Error("missing active Definition fixture");
    const activeRevision = activeDefinition.content.revision as JsonObject;
    activeRevision.successorDefinitionId = "pdef_01KVIN_SUCCESSOR";
    activeRevision.contentDigest =
      definitionRevisionContentDigest(activeDefinition);
    refreshDocumentAndReleaseDigests(activeRelease, activeDefinition);
    expect(validateBundle(activeWithSuccessor)).toEqual(["schema-invalid"]);
  });

  it("requires Deprecated Definition successor graphs to terminate active without cycles", () => {
    const bundleWithDefinitionGraph = (
      lifecycles: Array<"active" | "deprecated" | "retired">,
      successorIndexes: Array<number | undefined>,
    ): CatalogReleaseBundle => {
      const bundle = validBundle();
      const release = bundle.releases[1];
      const baseDefinition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!baseDefinition) throw new Error("missing definition fixture");
      const template = structuredClone(baseDefinition);
      const definitionIds = lifecycles.map((_, index) =>
        index === 0 ? "pdef_01KVIN" : `pdef_GRAPH_${index}`,
      );

      for (const [index, lifecycle] of lifecycles.entries()) {
        const definition =
          index === 0 ? baseDefinition : structuredClone(template);
        if (index > 0) {
          definition.source = yamlSource(
            `schemas/dts/vendor/wiseeff/sc8562-graph-${index}.yaml`,
          );
          definition.content.id = definitionIds[index];
          definition.content.propertyKey = `graph_property_${index}`;
        }
        const revision = definition.content.revision as JsonObject;
        revision.id = `drev_GRAPH_${index}_${index === 0 ? 2 : 1}`;
        revision.number = index === 0 ? 2 : 1;
        revision.lifecycle = lifecycle;
        const successorIndex = successorIndexes[index];
        if (lifecycle === "deprecated" && successorIndex !== undefined) {
          revision.successorDefinitionId = definitionIds[successorIndex];
        } else {
          delete revision.successorDefinitionId;
        }
        revision.contentDigest = definitionRevisionContentDigest(definition);
        if (index === 0) {
          refreshDocumentAndReleaseDigests(release, definition);
        } else {
          addDocumentToRelease(release, definition);
        }
      }
      return bundle;
    };

    const twoNodeCycle = bundleWithDefinitionGraph(
      ["deprecated", "deprecated"],
      [1, 0],
    );
    expect(validateBundle(twoNodeCycle)).toContain(
      "definition-successor-cycle",
    );

    const longCycleLength = 96;
    const longCycle = bundleWithDefinitionGraph(
      Array.from({ length: longCycleLength }, () => "deprecated"),
      Array.from(
        { length: longCycleLength },
        (_, index) => (index + 1) % longCycleLength,
      ),
    );
    expect(validateBundle(longCycle)).toContain("definition-successor-cycle");

    const retiredTerminal = bundleWithDefinitionGraph(
      ["deprecated", "retired"],
      [1, undefined],
    );
    expect(validateBundle(retiredTerminal)).toContain(
      "definition-successor-terminal-invalid",
    );

    const activeTerminal = bundleWithDefinitionGraph(
      ["deprecated", "deprecated", "active"],
      [1, 2, undefined],
    );
    expect(validateBundle(activeTerminal)).toEqual([]);

    expect(stableIdRules.definitionLifecycleRules.successorGraph).toEqual({
      strategy: "iterative-indexed",
      requireAcyclic: true,
      terminalLifecycle: "active",
      cycleViolation: "definition-successor-cycle",
      terminalViolation: "definition-successor-terminal-invalid",
    });
  });

  it("binds the aggregate digest to the normalized complete release model", () => {
    const changedToolchain = validBundle();
    changedToolchain.releases[1].manifest.toolchain.compiler =
      "wiseeff-catalog-compiler@tampered";
    expect(validateBundle(changedToolchain)).toContain(
      "release-aggregate-digest-mismatch",
    );

    const changedProvenance = validBundle();
    const release = changedProvenance.releases[1];
    const subject = release.documents[0];
    subject.content.selector = {
      ...(subject.content.selector as JsonObject),
      provenance: { source: "tampered-provenance" },
    };
    subject.normalizedDigest = `sha256:${createHash("sha256")
      .update(serializeContract(subject.content as ContractJsonValue))
      .digest("hex")}`;
    release.manifest.documents[0].normalizedDigest = subject.normalizedDigest;
    expect(validateBundle(changedProvenance)).toContain(
      "release-aggregate-digest-mismatch",
    );
  });

  it("orders release collections by the S0 code-unit comparator across locale and input order", () => {
    const release = structuredClone(validBundle().releases[1]);
    const paths = [
      "schemas/dts/Z.yaml",
      "schemas/dts/a.yaml",
      "schemas/dts/z.yaml",
    ];
    for (const [index, document] of release.documents.entries()) {
      document.source = yamlSource(paths[index]);
      release.manifest.documents[index].sourcePath = paths[index];
    }
    release.manifest.files = paths.map((path) => ({
      path,
      mediaType: "application/yaml",
      digest: sourceDigest(path),
    }));
    release.sources = paths.map(sourceInventory);
    const expected = releaseAggregateDigest(release);
    expect(expected).toBe(
      "sha256:d5706173bc51e186db183bda2f24eeb9043a9d4e25e62bf257fb300fc1d96bba",
    );
    expect(
      stableIdRules.manifestRules.releaseAggregateDigest.sortedCollections.map(
        (collection) => collection.comparator,
      ),
    ).toEqual([
      "ecmascript-utf16-code-unit",
      "ecmascript-utf16-code-unit",
      "ecmascript-utf16-code-unit",
      "ecmascript-utf16-code-unit",
    ]);

    release.documents.reverse();
    release.manifest.files.reverse();
    release.manifest.documents.reverse();
    release.sources.reverse();
    expect(releaseAggregateDigest(release)).toBe(expected);

    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => 0);
    try {
      expect(releaseAggregateDigest(release)).toBe(expected);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("rejects stable-ID and natural-key reassignment across release lineage", () => {
    const reassignedId = validBundle();
    reassignedId.releases[1].documents[0].content.canonicalKey = "driver:other";
    expect(validateBundle(reassignedId)).toContain("subject-id-reassigned");

    const reassignedNaturalKey = validBundle();
    reassignedNaturalKey.releases[1].documents[0].content.id = "csub_other";
    expect(validateBundle(reassignedNaturalKey)).toContain(
      "subject-natural-key-reassigned",
    );
  });

  it("rejects duplicate formal identities under different paths in one release", () => {
    for (const kind of ["subject", "alias", "definition"] as const) {
      const duplicated = validBundle();
      const release = duplicated.releases[1];
      const original = release.documents.find(
        (document) => document.kind === kind,
      );
      if (!original) throw new Error(`missing ${kind} fixture`);
      const duplicate = structuredClone(original);
      duplicate.source = yamlSource(
        `schemas/dts/vendor/wiseeff/duplicate-${kind}.yaml`,
      );
      addDocumentToRelease(release, duplicate);

      expect(validateBundle(duplicated)).toContain(
        `${kind}-id-duplicate-in-release`,
      );
      expect(validateBundle(duplicated)).toContain(
        `${kind}-natural-key-duplicate-in-release`,
      );
    }
  });

  it("rejects release version or digest reuse by a different release identity", () => {
    const reusedVersion = validBundle();
    reusedVersion.releases[1].manifest.release.version =
      reusedVersion.releases[0].manifest.release.version;
    expect(validateBundle(reusedVersion)).toContain("release-version-unique");

    const reusedDigest = validBundle();
    reusedDigest.releases[1].manifest.release.digest =
      reusedDigest.releases[0].manifest.release.digest;
    expect(validateBundle(reusedDigest)).toContain("release-digest-unique");
  });

  it("rejects cycles and gaps in the exact predecessor lineage", () => {
    const cyclic = validBundle();
    cyclic.releases[0].manifest.release.predecessor = {
      id: cyclic.releases[1].manifest.release.id,
      digest: cyclic.releases[1].manifest.release.digest,
    };
    expect(validateBundle(cyclic)).toContain("release-lineage-acyclic");

    const missingPredecessor = validBundle();
    missingPredecessor.releases[1].manifest.release.predecessor = {
      id: "crel_missing",
      digest: sha256("f"),
    };
    expect(validateBundle(missingPredecessor)).toContain(
      "release-lineage-connected",
    );

    expect(stableIdRules.lineageRules.traversal).toEqual({
      strategy: "iterative-indexed",
      releaseIndex: "release-id",
      documentIndex: "release-id/document-kind/document-id",
      revisionHistoryIndex: "definition-id/revision-id",
    });
  });

  it("requires complete predecessor subject/alias membership and valid alias owners", () => {
    const omittedSubject = validBundle();
    const predecessorOnlySubject = structuredClone(
      omittedSubject.releases[0].documents[0],
    );
    predecessorOnlySubject.source = yamlSource(
      "schemas/dts/vendor/wiseeff/predecessor-only.yaml",
    );
    predecessorOnlySubject.content.id = "csub_predecessor_only";
    predecessorOnlySubject.content.canonicalKey = "driver:predecessor-only";
    predecessorOnlySubject.content.selector = {
      kind: "driver-compatible",
      value: "wiseeff,predecessor-only",
      provenance: { source: "catalog-review" },
    };
    addDocumentToRelease(omittedSubject.releases[0], predecessorOnlySubject);
    expect(validateBundle(omittedSubject)).toContain(
      "predecessor-subject-membership-complete",
    );

    const retiredOwner = validBundle();
    retiredOwner.releases[1].documents[0].content.lifecycle = "retired";
    retiredOwner.releases[1].documents[0].content.tombstone = {
      reason: "superseded",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8562",
    };
    expect(validateBundle(retiredOwner)).toContain(
      "active-alias-requires-active-subject",
    );
  });

  it("rejects dangling subject references from retired Aliases and Definitions", () => {
    const danglingAlias = validBundle();
    const aliasRelease = danglingAlias.releases[1];
    const alias = aliasRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!alias) throw new Error("missing alias fixture");
    alias.content.subjectId = "csub_missing";
    alias.content.lifecycle = "retired";
    alias.content.tombstone = {
      reason: "withdrawn",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8551",
    };
    refreshDocumentAndReleaseDigests(aliasRelease, alias);
    expect(validateBundle(danglingAlias)).toContain("alias-subject-missing");

    const danglingDefinition = validBundle();
    const definitionRelease = danglingDefinition.releases[1];
    const definition = definitionRelease.documents.find(
      (document) => document.kind === "definition",
    );
    if (!definition) throw new Error("missing definition fixture");
    definition.content.subjectId = "csub_missing";
    refreshDocumentAndReleaseDigests(definitionRelease, definition);
    expect(validateBundle(danglingDefinition)).toContain(
      "definition-subject-missing",
    );
  });

  it("binds retirement tombstones to the actual release, predecessor selector, and legal successor", () => {
    const retiredBundle = validBundle();
    const release = retiredBundle.releases[1];
    const subject = release.documents.find(
      (document) => document.kind === "subject",
    );
    const alias = release.documents.find(
      (document) => document.kind === "alias",
    );
    if (!subject || !alias) throw new Error("missing retirement fixtures");
    subject.content.lifecycle = "retired";
    subject.content.tombstone = {
      reason: "superseded",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8562",
    };
    alias.content.lifecycle = "retired";
    alias.content.tombstone = {
      reason: "superseded",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8551",
    };
    refreshDocumentAndReleaseDigests(release, subject);
    refreshDocumentAndReleaseDigests(release, alias);
    expect(validateBundle(retiredBundle)).toEqual([]);

    const continuedRetirement = structuredClone(retiredBundle);
    const secondRelease = continuedRetirement.releases[1];
    const thirdRelease = structuredClone(secondRelease);
    thirdRelease.manifest.release = {
      id: "crel_03",
      version: "1.2.0",
      sequence: 3,
      publishedAt: "2026-09-01T00:02:00Z",
      digest: sha256("0"),
      predecessor: {
        id: secondRelease.manifest.release.id,
        digest: secondRelease.manifest.release.digest,
      },
    };
    thirdRelease.manifest.release.digest = releaseAggregateDigest(thirdRelease);
    continuedRetirement.releases.push(thirdRelease);
    continuedRetirement.targetReleaseId = thirdRelease.manifest.release.id;
    expect(validateBundle(continuedRetirement)).toEqual([]);

    const forgedContinuedRetirement = structuredClone(continuedRetirement);
    const forgedThirdSubject =
      forgedContinuedRetirement.releases[2].documents.find(
        (document) => document.kind === "subject",
      );
    if (!forgedThirdSubject) throw new Error("missing subject fixture");
    (forgedThirdSubject.content.tombstone as JsonObject).withdrawnByReleaseId =
      "crel_03";
    refreshDocumentAndReleaseDigests(
      forgedContinuedRetirement.releases[2],
      forgedThirdSubject,
    );
    expect(validateBundle(forgedContinuedRetirement)).toContain(
      "retirement-release-mismatch",
    );

    const rewrittenRetirementProvenance = structuredClone(retiredBundle);
    const rewrittenSecond = rewrittenRetirementProvenance.releases[1];
    const rewrittenSecondSubject = rewrittenSecond.documents.find(
      (document) => document.kind === "subject",
    );
    if (!rewrittenSecondSubject) throw new Error("missing subject fixture");
    (rewrittenSecondSubject.content.selector as JsonObject).value =
      "southchip,withdrawn-sc8562";
    refreshDocumentAndReleaseDigests(rewrittenSecond, rewrittenSecondSubject);
    const rewrittenThird = structuredClone(rewrittenSecond);
    rewrittenThird.manifest.release = {
      id: "crel_03",
      version: "1.2.0",
      sequence: 3,
      publishedAt: "2026-09-01T00:02:00Z",
      digest: sha256("0"),
      predecessor: {
        id: rewrittenSecond.manifest.release.id,
        digest: rewrittenSecond.manifest.release.digest,
      },
    };
    const rewrittenThirdSubject = rewrittenThird.documents.find(
      (document) => document.kind === "subject",
    );
    if (!rewrittenThirdSubject) throw new Error("missing subject fixture");
    (rewrittenThirdSubject.content.tombstone as JsonObject).previousSelector =
      "southchip,withdrawn-sc8562";
    refreshDocumentAndReleaseDigests(rewrittenThird, rewrittenThirdSubject);
    rewrittenRetirementProvenance.releases.push(rewrittenThird);
    rewrittenRetirementProvenance.targetReleaseId = "crel_03";
    expect(validateBundle(rewrittenRetirementProvenance)).toContain(
      "retirement-previous-selector-mismatch",
    );

    const forgedRelease = structuredClone(retiredBundle);
    const forgedSubject = forgedRelease.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!forgedSubject) throw new Error("missing subject fixture");
    (forgedSubject.content.tombstone as JsonObject).withdrawnByReleaseId =
      "crel_01";
    refreshDocumentAndReleaseDigests(forgedRelease.releases[1], forgedSubject);
    expect(validateBundle(forgedRelease)).toContain(
      "retirement-release-mismatch",
    );

    const wrongSelector = structuredClone(retiredBundle);
    const wrongAlias = wrongSelector.releases[1].documents.find(
      (document) => document.kind === "alias",
    );
    if (!wrongAlias) throw new Error("missing alias fixture");
    (wrongAlias.content.tombstone as JsonObject).previousSelector =
      "southchip,forged";
    refreshDocumentAndReleaseDigests(wrongSelector.releases[1], wrongAlias);
    expect(validateBundle(wrongSelector)).toContain(
      "retirement-previous-selector-mismatch",
    );

    const danglingSuccessor = structuredClone(retiredBundle);
    const danglingSubject = danglingSuccessor.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!danglingSubject) throw new Error("missing subject fixture");
    (danglingSubject.content.tombstone as JsonObject).successorId =
      "csub_missing";
    refreshDocumentAndReleaseDigests(
      danglingSuccessor.releases[1],
      danglingSubject,
    );
    expect(validateBundle(danglingSuccessor)).toContain(
      "retirement-successor-missing",
    );

    const wrongKindSuccessor = structuredClone(retiredBundle);
    const wrongKindSubject = wrongKindSuccessor.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!wrongKindSubject) throw new Error("missing subject fixture");
    (wrongKindSubject.content.tombstone as JsonObject).successorId =
      "cali_01KSC8551";
    refreshDocumentAndReleaseDigests(
      wrongKindSuccessor.releases[1],
      wrongKindSubject,
    );
    expect(validateBundle(wrongKindSuccessor)).toContain(
      "retirement-successor-kind-mismatch",
    );

    const legalSuccessor = structuredClone(retiredBundle);
    const successorRelease = legalSuccessor.releases[1];
    const retiredSubject = successorRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!retiredSubject) throw new Error("missing subject fixture");
    const successor = structuredClone(retiredSubject);
    successor.source = yamlSource(
      "schemas/dts/vendor/wiseeff/sc8562-successor.yaml",
    );
    successor.content.id = "csub_01KSC8562_SUCCESSOR";
    successor.content.canonicalKey = "driver:sc8562-successor";
    successor.content.lifecycle = "active";
    successor.content.selector = {
      kind: "driver-compatible",
      value: "southchip,sc8562-successor",
      provenance: { source: "catalog-review" },
    };
    successor.content.tombstone = null;
    addDocumentToRelease(successorRelease, successor);
    (retiredSubject.content.tombstone as JsonObject).successorId =
      successor.content.id;
    refreshDocumentAndReleaseDigests(successorRelease, retiredSubject);
    expect(validateBundle(legalSuccessor)).toEqual([]);

    const wrongSemanticSubject = structuredClone(legalSuccessor);
    const semanticSubjectRelease = wrongSemanticSubject.releases[1];
    const nodeTypeSuccessor = semanticSubjectRelease.documents.find(
      (document) =>
        document.kind === "subject" &&
        document.content.id === "csub_01KSC8562_SUCCESSOR",
    );
    if (!nodeTypeSuccessor)
      throw new Error("missing successor Subject fixture");
    nodeTypeSuccessor.content.kind = "node-type";
    nodeTypeSuccessor.content.canonicalKey = "node-type:sc8562-successor";
    nodeTypeSuccessor.content.selector = {
      kind: "node-type-name",
      value: "sc8562-successor",
      provenance: { source: "catalog-review" },
    };
    nodeTypeSuccessor.content.subtype = {};
    refreshDocumentAndReleaseDigests(semanticSubjectRelease, nodeTypeSuccessor);
    expect(validateBundle(wrongSemanticSubject)).toContain(
      "retirement-successor-kind-mismatch",
    );

    const wrongSemanticAlias = structuredClone(retiredBundle);
    const semanticAliasRelease = wrongSemanticAlias.releases[1];
    const retiredAlias = semanticAliasRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!retiredAlias) throw new Error("missing retired Alias fixture");
    addDocumentToRelease(semanticAliasRelease, {
      source: yamlSource(
        "schemas/dts/vendor/wiseeff/sc8562-node-successor.yaml",
      ),
      kind: "subject",
      normalizedDigest: sha256("0"),
      content: {
        id: "csub_01KSC8562_NODE_SUCCESSOR",
        kind: "node-type",
        canonicalKey: "node-type:sc8562-successor",
        lifecycle: "active",
        selector: {
          kind: "node-type-name",
          value: "sc8562-successor",
          provenance: { source: "catalog-review" },
        },
        subtype: {},
        tombstone: null,
      },
    });
    addDocumentToRelease(semanticAliasRelease, {
      source: yamlSource(
        "schemas/dts/vendor/wiseeff/sc8551-node-successor.yaml",
      ),
      kind: "alias",
      normalizedDigest: sha256("0"),
      content: {
        id: "cali_01KSC8551_NODE_SUCCESSOR",
        subjectId: "csub_01KSC8562_NODE_SUCCESSOR",
        selectorKind: "node-type-name",
        normalizedSelector: "sc8551-successor",
        lifecycle: "active",
        selectorProvenance: { source: "catalog-review" },
        tombstone: null,
      },
    });
    (retiredAlias.content.tombstone as JsonObject).successorId =
      "cali_01KSC8551_NODE_SUCCESSOR";
    refreshDocumentAndReleaseDigests(semanticAliasRelease, retiredAlias);
    expect(validateBundle(wrongSemanticAlias)).toContain(
      "retirement-successor-kind-mismatch",
    );
  });

  it("rejects retirement provenance for a Subject or Alias with no direct predecessor", () => {
    const newRetiredSubject = validBundle();
    const subjectRelease = newRetiredSubject.releases[1];
    addDocumentToRelease(subjectRelease, {
      source: yamlSource(
        "schemas/dts/vendor/wiseeff/never-published-subject.yaml",
      ),
      kind: "subject",
      normalizedDigest: sha256("0"),
      content: {
        id: "csub_01K_NEVER_PUBLISHED",
        kind: "driver",
        canonicalKey: "driver:never-published",
        lifecycle: "retired",
        selector: {
          kind: "driver-compatible",
          value: "wiseeff,never-published",
          provenance: { source: "catalog-review" },
        },
        subtype: {
          nature: "physical-device",
          cardinality: { kind: "multiple" },
        },
        tombstone: {
          reason: "forged first-publication withdrawal",
          withdrawnByReleaseId: "crel_02",
          previousSelector: "wiseeff,never-published",
        },
      },
    });
    expect(validateBundle(newRetiredSubject)).toContain(
      "retirement-predecessor-missing",
    );

    const newRetiredAlias = validBundle();
    const aliasRelease = newRetiredAlias.releases[1];
    addDocumentToRelease(aliasRelease, {
      source: yamlSource(
        "schemas/dts/vendor/wiseeff/never-published-alias.yaml",
      ),
      kind: "alias",
      normalizedDigest: sha256("0"),
      content: {
        id: "cali_01K_NEVER_PUBLISHED",
        subjectId: "csub_01KSC8562",
        selectorKind: "driver-compatible",
        normalizedSelector: "wiseeff,never-published-alias",
        lifecycle: "retired",
        selectorProvenance: { source: "catalog-review" },
        tombstone: {
          reason: "forged first-publication withdrawal",
          withdrawnByReleaseId: "crel_02",
          previousSelector: "wiseeff,never-published-alias",
        },
      },
    });
    expect(validateBundle(newRetiredAlias)).toContain(
      "retirement-predecessor-missing",
    );
  });

  it("protects permanent selector ownership and forbids Alias/canonical collisions", () => {
    const reassignedCanonicalSelector = validBundle();
    const selectorRelease = reassignedCanonicalSelector.releases[1];
    const originalSubject = selectorRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!originalSubject) throw new Error("missing subject fixture");
    const conflictingSubject = structuredClone(originalSubject);
    conflictingSubject.source = yamlSource(
      "schemas/dts/vendor/wiseeff/conflicting-selector.yaml",
    );
    conflictingSubject.content.id = "csub_conflicting_selector";
    conflictingSubject.content.canonicalKey = "driver:conflicting-selector";
    addDocumentToRelease(selectorRelease, conflictingSubject);
    expect(validateBundle(reassignedCanonicalSelector)).toContain(
      "canonical-selector-owner-conflict",
    );

    const aliasCollision = validBundle();
    const collisionRelease = aliasCollision.releases[1];
    const alias = collisionRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!alias) throw new Error("missing alias fixture");
    alias.content.normalizedSelector = "southchip,sc8562";
    alias.content.lifecycle = "retired";
    alias.content.tombstone = {
      reason: "withdrawn",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8551",
    };
    refreshDocumentAndReleaseDigests(collisionRelease, alias);
    expect(validateBundle(aliasCollision)).toContain(
      "alias-canonical-selector-collision",
    );

    const caseDistinct = validBundle();
    for (const release of caseDistinct.releases) {
      const caseDistinctAlias = release.documents.find(
        (document) => document.kind === "alias",
      );
      if (!caseDistinctAlias) throw new Error("missing alias fixture");
      caseDistinctAlias.content.normalizedSelector = "SOUTHCHIP,SC8562";
      refreshDocumentAndReleaseDigests(release, caseDistinctAlias);
    }
    const caseDistinctPredecessor =
      caseDistinct.releases[1].manifest.release.predecessor;
    if (!caseDistinctPredecessor) {
      throw new Error("missing case-distinct predecessor");
    }
    caseDistinctPredecessor.digest =
      caseDistinct.releases[0].manifest.release.digest;
    caseDistinct.releases[1].manifest.release.digest = releaseAggregateDigest(
      caseDistinct.releases[1],
    );
    expect(validateBundle(caseDistinct)).toEqual([]);
  });

  it("rejects an exact alias selector changing owners across lineage", () => {
    const bundle = validBundle();
    const release = bundle.releases[1];
    const originalSubject = release.documents.find(
      (document) => document.kind === "subject",
    );
    const alias = release.documents.find(
      (document) => document.kind === "alias",
    );
    if (!originalSubject || !alias) {
      throw new Error("missing alias ownership fixtures");
    }
    const conflictingOwner = structuredClone(originalSubject);
    conflictingOwner.source = yamlSource(
      "schemas/dts/vendor/wiseeff/conflicting-alias-owner.yaml",
    );
    conflictingOwner.content.id = "csub_conflicting_alias_owner";
    conflictingOwner.content.canonicalKey = "driver:conflicting-alias-owner";
    const selector = conflictingOwner.content.selector as JsonObject;
    selector.value = "wiseeff,conflicting-alias-owner";
    addDocumentToRelease(release, conflictingOwner);

    alias.content.subjectId = conflictingOwner.content.id;
    refreshDocumentAndReleaseDigests(release, alias);

    expect(validateBundle(bundle)).toContain("alias-selector-owner-conflict");
  });

  it("rejects Subject kind and canonical selector kind mismatches", () => {
    const invalidDriver = validBundle();
    const driverRelease = invalidDriver.releases[1];
    const driver = driverRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!driver) throw new Error("missing driver fixture");
    driver.content.selector = {
      kind: "node-type-name",
      value: "sc8562",
      provenance: { source: "catalog-review" },
    };
    refreshDocumentAndReleaseDigests(driverRelease, driver);
    expect(validateBundle(invalidDriver)).toEqual(["schema-invalid"]);

    const invalidNodeType = validBundle();
    const nodeTypeRelease = invalidNodeType.releases[1];
    const nodeType = nodeTypeRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!nodeType) throw new Error("missing NodeType fixture");
    nodeType.content.kind = "node-type";
    nodeType.content.canonicalKey = "node-type:sc8562";
    refreshDocumentAndReleaseDigests(nodeTypeRelease, nodeType);
    expect(validateBundle(invalidNodeType)).toEqual(["schema-invalid"]);
  });

  it("matches Alias and Definition selector kinds to their owning Subject kind", () => {
    const invalidDriverAlias = validBundle();
    const driverAliasRelease = invalidDriverAlias.releases[1];
    const driverAlias = driverAliasRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!driverAlias) throw new Error("missing alias fixture");
    driverAlias.content.selectorKind = "node-type-name";
    refreshDocumentAndReleaseDigests(driverAliasRelease, driverAlias);
    expect(validateBundle(invalidDriverAlias)).toContain(
      "owned-selector-kind-mismatch",
    );

    const invalidDriverDefinition = validBundle();
    const driverDefinitionRelease = invalidDriverDefinition.releases[1];
    const driverDefinition = driverDefinitionRelease.documents.find(
      (document) => document.kind === "definition",
    );
    if (!driverDefinition) throw new Error("missing definition fixture");
    const driverRevision = driverDefinition.content.revision as JsonObject;
    driverRevision.matching = {
      ...(driverRevision.matching as JsonObject),
      selectorKind: "node-type-name",
    };
    driverRevision.contentDigest =
      definitionRevisionContentDigest(driverDefinition);
    refreshDocumentAndReleaseDigests(driverDefinitionRelease, driverDefinition);
    expect(validateBundle(invalidDriverDefinition)).toContain(
      "owned-selector-kind-mismatch",
    );

    const nodeTypeBundle = validBundle();
    for (const release of nodeTypeBundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      const alias = release.documents.find(
        (document) => document.kind === "alias",
      );
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!subject || !alias || !definition) {
        throw new Error("missing NodeType ownership fixture");
      }
      subject.content.kind = "node-type";
      subject.content.canonicalKey = "node-type:sc8562";
      subject.content.selector = {
        kind: "node-type-name",
        value: "sc8562",
        provenance: { source: "catalog-review" },
      };
      subject.content.subtype = {};
      alias.content.selectorKind = "node-type-name";
      const revision = definition.content.revision as JsonObject;
      revision.matching = {
        ...(revision.matching as JsonObject),
        selectorKind: "node-type-name",
      };
      revision.contentDigest = definitionRevisionContentDigest(definition);
      refreshDocumentAndReleaseDigests(release, subject);
      refreshDocumentAndReleaseDigests(release, alias);
      refreshDocumentAndReleaseDigests(release, definition);
    }
    const nodeTypePredecessor =
      nodeTypeBundle.releases[1].manifest.release.predecessor;
    if (!nodeTypePredecessor) throw new Error("missing NodeType predecessor");
    nodeTypePredecessor.digest =
      nodeTypeBundle.releases[0].manifest.release.digest;
    nodeTypeBundle.releases[1].manifest.release.digest = releaseAggregateDigest(
      nodeTypeBundle.releases[1],
    );
    expect(validateBundle(nodeTypeBundle)).toEqual([]);

    for (const kind of ["alias", "definition"] as const) {
      const invalidNodeType = structuredClone(nodeTypeBundle);
      const release = invalidNodeType.releases[1];
      const document = release.documents.find(
        (candidate) => candidate.kind === kind,
      );
      if (!document) throw new Error(`missing ${kind} fixture`);
      if (kind === "alias") {
        document.content.selectorKind = "driver-compatible";
      } else {
        const revision = document.content.revision as JsonObject;
        revision.matching = {
          ...(revision.matching as JsonObject),
          selectorKind: "driver-compatible",
        };
        revision.contentDigest = definitionRevisionContentDigest(document);
      }
      refreshDocumentAndReleaseDigests(release, document);
      expect(validateBundle(invalidNodeType)).toContain(
        "owned-selector-kind-mismatch",
      );
    }
  });

  it("requires one kind-matched immutable Subject subtype snapshot", () => {
    const driverBundle = validBundle();
    for (const release of driverBundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      if (!subject) throw new Error("missing driver fixture");
      subject.content.subtype = {
        nature: "physical-device",
        cardinality: { kind: "multiple" },
      };
      refreshDocumentAndReleaseDigests(release, subject);
    }
    const driverPredecessor =
      driverBundle.releases[1].manifest.release.predecessor;
    if (!driverPredecessor) throw new Error("missing driver predecessor");
    driverPredecessor.digest = driverBundle.releases[0].manifest.release.digest;
    driverBundle.releases[1].manifest.release.digest = releaseAggregateDigest(
      driverBundle.releases[1],
    );
    expect(validateBundle(driverBundle)).toEqual([]);

    const missingSubtype = structuredClone(driverBundle);
    const missingSubject = missingSubtype.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!missingSubject) throw new Error("missing subject fixture");
    delete missingSubject.content.subtype;
    expect(validateBundle(missingSubtype)).toEqual(["schema-invalid"]);

    const nodeTypeBundle = structuredClone(driverBundle);
    for (const release of nodeTypeBundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      const alias = release.documents.find(
        (document) => document.kind === "alias",
      );
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!subject || !alias || !definition) {
        throw new Error("missing NodeType fixture");
      }
      subject.content.kind = "node-type";
      subject.content.canonicalKey = "node-type:sc8562";
      subject.content.selector = {
        kind: "node-type-name",
        value: "sc8562",
        provenance: { source: "catalog-review" },
      };
      subject.content.subtype = {};
      alias.content.selectorKind = "node-type-name";
      const revision = definition.content.revision as JsonObject;
      revision.matching = {
        ...(revision.matching as JsonObject),
        selectorKind: "node-type-name",
      };
      revision.contentDigest = definitionRevisionContentDigest(definition);
      refreshDocumentAndReleaseDigests(release, subject);
      refreshDocumentAndReleaseDigests(release, alias);
      refreshDocumentAndReleaseDigests(release, definition);
    }
    const nodeTypePredecessor =
      nodeTypeBundle.releases[1].manifest.release.predecessor;
    if (!nodeTypePredecessor) throw new Error("missing NodeType predecessor");
    nodeTypePredecessor.digest =
      nodeTypeBundle.releases[0].manifest.release.digest;
    nodeTypeBundle.releases[1].manifest.release.digest = releaseAggregateDigest(
      nodeTypeBundle.releases[1],
    );
    expect(validateBundle(nodeTypeBundle)).toEqual([]);

    for (const subtype of [
      { nature: "platform", cardinality: { kind: "multiple" } },
      { nature: "physical-device", cardinality: { kind: "per-rack" } },
      { family: "device" },
    ]) {
      const invalidDriverSubtype = structuredClone(driverBundle);
      const subject = invalidDriverSubtype.releases[1].documents.find(
        (document) => document.kind === "subject",
      );
      if (!subject) throw new Error("missing driver fixture");
      subject.content.subtype = subtype;
      expect(validateBundle(invalidDriverSubtype)).toEqual(["schema-invalid"]);
    }

    const invalidNodeTypeSubtype = structuredClone(nodeTypeBundle);
    const invalidNodeType = invalidNodeTypeSubtype.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!invalidNodeType) throw new Error("missing NodeType fixture");
    invalidNodeType.content.subtype = {
      nature: "logical-service",
      cardinality: { kind: "singleton-per-project" },
    };
    expect(validateBundle(invalidNodeTypeSubtype)).toEqual(["schema-invalid"]);

    const nodeTypeFamily = structuredClone(nodeTypeBundle);
    const familySubject = nodeTypeFamily.releases[1].documents.find(
      (document) => document.kind === "subject",
    );
    if (!familySubject) throw new Error("missing NodeType fixture");
    familySubject.content.subtype = { family: "device" };
    expect(validateBundle(nodeTypeFamily)).toEqual(["schema-invalid"]);

    const reassignedSubtype = structuredClone(driverBundle);
    const reassignedRelease = reassignedSubtype.releases[1];
    const reassignedSubject = reassignedRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!reassignedSubject) throw new Error("missing driver fixture");
    reassignedSubject.content.subtype = {
      nature: "logical-service",
      cardinality: { kind: "multiple" },
    };
    refreshDocumentAndReleaseDigests(reassignedRelease, reassignedSubject);
    expect(validateBundle(reassignedSubtype)).toContain(
      "subject-id-reassigned",
    );
  });

  it("accepts a complete logical-service singleton Driver lineage", () => {
    const bundle = validBundle();
    for (const release of bundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      if (!subject) throw new Error("missing Driver fixture");
      subject.content.subtype = {
        nature: "logical-service",
        cardinality: { kind: "singleton-per-project" },
      };
      refreshDocumentAndReleaseDigests(release, subject);
    }

    const predecessor = bundle.releases[1].manifest.release.predecessor;
    if (!predecessor) throw new Error("missing Driver predecessor");
    predecessor.digest = bundle.releases[0].manifest.release.digest;
    bundle.releases[1].manifest.release.digest = releaseAggregateDigest(
      bundle.releases[1],
    );

    expect(validateBundle(bundle)).toEqual([]);
    for (const release of bundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      expect(pointerValue(subject, "/content/subtype")).toEqual({
        nature: "logical-service",
        cardinality: { kind: "singleton-per-project" },
      });
    }
  });

  it("defines NodeType without a family field or replacement classification", () => {
    const nodeTypeBundle = validBundle();
    for (const release of nodeTypeBundle.releases) {
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      const alias = release.documents.find(
        (document) => document.kind === "alias",
      );
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!subject || !alias || !definition) {
        throw new Error("missing NodeType fixture");
      }
      subject.content.kind = "node-type";
      subject.content.canonicalKey = "node-type:sc8562";
      subject.content.selector = {
        kind: "node-type-name",
        value: "sc8562",
        provenance: { source: "catalog-review" },
      };
      subject.content.subtype = {};
      alias.content.selectorKind = "node-type-name";
      const revision = definition.content.revision as JsonObject;
      revision.matching = {
        ...(revision.matching as JsonObject),
        selectorKind: "node-type-name",
      };
      revision.contentDigest = definitionRevisionContentDigest(definition);
      refreshDocumentAndReleaseDigests(release, subject);
      refreshDocumentAndReleaseDigests(release, alias);
      refreshDocumentAndReleaseDigests(release, definition);
    }
    const predecessor = nodeTypeBundle.releases[1].manifest.release.predecessor;
    if (!predecessor) throw new Error("missing NodeType predecessor");
    predecessor.digest = nodeTypeBundle.releases[0].manifest.release.digest;
    nodeTypeBundle.releases[1].manifest.release.digest = releaseAggregateDigest(
      nodeTypeBundle.releases[1],
    );

    expect(validateBundle(nodeTypeBundle)).toEqual([]);
    expect(JSON.stringify(catalogReleaseSchema)).not.toContain('"family"');
    expect(JSON.stringify(stableIdRules)).not.toContain('"family"');
    expect(generatedSchemaBytes).not.toContain('"family"');
  });

  it("consumes the S0-ID compatible constructor and preserves accepted bytes", () => {
    for (const acceptedValue of [
      "vendor,driver",
      "simple",
      "vendor+tag,driver.rev/1",
    ]) {
      const accepted = validBundle();
      for (const release of accepted.releases) {
        const subject = release.documents.find(
          (document) => document.kind === "subject",
        );
        if (!subject) throw new Error("missing subject fixture");
        const selector = subject.content.selector as JsonObject;
        selector.value = acceptedValue;
        refreshDocumentAndReleaseDigests(release, subject);
      }
      const acceptedPredecessor =
        accepted.releases[1].manifest.release.predecessor;
      if (!acceptedPredecessor) throw new Error("missing release predecessor");
      acceptedPredecessor.digest = accepted.releases[0].manifest.release.digest;
      accepted.releases[1].manifest.release.digest = releaseAggregateDigest(
        accepted.releases[1],
      );

      expect(parseCanonicalCompatibleSelector(acceptedValue)).toEqual({
        ok: true,
        value: acceptedValue,
      });
      expect(validateBundle(accepted), acceptedValue).toEqual([]);
      const acceptedSubject = accepted.releases[1].documents.find(
        (document) => document.kind === "subject",
      );
      expect(pointerValue(acceptedSubject, "/content/selector/value")).toBe(
        acceptedValue,
      );
    }

    for (const [input, reason] of [
      [42, "not-string"],
      ["", "empty"],
      ["vendor,\0driver", "control-character"],
      ["v\u00e9ndor,driver", "non-ascii"],
      [" vendor,driver", "surrounding-whitespace"],
      ["vendor, driver", "whitespace-forbidden"],
      ['"vendor,driver"', "quoted-source-token"],
      ["vendor,*", "wildcard-forbidden"],
      ["vendor,driver,extra", "invalid-syntax"],
      [" vendor,*", "surrounding-whitespace"],
      ['"vendor,*"', "quoted-source-token"],
    ] as const) {
      const rejected = validBundle();
      const release = rejected.releases[1];
      const subject = release.documents.find(
        (document) => document.kind === "subject",
      );
      if (!subject) throw new Error("missing subject fixture");
      const selector = subject.content.selector as JsonObject;
      selector.value = input;
      refreshDocumentAndReleaseDigests(release, subject);

      expect(parseCanonicalCompatibleSelector(input)).toEqual({
        ok: false,
        error: reason,
      });
      expect(validateBundle(rejected), String(input)).toContain(
        `subject-selector-${reason}`,
      );
    }
  });

  it("consumes the S0-ID node-name constructor and preserves accepted bytes", () => {
    for (const input of ["/", "charging_core", "usb-controller"]) {
      const accepted = asNodeTypeBundle(input);
      expect(parseCanonicalNodeName(input)).toEqual({
        ok: true,
        value: input,
      });
      expect(validateBundle(accepted), input).toEqual([]);
      expect(
        pointerValue(
          accepted.releases[1].documents.find(
            (document) => document.kind === "subject",
          ),
          "/content/selector/value",
        ),
      ).toBe(input);
    }

    for (const [input, reason] of [
      ["node@1", "unit-address-present"],
      ["a".repeat(32), "length-out-of-range"],
      ["charging core", "whitespace-forbidden"],
      ["'node'", "quoted-source-token"],
      ["1node", "invalid-syntax"],
      [" node@1", "surrounding-whitespace"],
      ["'node@1'", "quoted-source-token"],
    ] as const) {
      const rejected = asNodeTypeBundle(input);
      expect(parseCanonicalNodeName(input)).toEqual({
        ok: false,
        error: reason,
      });
      expect(validateBundle(rejected), input).toContain(
        `subject-selector-${reason}`,
      );
    }
  });

  it("validates aliases with the same S0-ID constructors and exact bytes", () => {
    const compatibleAlias = validBundle();
    const compatibleAliasValue = "vendor+tag,legacy.rev/1";
    for (const release of compatibleAlias.releases) {
      const alias = release.documents.find(
        (document) => document.kind === "alias",
      );
      if (!alias) throw new Error("missing alias fixture");
      alias.content.normalizedSelector = compatibleAliasValue;
      refreshDocumentAndReleaseDigests(release, alias);
    }
    const predecessor =
      compatibleAlias.releases[1].manifest.release.predecessor;
    if (!predecessor) throw new Error("missing release predecessor");
    predecessor.digest = compatibleAlias.releases[0].manifest.release.digest;
    compatibleAlias.releases[1].manifest.release.digest =
      releaseAggregateDigest(compatibleAlias.releases[1]);

    expect(validateBundle(compatibleAlias)).toEqual([]);
    expect(
      pointerValue(
        compatibleAlias.releases[1].documents.find(
          (document) => document.kind === "alias",
        ),
        "/content/normalizedSelector",
      ),
    ).toBe(compatibleAliasValue);

    const invalidCompatibleAlias = validBundle();
    const compatibleRelease = invalidCompatibleAlias.releases[1];
    const invalidCompatible = compatibleRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!invalidCompatible) throw new Error("missing alias fixture");
    invalidCompatible.content.normalizedSelector = " vendor,legacy";
    refreshDocumentAndReleaseDigests(compatibleRelease, invalidCompatible);
    expect(validateBundle(invalidCompatibleAlias)).toContain(
      "alias-selector-surrounding-whitespace",
    );

    const invalidNodeAlias = asNodeTypeBundle("sc8562");
    const nodeRelease = invalidNodeAlias.releases[1];
    const invalidNode = nodeRelease.documents.find(
      (document) => document.kind === "alias",
    );
    if (!invalidNode) throw new Error("missing alias fixture");
    invalidNode.content.normalizedSelector = "node@1";
    refreshDocumentAndReleaseDigests(nodeRelease, invalidNode);
    expect(validateBundle(invalidNodeAlias)).toContain(
      "alias-selector-unit-address-present",
    );
  });

  it("consumes the S0-ID property-key constructor and preserves accepted bytes", () => {
    for (const input of ["iin_max", "init_para", "vendor,limit?"]) {
      const accepted = validBundle();
      for (const release of accepted.releases) {
        const definition = release.documents.find(
          (document) => document.kind === "definition",
        );
        if (!definition) throw new Error("missing definition fixture");
        definition.content.propertyKey = input;
        refreshDocumentAndReleaseDigests(release, definition);
      }
      const predecessor = accepted.releases[1].manifest.release.predecessor;
      if (!predecessor) throw new Error("missing release predecessor");
      predecessor.digest = accepted.releases[0].manifest.release.digest;
      accepted.releases[1].manifest.release.digest = releaseAggregateDigest(
        accepted.releases[1],
      );

      expect(parseCanonicalPropertyKey(input)).toEqual({
        ok: true,
        value: input,
      });
      expect(validateBundle(accepted), input).toEqual([]);
      expect(
        pointerValue(
          accepted.releases[1].documents.find(
            (document) => document.kind === "definition",
          ),
          "/content/propertyKey",
        ),
      ).toBe(input);
    }

    for (const [input, reason] of [
      ["a".repeat(32), "length-out-of-range"],
      ["#" + "a".repeat(31), "length-out-of-range"],
      ["compatible", "structural-property"],
      ["DEVICE_TYPE", "structural-property"],
      ["gpio-controller", "structural-property"],
      ["INTERRUPT-CONTROLLER", "structural-property"],
      ["linux,phandle", "structural-property"],
      ["PHANDLE", "structural-property"],
      ["ranges", "structural-property"],
      ["REG", "structural-property"],
      ["STATUS", "structural-property"],
      ["#address-cells", "structural-property"],
      ["#GPIO-CELLS", "structural-property"],
      ["#interrupt-cells", "structural-property"],
      ["#size-cells", "structural-property"],
      ["#custom", "structural-property"],
      ["#bad/property", "structural-property"],
      ["bad/property", "invalid-syntax"],
      ["bad\tkey", "control-character"],
      ["'STATUS'", "quoted-source-token"],
    ] as const) {
      const rejected = validBundle();
      const release = rejected.releases[1];
      const definition = release.documents.find(
        (document) => document.kind === "definition",
      );
      if (!definition) throw new Error("missing definition fixture");
      definition.content.propertyKey = input;
      refreshDocumentAndReleaseDigests(release, definition);

      expect(parseCanonicalPropertyKey(input)).toEqual({
        ok: false,
        error: reason,
      });
      expect(validateBundle(rejected), input).toContain(
        `definition-property-key-${reason}`,
      );
    }
  });

  it("rejects a successor that silently omits a predecessor Definition snapshot", () => {
    const omittedDefinition = validBundle();
    const successor = omittedDefinition.releases[1];
    successor.documents = successor.documents.filter(
      (document) => document.kind !== "definition",
    );
    successor.manifest.files = successor.manifest.files.filter(
      (file) => file.kind !== "definition",
    );
    successor.manifest.release.digest = releaseAggregateDigest(successor);

    expect(validateBundle(omittedDefinition)).toContain(
      "predecessor-definition-snapshot-complete",
    );
  });

  it("generates one byte-stable standalone consumer schema and pins its digest", () => {
    const expectedBytes = serializeContract(
      bundledConsumerSchema() as ContractJsonValue,
    );

    expect(generatedSchemaBytes).toBe(expectedBytes);
    expect(createHash("sha256").update(expectedBytes).digest("hex")).toBe(
      "4a1b82ed3ea4c158d242371755138c9fc580f3ccadc7f3d9a0f3a7186c950038",
    );

    const standaloneSchema = JSON.parse(generatedSchemaBytes) as JsonObject;
    const standaloneAjv = new Ajv2020({ allErrors: true, strict: true });
    const validateStandalone = standaloneAjv.compile(standaloneSchema);
    expect(
      validateStandalone(validBundle()),
      JSON.stringify(validateStandalone.errors),
    ).toBe(true);
  });
});
