import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type JsonSchema = boolean | Readonly<Record<string, unknown>>;

export interface StableCatalogRules {
  readonly valueSchemaRules: {
    readonly dialect: string;
    readonly requireValidSchema: boolean;
    readonly forbiddenReferenceKeywords: readonly string[];
    readonly traversal: {
      readonly rootDepth: number;
      readonly maxDepth: number;
      readonly maxContainerNodes: number;
      readonly limitViolation: string;
    };
  };
}

const artifactUrl = (name: string): URL =>
  new URL(`../../../../schemas/dts/catalog-release/${name}`, import.meta.url);

const readArtifact = (name: string): { readonly bytes: string; readonly json: JsonSchema } => {
  const bytes = readFileSync(fileURLToPath(artifactUrl(name)), "utf8");
  return { bytes, json: JSON.parse(bytes) as JsonSchema };
};

const catalogRelease = readArtifact("catalog-release.schema.json");
const manifest = readArtifact("manifest.schema.json");
const stableRules = readArtifact("stable-id-rules.json");

export const catalogReleaseSchema = catalogRelease.json;
export const catalogManifestSchema = manifest.json;
export const stableCatalogRules = stableRules.json as unknown as StableCatalogRules;

export const s1BundleContractArtifactDigest = `sha256:${createHash("sha256")
  .update(catalogRelease.bytes)
  .update(manifest.bytes)
  .update(stableRules.bytes)
  .digest("hex")}`;
