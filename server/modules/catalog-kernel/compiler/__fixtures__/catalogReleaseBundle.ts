import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  serializeContract,
  type ContractJsonValue,
} from "../../../parameter-catalog-contract/index";

import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseNode,
} from "../types";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const mutable = <Value>(value: Value): DeepMutable<Value> =>
  value as DeepMutable<Value>;

const sha256 = (bytes: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const canonicalDigest = (value: ContractJsonValue): string =>
  sha256(serializeContract(value));

const sourceBytes = Buffer.from(
  [
    "$schema: https://devicetree.org/meta-schemas/core.yaml#",
    "$id: https://wiseeff.dev/catalog-test/acme-power.yaml",
    "title: ACME power driver",
    "type: object",
    "additionalProperties: true",
    "",
  ].join("\n"),
  "utf8",
);

const source = Object.freeze({
  path: "schemas/dts/vendor/acme-power.yaml",
  mediaType: "application/yaml" as const,
  digest: sha256(sourceBytes),
});

const sourceInventory = Object.freeze({
  path: source.path,
  mediaType: source.mediaType,
  encoding: "base64" as const,
  bytes: sourceBytes.toString("base64"),
});

const revisionContent = {
  lifecycle: "active",
  displayName: "Input current limit",
  documentation: "Maximum accepted input current.",
  unit: "mA",
  valueSchema: { type: "integer", minimum: 0 },
  matching: {
    sourceProperty: "iin_max",
    selectorKind: "driver-compatible",
  },
} as const;

const revisionDigestModel = {
  "/lifecycle": revisionContent.lifecycle,
  "/displayName": revisionContent.displayName,
  "/documentation": revisionContent.documentation,
  "/unit": revisionContent.unit,
  "/valueSchema": revisionContent.valueSchema,
  "/matching": revisionContent.matching,
} as const;

const revisionModel = (
  document: Extract<CatalogReleaseDocument, { kind: "definition" }>,
): ContractJsonValue => {
  const { revision } = document.content;
  const model: Record<string, ContractJsonValue> = {
    "/lifecycle": revision.lifecycle,
    "/displayName": revision.displayName,
    "/documentation": revision.documentation,
    "/valueSchema": revision.valueSchema,
    "/matching": revision.matching,
  };
  if (revision.successorDefinitionId !== undefined) {
    model["/successorDefinitionId"] = revision.successorDefinitionId;
  }
  if (revision.unit !== undefined) model["/unit"] = revision.unit;
  if (revision.examples !== undefined) model["/examples"] = revision.examples;
  return model;
};

const documents = (): CatalogReleaseDocument[] => {
  const subjectContent = {
    id: "csub_acme_power",
    kind: "driver",
    canonicalKey: "driver:acme,power",
    lifecycle: "active",
    selector: {
      kind: "driver-compatible",
      value: "acme,power",
      provenance: { source: source.path, sourceDigest: source.digest },
    },
    subtype: {
      nature: "physical-device",
      cardinality: { kind: "multiple" },
    },
    tombstone: null,
  } as const;
  const aliasContent = {
    id: "cali_acme_power_v1",
    subjectId: subjectContent.id,
    selectorKind: "driver-compatible",
    normalizedSelector: "acme,power-v1",
    lifecycle: "active",
    selectorProvenance: { source: "catalog-review" },
    tombstone: null,
  } as const;
  const definitionContent = {
    id: "pdef_acme_power_iin_max",
    subjectId: subjectContent.id,
    propertyKey: "iin_max",
    revision: {
      id: "drev_acme_power_iin_max_1",
      number: 1,
      contentDigest: canonicalDigest(revisionDigestModel),
      ...revisionContent,
    },
  } as const;

  return [
    {
      source,
      kind: "subject",
      normalizedDigest: canonicalDigest(subjectContent),
      content: subjectContent,
    },
    {
      source,
      kind: "alias",
      normalizedDigest: canonicalDigest(aliasContent),
      content: aliasContent,
    },
    {
      source,
      kind: "definition",
      normalizedDigest: canonicalDigest(definitionContent),
      content: definitionContent,
    },
  ];
};

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const aggregateModel = (release: CatalogReleaseNode): ContractJsonValue => ({
  "/manifest/schemaVersion": release.manifest.schemaVersion,
  "/manifest/release/id": release.manifest.release.id,
  "/manifest/release/version": release.manifest.release.version,
  "/manifest/release/sequence": release.manifest.release.sequence,
  "/manifest/release/publishedAt": release.manifest.release.publishedAt,
  "/manifest/release/predecessor": release.manifest.release.predecessor,
  "/manifest/toolchain": release.manifest.toolchain,
  "/manifest/files": [...release.manifest.files].sort((left, right) =>
    compare(left.path, right.path),
  ),
  "/manifest/documents": [...release.manifest.documents].sort((left, right) =>
    compare(`${left.kind}\n${left.documentId}`, `${right.kind}\n${right.documentId}`),
  ),
  "/sources": [...release.sources].sort((left, right) =>
    compare(left.path, right.path),
  ),
  "/documents": [...release.documents].sort((left, right) =>
    compare(
      `${left.kind}\n${left.content.id}`,
      `${right.kind}\n${right.content.id}`,
    ),
  ),
}) as unknown as ContractJsonValue;

export const refreshReleaseAggregateDigest = (
  release: CatalogReleaseNode,
): void => {
  release.manifest.release.digest = canonicalDigest(aggregateModel(release));
};

const refreshDocumentAndReleaseDigests = (
  release: DeepMutable<CatalogReleaseNode>,
  document: DeepMutable<CatalogReleaseDocument>,
  previousDocumentId: string = document.content.id,
): void => {
  if (document.kind === "definition") {
    document.content.revision.contentDigest = canonicalDigest(
      revisionModel(document as CatalogReleaseDefinitionDocument),
    );
  }
  document.normalizedDigest = canonicalDigest(
    document.content as unknown as ContractJsonValue,
  );
  const descriptor = release.manifest.documents.find(
    (candidate) =>
      candidate.kind === document.kind &&
      candidate.documentId === previousDocumentId,
  );
  if (!descriptor) throw new Error("fixture document descriptor missing");
  descriptor.documentId = document.content.id;
  descriptor.normalizedDigest = document.normalizedDigest;
  refreshReleaseAggregateDigest(release);
};

const targetRelease = (
  bundle: CatalogReleaseBundle,
): DeepMutable<CatalogReleaseNode> => {
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("fixture target release missing");
  return target;
};

const releaseNode = (
  id: string,
  version: string,
  sequence: number,
  publishedAt: string,
  predecessor: CatalogReleaseNode["manifest"]["release"]["predecessor"],
): CatalogReleaseNode => {
  const releaseDocuments = documents();
  const release: CatalogReleaseNode = {
    manifest: {
      schemaVersion: "1.0.0",
      release: {
        id,
        version,
        sequence,
        publishedAt,
        digest: `sha256:${"0".repeat(64)}`,
        predecessor,
      },
      toolchain: {
        compiler: "wiseeff-catalog-compiler@1",
        jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
        sourceFormat: "wiseeff-catalog-release@1",
      },
      files: [{ path: source.path, mediaType: source.mediaType, digest: source.digest }],
      documents: releaseDocuments.map((document) => ({
        sourcePath: document.source.path,
        kind: document.kind,
        documentId: document.content.id,
        normalizedDigest: document.normalizedDigest,
      })),
    },
    sources: [sourceInventory],
    documents: releaseDocuments,
  };
  refreshReleaseAggregateDigest(release);
  return release;
};

export const validCatalogReleaseBundle = (): CatalogReleaseBundle => {
  const first = releaseNode(
    "crel_acme_1",
    "1.0.0",
    1,
    "2026-09-01T00:00:00Z",
    null,
  );
  const second = releaseNode(
    "crel_acme_2",
    "1.1.0",
    2,
    "2026-09-02T00:00:00Z",
    { id: first.manifest.release.id, digest: first.manifest.release.digest },
  );
  return {
    schemaVersion: "1.0.0",
    targetReleaseId: second.manifest.release.id,
    releases: [first, second],
  };
};

export const reorderCatalogReleaseBundle = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseBundle => ({
  ...structuredClone(bundle),
  releases: [...structuredClone(bundle.releases)]
    .reverse()
    .map((release) => ({
      ...release,
      manifest: {
        ...release.manifest,
        files: [...release.manifest.files].reverse(),
        documents: [...release.manifest.documents].reverse(),
      },
      sources: [...release.sources].reverse(),
      documents: [...release.documents].reverse(),
    })),
});

export const duplicateDefinitionIdentityBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("fixture target release missing");
  const definition = target.documents.find(
    (document) => document.kind === "definition",
  );
  if (!definition) throw new Error("fixture Definition missing");

  const duplicate = structuredClone(definition);
  target.documents.push(duplicate);
  target.manifest.documents.push({
    sourcePath: duplicate.source.path,
    kind: duplicate.kind,
    documentId: duplicate.content.id,
    normalizedDigest: duplicate.normalizedDigest,
  });
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const lineageGapBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("fixture target release missing");
  target.manifest.release.sequence += 1;
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const missingSourceEntryBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  return {
    ...bundle,
    releases: bundle.releases.map((release) =>
      release.manifest.release.id === bundle.targetReleaseId
        ? { ...release, sources: [] }
        : release,
    ),
  };
};

