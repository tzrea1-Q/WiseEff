import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  catalogSubjectKinds,
  catalogSubjectSelectorKinds,
  definitionLifecycles,
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
    exactDocumentSet: boolean;
    matchPointers: string[];
    documentDigest: {
      algorithm: "sha256";
      canonicalization: "parameter-catalog-contract-serialize";
      contentPointer: string;
    };
    releaseAggregateDigest: {
      algorithm: "sha256";
      canonicalization: "parameter-catalog-contract-serialize";
      digestPointer: string;
      modelPointers: string[];
      sortedCollections: Array<{
        pointer: string;
        keyPointer: string;
      }>;
    };
  };
  definitionRevisionRules: {
    algorithm: "sha256";
    canonicalization: "parameter-catalog-contract-serialize";
    revisionPointer: string;
    digestPointer: string;
    contentPointers: string[];
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
  };
  identityRules: StableIdentityRule[];
  selectorRules: {
    canonicalSubjectIdPointer: string;
    canonicalKindPointer: string;
    canonicalValuePointer: string;
    aliasKindPointer: string;
    aliasValuePointer: string;
    requirePermanentCanonicalOwnership: boolean;
    forbidAliasCanonicalCollision: boolean;
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
  path: string;
  kind: "subject" | "alias" | "definition";
  digest: string;
  content: JsonObject;
}

interface ReleaseNode {
  manifest: {
    schemaVersion: string;
    release: {
      id: string;
      version: string;
      sequence: number;
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
      kind: BundleDocument["kind"];
      digest: string;
      mediaType: "application/json";
    }>;
  };
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

const catalogReleaseSchema = readJson<JsonObject>("./catalog-release.schema.json");
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

const stableKey = (value: unknown): string =>
  serializeContract(value as ContractJsonValue).trimEnd();

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
          String(pointerValue(left, sorting.keyPointer)).localeCompare(
            String(pointerValue(right, sorting.keyPointer)),
          ),
        ),
      ];
    }),
  );
};

