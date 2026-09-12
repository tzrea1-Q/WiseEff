import { createHash } from "node:crypto";
import { stringify } from "yaml";

import {
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseNode,
} from "../../catalog-kernel/compiler/types";

export const TYPED_CHANGESET_SOURCE_PATH =
  "schemas/dts/catalog-release/typed-changeset.yaml";

export const sha256Digest = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const canonicalDigest = (value: ContractJsonValue): string =>
  sha256Digest(serializeContract(value));

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareBy = <Value>(
  left: Value,
  right: Value,
  key: (value: Value) => string,
): number => {
  const keyOrder = compare(key(left), key(right));
  return keyOrder !== 0
    ? keyOrder
    : compare(
        serializeContract(left as unknown as ContractJsonValue),
        serializeContract(right as unknown as ContractJsonValue),
      );
};

export const sortDocuments = <Document extends CatalogReleaseDocument>(
  documents: readonly Document[],
): Document[] =>
  [...documents].sort((left, right) =>
    compareBy(left, right, (document) => `${document.kind}\n${document.content.id}`),
  );

export const revisionContentModel = (
  revision: CatalogReleaseDefinitionDocument["content"]["revision"],
): ContractJsonValue => {
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
  if (revision.examples !== undefined) {
    model["/examples"] = revision.examples as ContractJsonValue;
  }
  return model;
};

const aggregateModel = (release: CatalogReleaseNode): ContractJsonValue =>
  ({
    "/manifest/schemaVersion": release.manifest.schemaVersion,
    "/manifest/release/id": release.manifest.release.id,
    "/manifest/release/version": release.manifest.release.version,
    "/manifest/release/sequence": release.manifest.release.sequence,
    "/manifest/release/publishedAt": release.manifest.release.publishedAt,
    "/manifest/release/predecessor": release.manifest.release.predecessor,
    "/manifest/toolchain": release.manifest.toolchain,
    "/manifest/files": [...release.manifest.files].sort((left, right) =>
      compareBy(left, right, (value) => value.path),
    ),
    "/manifest/documents": [...release.manifest.documents].sort((left, right) =>
      compareBy(left, right, (value) => `${value.kind}\n${value.documentId}`),
    ),
    "/sources": [...release.sources].sort((left, right) =>
      compareBy(left, right, (value) => value.path),
    ),
    "/documents": [...release.documents].sort((left, right) =>
      compareBy(left, right, (value) => `${value.kind}\n${value.content.id}`),
    ),
  }) as unknown as ContractJsonValue;

export const refreshSuccessorSource = (
  release: CatalogReleaseNode,
  sourcePath = TYPED_CHANGESET_SOURCE_PATH,
): CatalogReleaseNode => {
  const documents = sortDocuments(release.documents).map((document) => {
    if (document.kind !== "definition") {
      return {
        ...document,
        normalizedDigest: canonicalDigest(document.content as unknown as ContractJsonValue),
      };
    }
    const revision = {
      ...document.content.revision,
      contentDigest: canonicalDigest(revisionContentModel(document.content.revision)),
    };
    const content = { ...document.content, revision };
    return {
      ...document,
      content,
      normalizedDigest: canonicalDigest(content as unknown as ContractJsonValue),
    };
  });
  const yaml = stringify(
    {
      schemaVersion: "1.0.0",
      documents: documents.map((document) => ({
        kind: document.kind,
        content: document.content,
      })),
    },
    { lineWidth: 0, sortMapEntries: true },
  );
  const bytes = Buffer.from(yaml, "utf8");
  const digest = sha256Digest(bytes);
  const source = {
    path: sourcePath,
    mediaType: "application/yaml" as const,
    digest,
  };
  const withSource = documents.map((document) => ({
    ...document,
    source,
  }));
  return {
    ...release,
    documents: withSource,
    sources: [
      {
        path: sourcePath,
        mediaType: "application/yaml",
        encoding: "base64",
        bytes: bytes.toString("base64"),
      },
    ],
    manifest: {
      ...release.manifest,
      files: [{ path: sourcePath, mediaType: "application/yaml", digest }],
      documents: withSource.map((document) => ({
        sourcePath: source.path,
        kind: document.kind,
        documentId: document.content.id,
        normalizedDigest: document.normalizedDigest,
      })),
      release: {
        ...release.manifest.release,
        digest: canonicalDigest(aggregateModel({
          ...release,
          documents: withSource,
          sources: [
            {
              path: sourcePath,
              mediaType: "application/yaml",
              encoding: "base64",
              bytes: bytes.toString("base64"),
            },
          ],
          manifest: {
            ...release.manifest,
            files: [{ path: sourcePath, mediaType: "application/yaml", digest }],
            documents: withSource.map((document) => ({
              sourcePath: source.path,
              kind: document.kind,
              documentId: document.content.id,
              normalizedDigest: document.normalizedDigest,
            })),
          },
        })),
      },
    },
  };
};

export const encodeBundleBytes = (bundle: CatalogReleaseBundle): Uint8Array => {
  const canonical: CatalogReleaseBundle = {
    schemaVersion: bundle.schemaVersion,
    targetReleaseId: bundle.targetReleaseId,
    releases: [...bundle.releases].sort((left, right) =>
      compareBy(left, right, (release) =>
        `${release.manifest.release.sequence}\n${release.manifest.release.id}`,
      ),
    ),
  };
  return new TextEncoder().encode(
    serializeContract(canonical as unknown as ContractJsonValue),
  );
};

export const parseBundleBytes = (
  bytes: Uint8Array,
): { readonly ok: true; readonly bundle: CatalogReleaseBundle } | {
  readonly ok: false;
  readonly detail: string;
} => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("schemaVersion" in parsed) ||
      !("targetReleaseId" in parsed) ||
      !("releases" in parsed)
    ) {
      return { ok: false, detail: "catalog-release-bundle-unreadable" };
    }
    return { ok: true, bundle: parsed as CatalogReleaseBundle };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "catalog-release-bundle-unreadable",
    };
  }
};

export const targetReleaseOf = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseNode | undefined =>
  bundle.releases.find((release) => release.manifest.release.id === bundle.targetReleaseId);