export const unlistedSourceEntryBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const bytes = Buffer.from("title: unlisted\n", "utf8");
  return {
    ...bundle,
    releases: bundle.releases.map((release) =>
      release.manifest.release.id === bundle.targetReleaseId
        ? {
            ...release,
            sources: [
              ...release.sources,
              {
                path: "schemas/dts/vendor/unlisted.yaml",
                mediaType: "application/yaml",
                encoding: "base64",
                bytes: bytes.toString("base64"),
              },
            ],
          }
        : release,
    ),
  };
};

export const staleSourceDigestBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  return {
    ...bundle,
    releases: bundle.releases.map((release) =>
      release.manifest.release.id === bundle.targetReleaseId
        ? {
            ...release,
            sources: release.sources.map((entry) => ({
              ...entry,
              bytes: Buffer.from("title: tampered\n", "utf8").toString(
                "base64",
              ),
            })),
          }
        : release,
    ),
  };
};

export const staleNormalizedContentBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  const definition = target?.documents.find(
    (document) => document.kind === "definition",
  );
  if (!target || !definition || definition.kind !== "definition") {
    throw new Error("fixture target Definition missing");
  }
  definition.content.revision.documentation = "Tampered documentation.";
  return bundle;
};

export const staleAggregateDigestBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("fixture target release missing");
  target.manifest.toolchain.compiler = "wiseeff-catalog-compiler@tampered";
  return bundle;
};

export const invalidCanonicalPropertyBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = mutable(bundle).releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  const definition = target?.documents.find(
    (document) => document.kind === "definition",
  );
  if (!target || !definition || definition.kind !== "definition") {
    throw new Error("fixture target Definition missing");
  }
  definition.content.propertyKey = "STATUS";
  definition.normalizedDigest = canonicalDigest(
    definition.content as unknown as ContractJsonValue,
  );
  const descriptor = target.manifest.documents.find(
    (candidate) => candidate.kind === "definition",
  );
  if (!descriptor) throw new Error("fixture Definition descriptor missing");
  descriptor.normalizedDigest = definition.normalizedDigest;
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const malformedYamlSourceBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("fixture target release missing");
  const bytes = Buffer.from("unterminated: [\n", "utf8");
  const digest = sha256(bytes);
  const updatedTarget = mutable<CatalogReleaseNode>({
    ...target,
    manifest: {
      ...target.manifest,
      release: { ...target.manifest.release },
      files: target.manifest.files.map((file) => ({ ...file, digest })),
      documents: target.manifest.documents.map((document) => ({ ...document })),
    },
    sources: target.sources.map((sourceEntry) => ({
      ...sourceEntry,
      bytes: bytes.toString("base64"),
    })),
    documents: target.documents.map((document) => ({
      ...structuredClone(document),
      source: { ...document.source, digest },
    })),
  });
  refreshReleaseAggregateDigest(updatedTarget);
  return {
    ...bundle,
    releases: bundle.releases.map((release) =>
      release.manifest.release.id === bundle.targetReleaseId
        ? updatedTarget
        : release,
    ),
  };
};

export const reassignedSubjectIdentityBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  const subject = target.documents.find((document) => document.kind === "subject");
  if (!subject || subject.kind !== "subject") throw new Error("fixture Subject missing");
  subject.content.canonicalKey = "driver:acme,power-renamed";
  refreshDocumentAndReleaseDigests(target, subject);
  return bundle;
};

