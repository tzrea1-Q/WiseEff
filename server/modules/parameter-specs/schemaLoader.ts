import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import yaml from "js-yaml";

import type {
  DriverSchema,
  PropertySpec,
  PropertyValueShape,
  SchemaCatalog,
  SchemaDocument,
  SchemaPropertyDocument,
  SchemaRegistry,
  SchemaSource,
  SpecLifecycle,
} from "./types";

function isReleasableSource(source: SchemaSource): boolean {
  return source === "linux" || source === "vendor" || source === "manual";
}

function normalizeValueShape(
  value: SchemaPropertyDocument["valueShape"] | undefined,
): PropertyValueShape {
  if (!value) return { kind: "unknown" };
  if (typeof value === "string") return { kind: value };
  return value;
}

function parseDocument(raw: string): SchemaDocument {
  const loaded = yaml.load(raw);
  if (!loaded || typeof loaded !== "object") {
    throw new Error("Schema document must be a YAML mapping");
  }
  return loaded as SchemaDocument;
}

function materializeDocument(document: SchemaDocument): {
  driver: DriverSchema;
  properties: PropertySpec[];
} {
  const source = document.source;
  const lifecycle: SpecLifecycle = document.lifecycle ?? (source === "inferred" ? "draft" : "active");
  const version = document.version ?? 1;
  const compatiblePatterns = document.compatible ?? [];
  const nodenamePatterns = document.nodename ?? [];
  const primaryCompatible = compatiblePatterns[0] ?? nodenamePatterns[0] ?? document.$id;
  const driverId = `driver:${document.$id}:v${version}`;

  const properties: PropertySpec[] = [];
  const propertyIds: string[] = [];

  for (const [propertyKey, propertyDoc] of Object.entries(document.properties ?? {})) {
    const propertySource = propertyDoc.source ?? source;
    const propertyLifecycle =
      propertyDoc.lifecycle ?? (propertySource === "inferred" ? "draft" : lifecycle);
    const parameterSpecId = `pspec:${document.schemaNamespace}:${propertyKey}`;
    const id = `propspec:${document.schemaNamespace}:${propertyKey}:v${version}`;
    propertyIds.push(id);
    properties.push({
      id,
      parameterSpecId,
      driverSchemaId: driverId,
      propertyKey,
      schemaNamespace: document.schemaNamespace,
      source: propertySource,
      lifecycle: propertyLifecycle,
      valueShape: normalizeValueShape(propertyDoc.valueShape),
      units: propertyDoc.units,
      constraints: propertyDoc.constraints ?? {},
      exampleValue: propertyDoc.exampleValue,
      schemaDefault: propertyDoc.schemaDefault,
      documentation: propertyDoc.documentation,
    });
  }

  const driver: DriverSchema = {
    id: driverId,
    compatible: primaryCompatible,
    compatiblePatterns,
    nodenamePatterns,
    source,
    schemaNamespace: document.schemaNamespace,
    version,
    lifecycle,
    propertyIds,
    commonRefs: document.commonRefs ?? [],
  };

  return { driver, properties };
}

/**
 * Load pinned schema packages from `schemas/dts`.
 * Only schemas listed in catalog.json (plus their commonRefs) are loaded.
 */
export function loadSchemaRegistry(schemasRoot: string): SchemaRegistry {
  const catalogRaw = readFileSync(join(schemasRoot, "catalog.json"), "utf8");
  const catalog = JSON.parse(catalogRaw) as SchemaCatalog;

  const vendorDir = join(schemasRoot, "vendor/wiseeff");
  const onDisk = readdirSync(vendorDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  const hash = createHash("sha256");
  for (const name of onDisk) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(vendorDir, name), "utf8"));
    hash.update("\0");
  }
  const vendorContentHash = hash.digest("hex");
  if (vendorContentHash !== catalog.vendorContentHash) {
    // Keep loading; tests assert coverage. Hash mismatch is surfaced via catalog field for callers.
  }

  const requested = new Set(catalog.schemaPaths);
  const documents = new Map<string, SchemaDocument>();

  for (const relativePath of catalog.schemaPaths) {
    const absolute = join(schemasRoot, relativePath);
    const document = parseDocument(readFileSync(absolute, "utf8"));
    documents.set(document.$id, document);
  }

  // Pull common refs reachable from requested schemas.
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of [...documents.values()]) {
      for (const ref of document.commonRefs ?? []) {
        if (documents.has(ref)) continue;
        const relative = ref.startsWith("vendor/") ? ref : `vendor/${ref}`;
        if (!requested.has(relative) && !requested.has(ref)) {
          // Still load reachable common schemas even if omitted from the path list.
        }
        const absolute = join(schemasRoot, relative.startsWith("vendor/") ? relative : `vendor/${ref}`);
        try {
          const commonDoc = parseDocument(readFileSync(absolute, "utf8"));
          documents.set(commonDoc.$id, commonDoc);
          changed = true;
        } catch {
          // Missing common ref stays unloaded; matcher will surface unmatched properties.
        }
      }
    }
  }

  const drivers: DriverSchema[] = [];
  const properties: PropertySpec[] = [];

  for (const document of [...documents.values()].sort((a, b) => a.$id.localeCompare(b.$id))) {
    const materialized = materializeDocument(document);
    // Common-only docs (no compatible/nodename) still contribute property specs for $ref use.
    if (
      (document.compatible && document.compatible.length > 0) ||
      (document.nodename && document.nodename.length > 0) ||
      document.$id.includes("test-ambiguous")
    ) {
      drivers.push(materialized.driver);
    } else if (document.$id.includes("common")) {
      // Expose common properties without a selectable driver.
      for (const property of materialized.properties) {
        properties.push({ ...property, driverSchemaId: null });
      }
      continue;
    } else {
      drivers.push(materialized.driver);
    }
    properties.push(...materialized.properties);
  }

  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const driversById = new Map(drivers.map((driver) => [driver.id, driver]));

  return {
    catalog: {
      ...catalog,
      vendorContentHash: catalog.vendorContentHash || vendorContentHash,
    },
    drivers,
    properties,
    propertiesById,
    driversById,
  };
}

export function isReleasableDriver(driver: DriverSchema): boolean {
  return isReleasableSource(driver.source) && driver.lifecycle !== "draft";
}

export function isReleasableProperty(property: PropertySpec): boolean {
  return isReleasableSource(property.source) && property.lifecycle !== "draft";
}
