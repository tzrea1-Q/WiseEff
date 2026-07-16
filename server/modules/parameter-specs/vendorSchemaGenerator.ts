import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { classifyDtsValue } from "../dts/valueTyping";
import { resolveDtsConfigSet } from "../dts";
import type { SchemaDocument, SchemaPropertyDocument, SchemaSource } from "./types";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = join(moduleDir, "../../..");
const seedDir = join(root, "src/config/dts-seed");
const vendorDir = join(root, "schemas/dts/vendor/wiseeff");
const catalogPath = join(root, "schemas/dts/catalog.json");

type DriverBucket = {
  schemaId: string;
  schemaNamespace: string;
  compatible: string[];
  nodename: string[];
  properties: Map<string, SchemaPropertyDocument>;
};

function slug(value: string): string {
  const normalized = value === "/" ? "root" : value;
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root";
}

function inferValueShape(propertyKey: string, rawText: string): SchemaPropertyDocument["valueShape"] {
  return classifyDtsValue(rawText, propertyKey).valueType;
}

function unitsFor(propertyKey: string): string | undefined {
  if (/_(mv|uv|mV)$/i.test(propertyKey) || propertyKey.endsWith("_mv")) return "mV";
  if (/uohm/i.test(propertyKey)) return "uOhm";
  if (/_ma$/i.test(propertyKey)) return "mA";
  if (/_time|_delay/i.test(propertyKey)) return "ms";
  return undefined;
}

/**
 * Build deterministic vendor schema documents from the golden power base+overlay.
 * Curated overrides keep SC8562 and MT5788 `gpio_int` as distinct specs.
 */
