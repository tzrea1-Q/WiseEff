import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import { parseStableCatalogRules } from "./stableRules";

type JsonSchema = boolean | Readonly<Record<string, unknown>>;

const artifactUrl = (name: string): URL =>
  new URL(`../../../../schemas/dts/catalog-release/${name}`, import.meta.url);

const readArtifact = (
  name: string,
): {
  readonly path: string;
  readonly bytes: string;
  readonly json: JsonSchema;
} => {
  const bytes = readFileSync(fileURLToPath(artifactUrl(name)), "utf8");
  return {
    path: `schemas/dts/catalog-release/${name}`,
    bytes,
    json: JSON.parse(bytes) as JsonSchema,
  };
};

const catalogRelease = readArtifact("catalog-release.schema.json");
const manifest = readArtifact("manifest.schema.json");
const stableRules = readArtifact("stable-id-rules.json");

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

export const catalogReleaseSchema = catalogRelease.json;
export const catalogManifestSchema = manifest.json;
export const stableCatalogRules = deepFreeze(
  parseStableCatalogRules(stableRules.json),
);

export const fingerprintContractArtifacts = (
  records: readonly { readonly path: string; readonly bytes: string }[],
): string => {
  const framed = [...records]
    .map((record) => ({
      path: record.path,
      byteLength: Buffer.byteLength(record.bytes, "utf8"),
      rawDigest: createHash("sha256").update(record.bytes).digest("hex"),
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  return `sha256:${createHash("sha256")
    .update(serializeContract(framed as unknown as ContractJsonValue))
    .digest("hex")}`;
};

export const s1BundleContractArtifactDigest = fingerprintContractArtifacts([
  catalogRelease,
  manifest,
  stableRules,
]);