const releaseAggregateDigest = (node: ReleaseNode): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(normalizedReleaseModel(node) as ContractJsonValue))
    .digest("hex")}`;

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

const definitionRevisionContentDigest = (
  document: BundleDocument,
): string =>
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
  const releases = pointerValue(bundle, lineage.releaseCollectionPointer) as ReleaseNode[];
  const targetReleaseId = pointerValue(bundle, lineage.targetReleasePointer);
  const releasesById = new Map<string, ReleaseNode>();
  const releaseVersions = new Map<string, string>();
  const releaseDigests = new Map<string, string>();

  for (const node of releases) {
    const releaseId = pointerValue(node, lineage.releaseIdPointer) as string;
    const releaseVersion = pointerValue(node, lineage.releaseVersionPointer) as string;
    const releaseDigest = pointerValue(node, lineage.releaseDigestPointer) as string;
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

    if (stableIdRules.manifestRules.exactDocumentSet) {
      const listed = new Map(
        node.manifest.files.map((file) => [file.path, file] as const),
      );
      const bundled = new Map(node.documents.map((document) => [document.path, document] as const));
      if (
        listed.size !== node.manifest.files.length ||
        bundled.size !== node.documents.length ||
        listed.size !== bundled.size
      ) {
        violations.push("manifest-content-exact");
      } else {
        for (const [path, file] of listed) {
          const document = bundled.get(path);
          if (
            document === undefined ||
            stableIdRules.manifestRules.matchPointers.some(
              (pointer) => pointerValue(file, pointer) !== pointerValue(document, pointer),
            )
          ) {
            violations.push("manifest-content-exact");
            break;
          }
        }
      }
    }

    const digestRule = stableIdRules.manifestRules.documentDigest;
    for (const document of node.documents) {
      const canonicalContent = serializeContract(
        pointerValue(document, digestRule.contentPointer) as ContractJsonValue,
      );
      const actualDigest = `sha256:${createHash("sha256")
        .update(canonicalContent)
        .digest("hex")}`;
      if (document.digest !== actualDigest) {
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
    }

    const aggregateRule = stableIdRules.manifestRules.releaseAggregateDigest;
    if (
      pointerValue(node, aggregateRule.digestPointer) !==
      releaseAggregateDigest(node)
    ) {
      violations.push("release-aggregate-digest-mismatch");
    }
  }

  if (typeof targetReleaseId !== "string" || !releasesById.has(targetReleaseId)) {
    violations.push("target-release-present");
  }

  if (lineage.requireAcyclic) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (releaseId: string): void => {
      if (visiting.has(releaseId)) {
        violations.push("release-lineage-acyclic");
        return;
      }
      if (visited.has(releaseId)) return;
      const node = releasesById.get(releaseId);
      if (node === undefined) return;
      visiting.add(releaseId);
      const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
      if (typeof predecessorId === "string") visit(predecessorId);
      visiting.delete(releaseId);
      visited.add(releaseId);
    };
    for (const releaseId of releasesById.keys()) visit(releaseId);
  }

  const targetAncestors = new Set<string>();
  let cursor = typeof targetReleaseId === "string" ? targetReleaseId : undefined;
  while (cursor !== undefined && !targetAncestors.has(cursor)) {
    targetAncestors.add(cursor);
    const node = releasesById.get(cursor);
    if (node === undefined) {
      violations.push("release-lineage-connected");
      break;
    }
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
      const sequence = pointerValue(node, lineage.releaseSequencePointer) as number;
      const predecessorSequence = pointerValue(
        predecessor,
        lineage.releaseSequencePointer,
      ) as number;
      if (predecessorSequence + 1 !== sequence) violations.push("release-sequence-gap");
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
          identityRule.naturalKeyPointers.map((pointer) => pointerValue(document, pointer)),
        );
        const immutableValue = stableKey(
          identityRule.immutableValuePointers.map((pointer) => pointerValue(document, pointer)),
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
          violations.push(`${identityRule.documentKind}-natural-key-reassigned`);
        }
        idToBinding.set(id, binding);
        bindingToId.set(naturalKey, id);
      }
    }
  }

  const selectorRules = stableIdRules.selectorRules;
  const canonicalSelectorOwners = new Map<string, string>();
  const aliasSelectors = new Set<string>();
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
      aliasSelectors.add(
        stableKey([
          pointerValue(alias, selectorRules.aliasKindPointer),
          pointerValue(alias, selectorRules.aliasValuePointer),
        ]),
      );
    }
  }
  if (
    selectorRules.forbidAliasCanonicalCollision &&
    [...aliasSelectors].some((selector) => canonicalSelectorOwners.has(selector))
  ) {
    violations.push("alias-canonical-selector-collision");
  }

  for (const node of releases) {
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

    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    if (typeof predecessorId !== "string") continue;
    const predecessor = releasesById.get(predecessorId);
    if (predecessor === undefined) continue;
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

const validateBundle = (bundle: CatalogReleaseBundle): string[] => {
  if (!validateSchema(bundle)) return ["schema-invalid"];
  return validateStableRules(bundle);
};

const sha256 = (marker: string): string => `sha256:${marker.repeat(64)}`;

const releaseDocuments = (): BundleDocument[] => {
  const documents: BundleDocument[] = [
    {
      path: "subjects/sc8562.json",
      kind: "subject",
      digest: sha256("1"),
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
      path: "aliases/sc8551.json",
      kind: "alias",
      digest: sha256("2"),
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
      path: "definitions/sc8562/input-voltage-limit.json",
      kind: "definition",
      digest: sha256("3"),
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
          matching: { sourceProperty: "input-voltage-limit" },
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
    digest: `sha256:${createHash("sha256")
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
        digest: sha256("0"),
        predecessor,
      },
      toolchain: {
        compiler: "wiseeff-catalog-compiler@1",
        jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
        sourceFormat: "wiseeff-catalog-release@1",
      },
      files: documents.map(({ path, kind, digest }) => ({
        path,
        kind,
        digest,
        mediaType: "application/json",
      })),
    },
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
  document.digest = `sha256:${createHash("sha256")
    .update(serializeContract(document.content as ContractJsonValue))
    .digest("hex")}`;
  const manifestFile = release.manifest.files.find(
    (file) => file.path === document.path,
  );
  if (!manifestFile) throw new Error(`missing manifest file ${document.path}`);
  manifestFile.digest = document.digest;
  release.manifest.release.digest = releaseAggregateDigest(release);
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
  it("accepts a closed, complete bundle through the public schema and stable-rule seam", () => {
    const bundle = validBundle();

    expect(validateBundle(bundle), JSON.stringify(validateSchema.errors)).toEqual([]);
    expect(stableIdRules.closedEnums).toEqual({
      catalogSubjectKinds: [...catalogSubjectKinds],
      catalogSubjectSelectorKinds: [...catalogSubjectSelectorKinds],
      driverNatures: ["physical-device", "logical-service"],
      driverInstanceCardinalities: ["multiple", "singleton-per-project"],
      definitionLifecycles: [...definitionLifecycles],
      subjectLifecycles: [...subjectLifecycles],
    });
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
      "subjects//sc8562.json",
      "subjects/sc8562.json/",
      "subjects/./sc8562.json",
      "./subjects/sc8562.json",
      "subjects/../sc8562.json",
    ]) {
      const malformed = validBundle();
      const release = malformed.releases[1];
      release.documents[0].path = path;
      release.manifest.files[0].path = path;
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
      path: "subjects/unlisted.json",
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
    const rewrittenRevision = rewrittenDefinition.content.revision as JsonObject;
    rewrittenRevision.documentation = "Changed under the same revision identity.";
    rewrittenRevision.contentDigest = definitionRevisionContentDigest(
      rewrittenDefinition,
    );
    refreshDocumentAndReleaseDigests(rewrittenRelease, rewrittenDefinition);
    expect(validateBundle(rewritten)).toContain("definition-id-reassigned");
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
    subject.digest = `sha256:${createHash("sha256")
      .update(serializeContract(subject.content as ContractJsonValue))
      .digest("hex")}`;
    release.manifest.files[0].digest = subject.digest;
    expect(validateBundle(changedProvenance)).toContain(
      "release-aggregate-digest-mismatch",
    );
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
      duplicate.path = `duplicates/${kind}.json`;
      release.documents.push(duplicate);
      release.manifest.files.push({
        path: duplicate.path,
        kind: duplicate.kind,
        digest: duplicate.digest,
        mediaType: "application/json",
      });
      release.manifest.release.digest = releaseAggregateDigest(release);

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
    expect(validateBundle(missingPredecessor)).toContain("release-lineage-connected");
  });

  it("requires complete predecessor subject/alias membership and valid alias owners", () => {
    const omittedSubject = validBundle();
    const predecessorOnlySubject = structuredClone(
      omittedSubject.releases[0].documents[0],
    );
    predecessorOnlySubject.path = "subjects/predecessor-only.json";
    predecessorOnlySubject.digest = sha256("5");
    predecessorOnlySubject.content.id = "csub_predecessor_only";
    predecessorOnlySubject.content.canonicalKey = "driver:predecessor-only";
    predecessorOnlySubject.content.selector = {
      kind: "driver-compatible",
      value: "wiseeff,predecessor-only",
      provenance: { source: "catalog-review" },
    };
    omittedSubject.releases[0].documents.push(predecessorOnlySubject);
    omittedSubject.releases[0].manifest.files.push({
      path: predecessorOnlySubject.path,
      kind: predecessorOnlySubject.kind,
      digest: predecessorOnlySubject.digest,
      mediaType: "application/json",
    });
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

  it("protects permanent selector ownership and forbids Alias/canonical collisions", () => {
    const reassignedCanonicalSelector = validBundle();
    const selectorRelease = reassignedCanonicalSelector.releases[1];
    const originalSubject = selectorRelease.documents.find(
      (document) => document.kind === "subject",
    );
    if (!originalSubject) throw new Error("missing subject fixture");
    const conflictingSubject = structuredClone(originalSubject);
    conflictingSubject.path = "subjects/conflicting-selector.json";
    conflictingSubject.content.id = "csub_conflicting_selector";
    conflictingSubject.content.canonicalKey = "driver:conflicting-selector";
    conflictingSubject.digest = `sha256:${createHash("sha256")
      .update(serializeContract(conflictingSubject.content as ContractJsonValue))
      .digest("hex")}`;
    selectorRelease.documents.push(conflictingSubject);
    selectorRelease.manifest.files.push({
      path: conflictingSubject.path,
      kind: conflictingSubject.kind,
      digest: conflictingSubject.digest,
      mediaType: "application/json",
    });
    selectorRelease.manifest.release.digest = releaseAggregateDigest(selectorRelease);
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
    const driverPredecessor = driverBundle.releases[1].manifest.release.predecessor;
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
      if (!subject) throw new Error("missing NodeType fixture");
      subject.content.kind = "node-type";
      subject.content.canonicalKey = "node-type:sc8562";
      subject.content.selector = {
        kind: "node-type-name",
        value: "sc8562",
        provenance: { source: "catalog-review" },
      };
      subject.content.subtype = { family: "device" };
      refreshDocumentAndReleaseDigests(release, subject);
    }
    const nodeTypePredecessor = nodeTypeBundle.releases[1].manifest.release.predecessor;
    if (!nodeTypePredecessor) throw new Error("missing NodeType predecessor");
    nodeTypePredecessor.digest = nodeTypeBundle.releases[0].manifest.release.digest;
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
    expect(validateBundle(reassignedSubtype)).toContain("subject-id-reassigned");
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
      "fa191b6e92e1f2dbbafad87a1d1c93bc048463ad0ad914a447d5da1fe2df5a9f",
    );

    const standaloneSchema = JSON.parse(generatedSchemaBytes) as JsonObject;
    const standaloneAjv = new Ajv2020({ allErrors: true, strict: true });
    const validateStandalone = standaloneAjv.compile(standaloneSchema);
    expect(validateStandalone(validBundle()), JSON.stringify(validateStandalone.errors)).toBe(
      true,
    );
  });
});
