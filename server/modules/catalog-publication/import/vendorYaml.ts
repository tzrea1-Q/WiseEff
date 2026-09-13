/**
 * Vendor YAML inventory and D1-compatible parse/schema mapping.
 *
 * Input selection is catalog.json schemaPaths, not a directory walk.
 * D1 slug identity, first-acme fixture, and fixed release pins stay in
 * scripts/compile-vendor-catalog-release.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import type { ContractJsonValue } from "../../parameter-catalog-contract/index";

export const EXCLUDED_SCHEMA_BASENAMES = Object.freeze([
  "common-status.yaml",
  "test-ambiguous-a.yaml",
  "test-ambiguous-b.yaml",
] as const);

export const POWER_MANAGEMENT_BASENAME = "power-management.json";

const EXCLUDED = new Set<string>(EXCLUDED_SCHEMA_BASENAMES);

export type VendorPropertyYaml = {
  readonly valueShape?: string | { readonly kind?: string };
  readonly units?: string;
  readonly documentation?: string;
  readonly constraints?: unknown;
  readonly exampleValue?: unknown;
  readonly default?: unknown;
  readonly [key: string]: unknown;
};

export type VendorYamlDocument = {
  readonly $id?: string;
  readonly title?: string;
  readonly source?: string;
  readonly lifecycle?: string;
  readonly version?: number;
  readonly schemaNamespace?: string;
  readonly compatible?: readonly string[];
  readonly nodename?: readonly string[];
  readonly documentation?: string;
  readonly childNodes?: unknown;
  readonly properties?: Readonly<Record<string, VendorPropertyYaml>>;
  readonly [key: string]: unknown;
};

export type VendorCatalogManifest = {
  readonly vendorContentHash: string;
  readonly schemaPaths: readonly string[];
  readonly [key: string]: unknown;
};

export type VendorFileDispositionKind =
  | "input"
  | "excluded"
  | "extra-not-imported"
  | "listed-missing"
  | "forbidden-extra";

export type VendorFileInventory = {
  readonly relativePath: string;
  readonly basename: string;
  readonly listed: boolean;
  readonly onDisk: boolean;
  readonly excluded: boolean;
  readonly disposition: VendorFileDispositionKind;
  readonly detail: string;
};

export type VendorCatalogFieldDisposition = {
  readonly field: string;
  readonly disposition: "structural-non-param";
  readonly detail: string;
};

export type VendorCatalogInventory = {
  readonly catalogPath: string;
  readonly vendorDir: string;
  readonly vendorContentHash: string;
  readonly observedDirectoryHash: string;
  readonly listedInputHash: string;
  readonly schemaPaths: readonly string[];
  readonly files: readonly VendorFileInventory[];
  readonly catalogFields: readonly VendorCatalogFieldDisposition[];
};

export type VendorInventoryError =
  | {
      readonly kind: "catalog-vendor-hash-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly kind: "listed-file-missing"; readonly relativePath: string }
  | { readonly kind: "extra-file-forbidden"; readonly relativePath: string }
  | { readonly kind: "power-management-excluded"; readonly relativePath: string }
  | { readonly kind: "invalid-input"; readonly reason: string };

export type VendorInventoryResult =
  | { readonly ok: true; readonly value: VendorCatalogInventory }
  | {
      readonly ok: false;
      readonly error: VendorInventoryError;
      readonly inventory?: VendorCatalogInventory;
    };

const CATALOG_STRUCTURAL_FIELDS = [
  "linuxDtSchemaRevision",
  "dtschemaVersion",
  "vendorContentHash",
  "importedAt",
  "schemaPaths",
] as const;

export const vendorDirectoryHash = (vendorDir: string): string => {
  const hash = createHash("sha256");
  for (const name of readdirSync(vendorDir)
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(path.join(vendorDir, name), "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex");
};

export const hashListedSchemaPaths = (
  schemasRoot: string,
  schemaPaths: readonly string[],
): string => {
  const hash = createHash("sha256");
  for (const relativePath of schemaPaths) {
    hash.update(relativePath);
    hash.update("\0");
    const absolute = path.join(schemasRoot, relativePath);
    if (existsSync(absolute)) {
      hash.update(readFileSync(absolute, "utf8"));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
};

export const vendorValueSchemaFor = (
  shape: string,
): Record<string, ContractJsonValue> => {
  switch (shape) {
    case "bool":
      return { type: "boolean" };
    case "empty":
      return { type: "null" };
    case "string-list":
      return { type: "array", items: { type: "string" } };
    case "u32-array":
      return { type: "array", items: { type: "integer", minimum: 0 } };
    case "phandle-list":
      return { type: "array" };
    case "bytes":
      return { type: "string" };
    case "mixed":
    case "unknown":
      return { description: shape };
    default:
      throw new Error(`catalog-vendor-unsupported-value-shape:${shape}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readCatalogManifest = (
  catalogPath: string,
): { readonly ok: true; readonly value: VendorCatalogManifest } | { readonly ok: false; readonly error: VendorInventoryError } => {
  if (!existsSync(catalogPath)) {
    return { ok: false, error: { kind: "invalid-input", reason: `catalog.json missing:${catalogPath}` } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    return { ok: false, error: { kind: "invalid-input", reason: "catalog.json unreadable" } };
  }
  if (!isRecord(parsed) || typeof parsed.vendorContentHash !== "string") {
    return { ok: false, error: { kind: "invalid-input", reason: "catalog.json vendorContentHash required" } };
  }
  if (!Array.isArray(parsed.schemaPaths) || parsed.schemaPaths.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: { kind: "invalid-input", reason: "catalog.json schemaPaths must be strings" } };
  }
  return {
    ok: true,
    value: {
      vendorContentHash: parsed.vendorContentHash,
      schemaPaths: parsed.schemaPaths as string[],
      ...parsed,
    },
  };
};

const diskYamlNames = (vendorDir: string): string[] => {
  if (!existsSync(vendorDir)) return [];
  return readdirSync(vendorDir)
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort();
};

export const inventoryVendorCatalog = (
  schemasRoot: string,
): VendorInventoryResult => {
  const catalogPath = path.join(schemasRoot, "catalog.json");
  const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
  const manifestResult = readCatalogManifest(catalogPath);
  if (!manifestResult.ok) {
    return { ok: false, error: manifestResult.error };
  }
  const manifest = manifestResult.value;

  const listed = manifest.schemaPaths;
  const listedSet = new Set(listed);
  const files: VendorFileInventory[] = [];

  for (const relativePath of listed) {
    const basename = path.basename(relativePath);
    const onDisk = existsSync(path.join(schemasRoot, relativePath));
    if (basename === POWER_MANAGEMENT_BASENAME) {
      files.push({
        relativePath,
        basename,
        listed: true,
        onDisk,
        excluded: true,
        disposition: "excluded",
        detail: "power-management.json is not a vendor catalog input",
      });
      return {
        ok: false,
        error: { kind: "power-management-excluded", relativePath },
        inventory: {
          catalogPath,
          vendorDir,
          vendorContentHash: manifest.vendorContentHash,
          observedDirectoryHash: existsSync(vendorDir) ? vendorDirectoryHash(vendorDir) : "",
          listedInputHash: hashListedSchemaPaths(schemasRoot, listed),
          schemaPaths: listed,
          files,
          catalogFields: [],
        },
      };
    }
    if (!onDisk) {
      files.push({
        relativePath,
        basename,
        listed: true,
        onDisk: false,
        excluded: EXCLUDED.has(basename),
        disposition: "listed-missing",
        detail: "schemaPaths entry is absent on disk",
      });
      continue;
    }
    if (EXCLUDED.has(basename)) {
      files.push({
        relativePath,
        basename,
        listed: true,
        onDisk: true,
        excluded: true,
        disposition: "excluded",
        detail: "explicitly excluded fixture; not imported",
      });
      continue;
    }
    files.push({
      relativePath,
      basename,
      listed: true,
      onDisk: true,
      excluded: false,
      disposition: "input",
      detail: "listed schemaPaths input",
    });
  }

  const listedBasenames = new Set(listed.map((relativePath) => path.basename(relativePath)));
  for (const name of diskYamlNames(vendorDir)) {
    const relativePath = `vendor/wiseeff/${name}`;
    if (listedSet.has(relativePath) || listedBasenames.has(name)) continue;
    const excluded = EXCLUDED.has(name);
    files.push({
      relativePath,
      basename: name,
      listed: false,
      onDisk: true,
      excluded,
      disposition: excluded ? "extra-not-imported" : "forbidden-extra",
      detail: excluded
        ? "on disk, not in schemaPaths, excluded by policy"
        : "on disk and not listed in schemaPaths",
    });
  }

  const observedDirectoryHash = existsSync(vendorDir) ? vendorDirectoryHash(vendorDir) : "";
  const listedInputHash = hashListedSchemaPaths(schemasRoot, listed);
  const catalogFields: VendorCatalogFieldDisposition[] = Object.keys(manifest)
    .filter((field) => field !== "schemaPaths" && field !== "vendorContentHash")
    .sort()
    .map((field) => ({
      field,
      disposition: "structural-non-param" as const,
      detail: CATALOG_STRUCTURAL_FIELDS.includes(field as (typeof CATALOG_STRUCTURAL_FIELDS)[number])
        ? "catalog.json manifest field"
        : "unlisted catalog.json field; not imported as a parameter",
    }));
  catalogFields.unshift(
    {
      field: "vendorContentHash",
      disposition: "structural-non-param",
      detail: "input integrity pin; compared to vendor directory hash",
    },
    {
      field: "schemaPaths",
      disposition: "structural-non-param",
      detail: "authoritative input list; directory walk does not select files",
    },
  );

  const inventory: VendorCatalogInventory = {
    catalogPath,
    vendorDir,
    vendorContentHash: manifest.vendorContentHash,
    observedDirectoryHash,
    listedInputHash,
    schemaPaths: listed,
    files,
    catalogFields,
  };

  const powerListed = files.find(
    (file) => file.basename === POWER_MANAGEMENT_BASENAME && file.listed && file.disposition !== "excluded",
  );
  if (powerListed) {
    return {
      ok: false,
      error: { kind: "power-management-excluded", relativePath: powerListed.relativePath },
      inventory,
    };
  }
  const missing = files.find((file) => file.disposition === "listed-missing");
  if (missing) {
    return {
      ok: false,
      error: { kind: "listed-file-missing", relativePath: missing.relativePath },
      inventory,
    };
  }
  const forbidden = files.find((file) => file.disposition === "forbidden-extra");
  if (forbidden) {
    return {
      ok: false,
      error: { kind: "extra-file-forbidden", relativePath: forbidden.relativePath },
      inventory,
    };
  }
  if (observedDirectoryHash !== manifest.vendorContentHash) {
    return {
      ok: false,
      error: {
        kind: "catalog-vendor-hash-mismatch",
        expected: manifest.vendorContentHash,
        actual: observedDirectoryHash,
      },
      inventory,
    };
  }
  return { ok: true, value: inventory };
};

export const parseVendorYamlFile = (
  absolutePath: string,
): VendorYamlDocument | { error: string } => {
  let loaded: unknown;
  try {
    loaded = parseYaml(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "yaml-unreadable" };
  }
  if (!isRecord(loaded)) {
    return { error: "vendor-schema-not-object" };
  }
  return loaded as VendorYamlDocument;
};

export const vendorPropertyShape = (property: VendorPropertyYaml): string => {
  const shapeValue = property.valueShape;
  return typeof shapeValue === "string" ? shapeValue : shapeValue?.kind ?? "unknown";
};

export const isExcludedSchemaBasename = (basename: string): boolean => EXCLUDED.has(basename);