export const omittedPredecessorAliasBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  target.documents = target.documents.filter((document) => document.kind !== "alias");
  target.manifest.documents = target.manifest.documents.filter(
    (document) => document.kind !== "alias",
  );
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const aliasCanonicalCollisionBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  const alias = target.documents.find((document) => document.kind === "alias");
  if (!alias || alias.kind !== "alias") throw new Error("fixture Alias missing");
  alias.content.normalizedSelector = "acme,power";
  refreshDocumentAndReleaseDigests(target, alias);
  return bundle;
};

export const lifecycleTombstoneMismatchBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  const subject = target.documents.find((document) => document.kind === "subject");
  if (!subject || subject.kind !== "subject") throw new Error("fixture Subject missing");
  subject.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: target.manifest.release.id,
    previousSelector: subject.content.selector.value,
  };
  refreshDocumentAndReleaseDigests(target, subject);
  return bundle;
};

export const revisionSequenceGapBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  const definition = target.documents.find(
    (document) => document.kind === "definition",
  );
  if (!definition || definition.kind !== "definition") {
    throw new Error("fixture Definition missing");
  }
  definition.content.revision.id = "drev_acme_power_iin_max_3";
  definition.content.revision.number = 3;
  definition.content.revision.documentation = "Changed in a gapped revision.";
  refreshDocumentAndReleaseDigests(target, definition);
  return bundle;
};

export const manifestDocumentMissingBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  target.documents = target.documents.filter(
    (document) => document.kind !== "alias",
  );
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const manifestDocumentUnlistedBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  target.manifest.documents = target.manifest.documents.filter(
    (document) => document.kind !== "alias",
  );
  refreshReleaseAggregateDigest(target);
  return bundle;
};

export const invalidPublicationTimeBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  target.manifest.release.publishedAt = "2026-02-31T00:00:00Z";
  refreshReleaseAggregateDigest(target);
  return bundle;
};

const mutateTargetDefinition = (
  bundle: CatalogReleaseBundle,
  mutateDefinition: (
    definition: DeepMutable<CatalogReleaseDefinitionDocument>,
  ) => void,
): CatalogReleaseBundle => {
  const target = targetRelease(bundle);
  const definition = target.documents.find(
    (document) => document.kind === "definition",
  );
  if (!definition || definition.kind !== "definition") {
    throw new Error("fixture Definition missing");
  }
  mutateDefinition(definition);
  refreshDocumentAndReleaseDigests(target, definition);
  return bundle;
};

export const forbiddenValueSchemaReferenceBundle = (): CatalogReleaseBundle =>
  mutateTargetDefinition(validCatalogReleaseBundle(), (definition) => {
    definition.content.revision.id = "drev_acme_power_iin_max_2";
    definition.content.revision.number = 2;
    definition.content.revision.valueSchema = {
      $ref: "https://example.invalid/schema.json",
    };
  });

export const invalidValueSchemaBundle = (): CatalogReleaseBundle =>
  mutateTargetDefinition(validCatalogReleaseBundle(), (definition) => {
    definition.content.revision.id = "drev_acme_power_iin_max_2";
    definition.content.revision.number = 2;
    definition.content.revision.valueSchema = {
      type: "invented-json-schema-type",
    };
  });

export const danglingDefinitionSuccessorBundle = (): CatalogReleaseBundle =>
  mutateTargetDefinition(validCatalogReleaseBundle(), (definition) => {
    definition.content.revision.id = "drev_acme_power_iin_max_2";
    definition.content.revision.number = 2;
    definition.content.revision.lifecycle = "deprecated";
    definition.content.revision.successorDefinitionId = "pdef_missing";
  });

export const invalidRetirementProvenanceBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = targetRelease(bundle);
  const subject = target.documents.find(
    (document) => document.kind === "subject",
  );
  if (!subject || subject.kind !== "subject") {
    throw new Error("fixture Subject missing");
  }
  subject.content.lifecycle = "retired";
  subject.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: target.manifest.release.id,
    previousSelector: "acme,not-the-predecessor-selector",
  };
  refreshDocumentAndReleaseDigests(target, subject);
  const alias = target.documents.find((document) => document.kind === "alias");
  if (!alias || alias.kind !== "alias") {
    throw new Error("fixture Alias missing");
  }
  alias.content.lifecycle = "retired";
  alias.content.tombstone = {
    reason: "withdrawn with owner",
    withdrawnByReleaseId: target.manifest.release.id,
    previousSelector: alias.content.normalizedSelector,
  };
  refreshDocumentAndReleaseDigests(target, alias);
  return bundle;
};
