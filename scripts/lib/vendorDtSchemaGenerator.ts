/**
 * Convert WiseEff vendor property specs into Linux dt-schema binding YAML.
 * Fail-closed: no blanket additionalProperties / unevaluatedProperties.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import yaml from "js-yaml";

export type VendorProperty = {
  valueShape: string;
  exampleValue?: string;
  constraints?: {
    cells?: number;
    enum?: string[];
    minItems?: number;
    maxItems?: number;
    description?: string;
  };
  documentation?: string;
};

export type VendorSpecDoc = {
  $id?: string;
  title?: string;
  compatible?: string[];
  commonRefs?: string[];
  properties?: Record<string, VendorProperty>;
  schemaBlockers?: string[];
};

export type GeneratedBinding = {
  compatible: string;
  fileName: string;
  body: string;
  blockers: string[];
  source: "vendor" | "seed-derived" | "gpio-controller-template";
};

const GPIO_CONTROLLER_TEMPLATE: Record<string, VendorProperty> = {
  compatible: { valueShape: "string-list", constraints: {} },
  "gpio-controller": { valueShape: "empty", constraints: {} },
  "#gpio-cells": { valueShape: "u32-array", exampleValue: "<2>", constraints: { minItems: 1, maxItems: 1 } },
  status: { valueShape: "string-list", constraints: { enum: ["okay", "disabled", "reserved", "fail"] } }
};

const STANDARD_DEVICE_REF = "/schemas/device.yaml#";

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root";
}

function quoteYamlString(value: string): string {
  if (/[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }
  return value;
}

export function propertyToDtSchema(name: string, prop: VendorProperty): { schema: Record<string, unknown>; blockers: string[] } {
  const blockers: string[] = [];
  const constraints = prop.constraints ?? {};

  switch (prop.valueShape) {
    case "string-list": {
      if (constraints.enum?.length) {
        return { schema: { type: "string", enum: constraints.enum }, blockers };
      }
      return { schema: { type: "string" }, blockers };
    }
    case "u32-array": {
      const schema: Record<string, unknown> = { $ref: "/schemas/types.yaml#/definitions/uint32-array" };
      if (constraints.minItems != null) schema.minItems = constraints.minItems;
      if (constraints.maxItems != null) schema.maxItems = constraints.maxItems;
      return { schema, blockers };
    }
    case "phandle-list":
      return { schema: { $ref: "/schemas/types.yaml#/definitions/phandle" }, blockers };
    case "mixed": {
      const cells = constraints.cells;
      if (cells != null && cells > 0) {
        return {
          schema: {
            $ref: "/schemas/types.yaml#/definitions/phandle-array",
            minItems: 1,
            maxItems: 1,
            items: { minItems: cells, maxItems: cells }
          },
          blockers
        };
      }
      if ((prop.exampleValue ?? "").includes("&")) {
        return { schema: { $ref: "/schemas/types.yaml#/definitions/phandle-array" }, blockers };
      }
      blockers.push(`needs-review: mixed property ${name} without cells or phandle example`);
      return { schema: { $comment: `needs-review:${name}` }, blockers };
    }
    case "bytes":
      return { schema: { $ref: "/schemas/types.yaml#/definitions/hex" }, blockers };
    case "empty":
      return { schema: { type: "object", maxProperties: 0 }, blockers };
    case "boolean":
      return { schema: { type: "boolean" }, blockers };
    default:
      blockers.push(`needs-review: unmapped valueShape ${prop.valueShape} for ${name}`);
      return { schema: { $comment: `needs-review:${prop.valueShape}` }, blockers };
  }
}

function regPropertyForParent(addressCells = 1, sizeCells = 0): Record<string, unknown> {
  const itemCells = addressCells + sizeCells;
  if (itemCells <= 1) {
    return { $ref: "/schemas/types.yaml#/definitions/reg" };
  }
  return {
    $ref: "/schemas/types.yaml#/definitions/reg",
    minItems: itemCells,
    maxItems: itemCells
  };
}

export function renderBindingFromVendorSpec(compatible: string, spec: VendorSpecDoc): GeneratedBinding {
  const idSlug = slug(compatible);
  const blockers = [...(spec.schemaBlockers ?? [])];
  const properties: Record<string, unknown> = {
    compatible: {
      type: "string",
      pattern: `^${compatible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
    }
  };

  const required = new Set<string>(["compatible"]);

  for (const [name, prop] of Object.entries(spec.properties ?? {})) {
    if (name === "compatible") continue;
    const converted = propertyToDtSchema(name, prop);
    blockers.push(...converted.blockers);
    if (name === "reg") {
      properties.reg = regPropertyForParent(1, 0);
      continue;
    }
    if (name.startsWith("#")) {
      properties[name] = converted.schema;
      continue;
    }
    properties[name] = converted.schema;
    if (prop.valueShape !== "empty" && name !== "status") {
      // status is optional on many nodes
    }
  }

  if (spec.properties?.status) {
    required.add("status");
  }

  const allOf: Array<Record<string, unknown>> = [{ $ref: STANDARD_DEVICE_REF }];
  if (spec.commonRefs?.length) {
    for (const ref of spec.commonRefs) {
      const refSlug = ref.replace(/^wiseeff\//, "").replace(/\.yaml$/, "");
      allOf.push({ $ref: `http://devicetree.org/schemas/vendor/wiseeff/${slug(refSlug)}.yaml#` });
    }
  }

  const doc = {
    $schema: "http://devicetree.org/meta-schemas/core.yaml#",
    $id: `http://devicetree.org/schemas/vendor/wiseeff/${idSlug}.yaml#`,
    title: spec.title ?? compatible,
    description: `WiseEff vendor binding for ${compatible} (generated from vendor property schema).`,
    maintainers: ["WiseEff"],
    allOf,
    select: {
      properties: {
        compatible: {
          contains: { const: compatible }
        }
      },
      required: ["compatible"]
    },
    properties,
    required: [...required],
    additionalProperties: false,
    unevaluatedProperties: false
  };

  const body = `%YAML 1.2\n---\n${yaml.dump(doc, { lineWidth: 120, noRefs: true })}`;
  return {
    compatible,
    fileName: `${idSlug}.yaml`,
    body,
    blockers,
    source: "vendor"
  };
}

function parseSeedPropertiesForCompatible(seedDir: string, compatible: string): Record<string, VendorProperty> {
  const properties: Record<string, VendorProperty> = {
    compatible: { valueShape: "string-list", constraints: {} }
  };

  for (const name of readdirSync(seedDir).filter((entry) => entry.endsWith(".dts"))) {
    const text = readFileSync(join(seedDir, name), "utf8");
    const nodePattern = new RegExp(
      `compatible\\s*=\\s*"${compatible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?\\};`,
      "g"
    );
    for (const match of text.matchAll(nodePattern)) {
      const block = match[0] ?? "";
      for (const propMatch of block.matchAll(/([#a-zA-Z0-9_-]+)\s*=\s*([^;]+);/g)) {
        const propName = propMatch[1]!;
        const raw = propMatch[2]!.trim();
        if (propName === "compatible") continue;
        if (raw.startsWith("<&")) {
          const cells = (raw.match(/\s+/g) ?? []).length;
          properties[propName] = {
            valueShape: "mixed",
            exampleValue: raw,
            constraints: { cells: Math.max(1, cells) }
          };
        } else if (raw.startsWith("<")) {
          properties[propName] = { valueShape: "u32-array", exampleValue: raw, constraints: {} };
        } else if (raw.startsWith('"')) {
          properties[propName] = { valueShape: "string-list", exampleValue: raw, constraints: {} };
        } else if (raw === "") {
          properties[propName] = { valueShape: "empty", constraints: {} };
        }
      }
    }
  }

  return properties;
}

export function buildBindingForCompatible(
  compatible: string,
  vendorByCompatible: Map<string, VendorSpecDoc>,
  seedDir: string
): GeneratedBinding {
  if (/^wiseeff,gpio\d+$/i.test(compatible)) {
    return renderBindingFromVendorSpec(compatible, {
      title: compatible,
      compatible: [compatible],
      properties: GPIO_CONTROLLER_TEMPLATE
    });
  }

  const vendor = vendorByCompatible.get(compatible);
  if (vendor) {
    return renderBindingFromVendorSpec(compatible, vendor);
  }

  const derived = parseSeedPropertiesForCompatible(seedDir, compatible);
  const propCount = Object.keys(derived).length;
  if (propCount <= 1) {
    return {
      compatible,
      fileName: `${slug(compatible)}.yaml`,
      body: "",
      blockers: [`schema-blocker: no vendor spec and no seed properties for ${compatible}`],
      source: "seed-derived"
    };
  }

  return renderBindingFromVendorSpec(compatible, {
    title: compatible,
    compatible: [compatible],
    properties: derived,
    schemaBlockers: [`seed-derived schema for ${compatible} — review recommended`]
  });
}

export function loadVendorSpecs(vendorDir: string): Map<string, VendorSpecDoc> {
  const byCompatible = new Map<string, VendorSpecDoc>();
  for (const name of readdirSync(vendorDir).filter((entry) => entry.endsWith(".yaml"))) {
    const doc = yaml.load(readFileSync(join(vendorDir, name), "utf8")) as VendorSpecDoc;
    for (const value of doc.compatible ?? []) {
      byCompatible.set(value, doc);
    }
  }
  return byCompatible;
}

export function stableBindingsContentHash(files: Array<{ fileName: string; body: string }>): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    hash.update(file.fileName);
    hash.update("\0");
    hash.update(file.body);
    hash.update("\0");
  }
  return hash.digest("hex");
}
