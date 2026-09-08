import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { refreshReleaseAggregateDigest, validCatalogReleaseBundle } from "../../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle, CatalogReleaseDefinitionDocument } from "../../../catalog-kernel/compiler/types";
import { serializeContract, type ContractJsonValue } from "../../../parameter-catalog-contract/index";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const mutable = <Value>(value: Value): DeepMutable<Value> => value as DeepMutable<Value>;

export const syntheticTarget = {
  subjectId: "csub_acme_power",
  aliasId: "cali_acme_power_v1",
  definitions: {
    iin_max: { id: "pdef_acme_power_iin_max", revisionId: "drev_acme_power_iin_max_1" },
    enabled: { id: "pdef_acme_power_enabled", revisionId: "drev_acme_power_enabled_1" },
  },
} as const;

export const syntheticIinArrayValueSchema = {
  type: "array",
  items: { type: "integer", minimum: 0 },
} as const;

export type SyntheticProperty = keyof typeof syntheticTarget.definitions;

const syntheticDigest = (value: ContractJsonValue): string =>
  `sha256:${createHash("sha256").update(serializeContract(value)).digest("hex")}`;

const syntheticBytesDigest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const syntheticRevisionModel = (
  document: Extract<CatalogReleaseDefinitionDocument, { kind: "definition" }>,
): ContractJsonValue => {
  const { revision } = document.content;
  const model: Record<string, ContractJsonValue> = {
    "/lifecycle": revision.lifecycle,
    "/displayName": revision.displayName,
    "/documentation": revision.documentation,
    "/valueSchema": revision.valueSchema,
    "/matching": revision.matching,
  };
  if (revision.successorDefinitionId !== undefined) model["/successorDefinitionId"] = revision.successorDefinitionId;
  if (revision.unit !== undefined) model["/unit"] = revision.unit;
  if (revision.examples !== undefined) model["/examples"] = revision.examples;
  return model;
};

const syntheticDefinition = (
  source: CatalogReleaseDefinitionDocument["source"],
  subjectId: string,
  propertyKey: "enabled",
): CatalogReleaseDefinitionDocument => {
  const content = {
    id: syntheticTarget.definitions.enabled.id,
    subjectId,
    propertyKey,
    revision: {
      id: syntheticTarget.definitions.enabled.revisionId,
      number: 1,
      contentDigest: "",
      lifecycle: "active" as const,
      displayName: "Enabled",
      documentation: "Whether the parameter is enabled.",
      valueSchema: { type: "boolean" },
      matching: { sourceProperty: propertyKey, selectorKind: "driver-compatible" as const },
    },
  } as unknown as CatalogReleaseDefinitionDocument["content"];
  content.revision.contentDigest = syntheticDigest(syntheticRevisionModel({
    source,
    kind: "definition",
    normalizedDigest: "",
    content,
  }));
  return {
    source,
    kind: "definition",
    normalizedDigest: syntheticDigest(content as unknown as ContractJsonValue),
    content,
  };
};

const refreshSyntheticRelease = (release: DeepMutable<CatalogReleaseBundle["releases"][number]>): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      document.content.revision.contentDigest = syntheticDigest(syntheticRevisionModel(document));
    }
    document.normalizedDigest = syntheticDigest(document.content as unknown as ContractJsonValue);
  }
  const sourcePath = release.documents[0]!.source.path;
  const mediaType = release.documents[0]!.source.mediaType;
  const bytes = Buffer.from(stringify({
    schemaVersion: "1.0.0",
    documents: release.documents.map((document) => ({ kind: document.kind, content: document.content })),
  }, { lineWidth: 0 }), "utf8");
  const digest = syntheticBytesDigest(bytes);
  const source = { path: sourcePath, mediaType, digest } as const;
  release.sources = [{ path: sourcePath, mediaType, encoding: "base64", bytes: bytes.toString("base64") }];
  release.manifest.files = [{ path: sourcePath, mediaType, digest }];
  for (const document of release.documents) document.source = source;
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

/**
 * Test-only reviewed release authoring. This is a first-install synthetic
 * artifact: only the first fixture release is selected, then authored with
 * the array shape before compilation. The unused multi-release fixture is
 * never rewritten or included in this artifact.
 */
export const reviewedSyntheticBundle = (): CatalogReleaseBundle => {
  const full = mutable(structuredClone(validCatalogReleaseBundle()));
  const target = full.releases[0];
  if (!target) throw new Error("comparison-multihead-reviewed-bundle-target-missing");
  const subject = target.documents.find((document) => document.kind === "subject");
  const definition = target.documents.find((document) => document.kind === "definition"
    && document.content.id === syntheticTarget.definitions.iin_max.id);
  if (!subject || subject.kind !== "subject" || !definition || definition.kind !== "definition"
    || definition.content.revision.id !== "drev_acme_power_iin_max_1") {
    throw new Error("comparison-multihead-reviewed-bundle-base-invalid");
  }
  const targetIin = target.documents.find((document) => document.kind === "definition"
    && document.content.id === syntheticTarget.definitions.iin_max.id);
  if (!targetIin || targetIin.kind !== "definition") throw new Error("comparison-multihead-reviewed-bundle-iin-target-missing");
  targetIin.content.revision.valueSchema = syntheticIinArrayValueSchema;
  target.documents.push(syntheticDefinition(targetIin.source, subject.content.id, "enabled"));
  refreshSyntheticRelease(target);
  return deepFreeze({
    ...full,
    targetReleaseId: target.manifest.release.id,
    releases: [target],
  });
};
