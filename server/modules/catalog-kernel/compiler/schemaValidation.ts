import { createRequire } from "node:module";

import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import type { CatalogReleaseBundle } from "./types";
import { INSTALL_CHAIN_SOURCE_FORMAT, isInstallChainToolchain } from "./contract";
import {
  catalogManifestSchema,
  catalogOwnerReleaseSchema,
  definitionDtsExamplesSchema,
} from "./contractArtifacts";

interface ValidateFunction {
  (value: unknown): boolean;
  readonly errors?: readonly unknown[] | null;
}

interface AjvLike {
  addSchema(schema: unknown): void;
  addFormat(name: string, validate: (value: string) => boolean): void;
  compile(schema: unknown): ValidateFunction;
}

type AjvConstructor = new (options: {
  readonly allErrors: boolean;
  readonly strict: boolean;
}) => AjvLike;

const localRequire = createRequire(import.meta.url);
const Ajv2020 = (
  localRequire("ajv/dist/2020") as { readonly default: AjvConstructor }
).default;

const paddedBase64Pattern = "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$";
const paddedBase64Format = "catalog-padded-base64";

function matchesPaddedBase64Syntax(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  // A single character-class search avoids a RegExp stack frame per quartet.
  const firstNonAlphabet = value.search(/[^A-Za-z0-9+/]/u);
  if (firstNonAlphabet === -1) return true;
  return (firstNonAlphabet === value.length - 1 && value.endsWith("=")) ||
    (firstNonAlphabet === value.length - 2 && value.endsWith("=="));
}

function bundleSchemaForValidation() {
  const schema = structuredClone(catalogOwnerReleaseSchema) as {
    $defs: {
      sourceInventoryEntry: { properties: { bytes: { pattern?: string; format?: string } } };
      definitionRevision: { properties: Record<string, unknown> };
    };
  };
  const bytes = schema.$defs?.sourceInventoryEntry?.properties?.bytes;
  if (bytes?.pattern !== paddedBase64Pattern || bytes.format !== undefined) {
    throw new Error("Catalog bundle source bytes schema changed; review the Base64 validator");
  }
  // Keep the checked-in schema and its fingerprint intact. Substitute only the
  // equivalent syntax check in the runtime copy. Full compilation also checks
  // canonical padding bits by decoding and re-encoding the exact source bytes.
  delete bytes.pattern;
  bytes.format = paddedBase64Format;
  // Add authoring support without changing the frozen schema bytes for old bundles.
  schema.$defs.definitionRevision.properties.dtsExamples = definitionDtsExamplesSchema;
  return schema;
}

function manifestSchemaForValidation() {
  const schema = structuredClone(catalogManifestSchema) as {
    properties: { files: { uniqueItems?: boolean }; documents: { uniqueItems?: boolean } };
    $defs: { toolchain: { properties: { sourceFormat: { const?: string; enum?: string[] } } } };
  };
  for (const inventory of [schema.properties.files, schema.properties.documents]) {
    if (inventory.uniqueItems !== true) throw new Error("Catalog manifest inventory uniqueness contract changed");
    delete inventory.uniqueItems;
  }
  const format = schema.$defs.toolchain.properties.sourceFormat;
  if (format.const !== "wiseeff-catalog-release@1") throw new Error("Catalog source format contract changed");
  // Keep the original manifest frozen. Its const rejects every v2 artifact on
  // legacy workers, offline installers, and maintenance tools.
  schema.$defs.toolchain.properties.sourceFormat = { enum: [format.const, INSTALL_CHAIN_SOURCE_FORMAT] };
  return schema;
}

const contractAjv = new Ajv2020({ allErrors: true, strict: true });
contractAjv.addSchema(manifestSchemaForValidation());
contractAjv.addFormat(paddedBase64Format, matchesPaddedBase64Syntax);
// The v6 schema is additive; the original schema remains frozen for historical artifacts.
const validateBundle = contractAjv.compile(bundleSchemaForValidation());

export function isCatalogReleaseBundle(value: unknown): value is CatalogReleaseBundle {
  if (!validateBundle(value)) return false;
  // AJV compares every pair for uniqueItems on objects. Once the member schema
  // passes, canonical equality is equivalent and needs one visit per member.
  for (const release of (value as CatalogReleaseBundle).releases) {
    const { toolchain } = release.manifest;
    // @1 admitted every compiler string, including any future marker by coincidence.
    if (toolchain.sourceFormat === INSTALL_CHAIN_SOURCE_FORMAT && !isInstallChainToolchain(toolchain)) return false;
    for (const entries of [release.manifest.files, release.manifest.documents]) {
      const seen = new Set<string>();
      for (const entry of entries) {
        let key: string;
        try {
          key = serializeContract(entry as unknown as ContractJsonValue);
        } catch {
          return false;
        }
        if (seen.has(key)) return false;
        seen.add(key);
      }
    }
  }
  return true;
}

const valueSchemaValidity = new Map<string, boolean>();

export const isValidJsonSchema202012 = (schema: unknown): boolean => {
  let cacheKey: string | undefined;
  try {
    const serialized = serializeContract(schema as ContractJsonValue);
    if (serialized.length <= 65_536) cacheKey = serialized;
  } catch {
    cacheKey = undefined;
  }
  const cached = cacheKey === undefined ? undefined : valueSchemaValidity.get(cacheKey);
  if (cached !== undefined) return cached;

  let valid: boolean;
  try {
    new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    valid = true;
  } catch {
    valid = false;
  }
  if (cacheKey !== undefined) {
    if (valueSchemaValidity.size >= 256) {
      const oldest = valueSchemaValidity.keys().next().value;
      if (oldest !== undefined) valueSchemaValidity.delete(oldest);
    }
    valueSchemaValidity.set(cacheKey, valid);
  }
  return valid;
};