export function buildVendorSchemaDocuments(): SchemaDocument[] {
  const base = readFileSync(join(seedDir, "wiseeff-power-base.dts"), "utf8");
  const overlay = readFileSync(join(seedDir, "base-power-overlay.dts"), "utf8");
  const resolved = resolveDtsConfigSet({
    entryFile: "base.dts",
    includeSearchPaths: [],
    overlayOrder: ["power.dtso"],
    files: new Map([
      ["base.dts", { fileVersionId: "vendor-gen-base", content: base }],
      ["power.dtso", { fileVersionId: "vendor-gen-overlay", content: overlay }],
    ]),
  });

  const buckets = new Map<string, DriverBucket>();

  for (const node of resolved.effective.nodesByLocator.values()) {
    const overlayProps = [...node.properties.entries()].filter(([, property]) => {
      if (property.deleted) return false;
      return property.sourceChain.some(
        (entry) => entry.fileName === "power.dtso" && entry.effect !== "delete",
      );
    });
    if (overlayProps.length === 0) continue;

    const compatibleProp = node.properties.get("compatible");
    const compatible =
      compatibleProp && !compatibleProp.deleted
        ? [...compatibleProp.rawText.matchAll(/"([^"]+)"/g)].map((match) => match[1])
        : [];

    let bucketKey: string;
    let schemaNamespace: string;
    let nodename: string[] = [];

    if (compatible.length > 0) {
      bucketKey = `compat:${compatible[0]}`;
      schemaNamespace = `vendor/${compatible[0]}`;
    } else {
      bucketKey = `nodename:${node.name}`;
      schemaNamespace = `vendor/nodename/${node.name}`;
      nodename = [node.name];
    }

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        schemaId: compatible[0]
          ? `wiseeff/${slug(compatible[0])}.yaml`
          : `wiseeff/nodename-${slug(node.name)}.yaml`,
        schemaNamespace,
        compatible: [...compatible],
        nodename,
        properties: new Map(),
      };
      buckets.set(bucketKey, bucket);
    } else if (compatible.length > 0) {
      for (const value of compatible) {
        if (!bucket.compatible.includes(value)) bucket.compatible.push(value);
      }
    }

    for (const [key, property] of overlayProps) {
      if (bucket.properties.has(key)) continue;
      const doc: SchemaPropertyDocument = {
        valueShape: inferValueShape(key, property.rawText),
        exampleValue: property.rawText,
        constraints: {},
      };
      const units = unitsFor(key);
      if (units) doc.units = units;
      bucket.properties.set(key, doc);
    }
  }

  const documents: SchemaDocument[] = [];

  for (const bucket of [...buckets.values()].sort((a, b) => a.schemaId.localeCompare(b.schemaId))) {
    const properties = Object.fromEntries(
      [...bucket.properties.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );

    // Curated distinct gpio_int specs for the two wireless/charger ICs.
    if (bucket.compatible.includes("sc8562") && properties.gpio_int) {
      properties.gpio_int = {
        ...properties.gpio_int,
        documentation: "SC8562 interrupt GPIO phandle-array (pin + flags).",
        exampleValue: "<&gpio13 29 0>",
        constraints: { cells: 3, description: "phandle pin flags" },
      };
    }
    if (bucket.compatible.includes("mt,mt5788") && properties.gpio_int) {
      properties.gpio_int = {
        ...properties.gpio_int,
        documentation: "MT5788 interrupt GPIO phandle-array (pin + flags).",
        exampleValue: "<&gpio6 15 0>",
        constraints: { cells: 3, description: "phandle pin flags" },
      };
    }

    documents.push({
      $id: bucket.schemaId,
      title: bucket.compatible[0] ?? bucket.nodename[0] ?? bucket.schemaId,
      source: "vendor",
      lifecycle: "active",
      version: 1,
      schemaNamespace: bucket.schemaNamespace,
      compatible: bucket.compatible.length > 0 ? bucket.compatible : undefined,
      nodename: bucket.nodename.length > 0 ? bucket.nodename : undefined,
      commonRefs: properties.status ? ["wiseeff/common-status.yaml"] : undefined,
      properties,
    });
  }

  documents.push({
    $id: "wiseeff/common-status.yaml",
    title: "Common status property",
    source: "vendor",
    lifecycle: "active",
    version: 1,
    schemaNamespace: "vendor/common",
    properties: {
      status: {
        valueShape: "string-list",
        exampleValue: '"okay"',
        constraints: { enum: ["okay", "disabled", "reserved", "fail"] },
        documentation: "Standard DT status; illustrative enum only.",
      },
    },
  });

  // Fixture schemas for precedence / ambiguity tests (not part of golden coverage).
  documents.push({
    $id: "wiseeff/test-ambiguous-a.yaml",
    title: "Ambiguous fixture A",
    source: "vendor",
    lifecycle: "active",
    version: 1,
    schemaNamespace: "vendor/test-ambiguous-a",
    compatible: ["wiseeff,test-ambiguous"],
    properties: {
      shared_prop: {
        valueShape: "u32-array",
        exampleValue: "<1>",
        documentation: "Ambiguous candidate A",
      },
    },
  });
  documents.push({
    $id: "wiseeff/test-ambiguous-b.yaml",
    title: "Ambiguous fixture B",
    source: "vendor",
    lifecycle: "active",
    version: 1,
    schemaNamespace: "vendor/test-ambiguous-b",
    compatible: ["wiseeff,test-ambiguous"],
    properties: {
      shared_prop: {
        valueShape: "u32-array",
        exampleValue: "<1>",
        documentation: "Ambiguous candidate B",
      },
    },
  });

  return documents.sort((a, b) => a.$id.localeCompare(b.$id));
}

export function vendorContentHash(documents: SchemaDocument[]): string {
  const payload = documents
    .map((document) => yaml.dump(document, { sortKeys: true, lineWidth: 120 }))
    .join("\n---\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function hashVendorDirectory(directory: string): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(directory, name), "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function writeVendorSchemaArtifacts(documents = buildVendorSchemaDocuments()): {
  files: string[];
  catalogHash: string;
} {
  mkdirSync(vendorDir, { recursive: true });

  const files: string[] = [];
  const writtenNames = new Set<string>();
  for (const document of documents) {
    const fileName = document.$id.replace(/^wiseeff\//, "");
    const absolute = join(vendorDir, fileName);
    writeFileSync(absolute, yaml.dump(document, { sortKeys: false, lineWidth: 120 }), "utf8");
    files.push(`vendor/wiseeff/${fileName}`);
    writtenNames.add(fileName);
  }

  for (const existing of readdirSync(vendorDir)) {
    if (
      (existing.endsWith(".yaml") || existing.endsWith(".yml")) &&
      !writtenNames.has(existing)
    ) {
      unlinkSync(join(vendorDir, existing));
    }
  }

  const hash = hashVendorDirectory(vendorDir);
  const catalog = {
    linuxDtSchemaRevision: "v6.12-pinned-stub",
    dtschemaVersion: "2026.6",
    vendorContentHash: hash,
    importedAt: "2026-07-16T00:00:00.000Z",
    schemaPaths: files.sort(),
  };
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  return { files, catalogHash: hash };
}

export type { SchemaSource };
