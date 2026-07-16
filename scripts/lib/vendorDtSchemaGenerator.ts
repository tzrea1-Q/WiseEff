/**
 * Convert WiseEff vendor property specs into Linux dt-schema binding YAML.
 * Fail-closed: no blanket additionalProperties; no regex-derived release schemas.
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
    required?: boolean;
    description?: string;
  };
  documentation?: string;
};

export type VendorSpecDoc = {
  $id?: string;
  title?: string;
  compatible?: string[];
  commonRefs?: string[];
  childNodes?: string[];
  properties?: Record<string, VendorProperty>;
  required?: string[];
  schemaBlockers?: string[];
};

export type GeneratedBinding = {
  compatible: string;
  fileName: string;
  body: string;
  blockers: string[];
  source: "vendor" | "gpio-controller-template" | "missing";
};

const GPIO_CONTROLLER_TEMPLATE: Record<string, VendorProperty> = {
  compatible: { valueShape: "string-list", constraints: {} },
  "gpio-controller": { valueShape: "empty", constraints: {} },
  "#gpio-cells": {
    valueShape: "u32-array",
    exampleValue: "<2>",
    constraints: { minItems: 1, maxItems: 1 }
  },
  status: {
    valueShape: "string-list",
    constraints: { enum: ["okay", "disabled", "reserved", "fail", "fail-needs-probe"] }
  }
};

const KNOWN_SHAPES = new Set([
  "string-list",
  "u32-array",
  "phandle-list",
  "mixed",
  "bytes",
  "empty",
  "boolean",
  "bool",
  "child-node"
]);

/** Bus / bridge nodes whose children use @unit-address names in seed DTS. */
const ADDRESSED_CHILD_CONTAINERS = new Set([
  "wiseeff,board",
  "wiseeff,amba",
  "arm,amba-bus",
  "wiseeff,spmi",
  "wiseeff,spmi1"
]);

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root";
}

function cellsConstFromExample(exampleValue: string | undefined): number | null {
  const match = (exampleValue ?? "").match(/<\s*(\d+)\s*>/);
  return match ? Number(match[1]) : null;
}

/**
 * Map WiseEff valueShape → dtschema property schema.
 * Unknown shapes / comment-only stubs are hard blockers.
 */
export function propertyToDtSchema(
  name: string,
  prop: VendorProperty
): { schema: Record<string, unknown> | null; blockers: string[] } {
  const blockers: string[] = [];
  const constraints = prop.constraints ?? {};

  if (!KNOWN_SHAPES.has(prop.valueShape)) {
    blockers.push(`schema-blocker: unknown valueShape ${prop.valueShape} for ${name}`);
    return { schema: null, blockers };
  }

  switch (prop.valueShape) {
    case "child-node":
      return { schema: { type: "object" }, blockers };
    case "string-list": {
      if (constraints.enum?.length) {
        return {
          schema: {
            allOf: [
              { $ref: "/schemas/types.yaml#/definitions/non-unique-string-array" },
              { enum: constraints.enum }
            ]
          },
          blockers
        };
      }
      return {
        schema: { $ref: "/schemas/types.yaml#/definitions/non-unique-string-array" },
        blockers
      };
    }
    case "u32-array": {
      if (name.startsWith("#") && name.endsWith("-cells")) {
        const constValue = cellsConstFromExample(prop.exampleValue);
        if (constValue != null) {
          return {
            schema: {
              allOf: [
                { $ref: "/schemas/types.yaml#/definitions/uint32" },
                { const: constValue }
              ]
            },
            blockers
          };
        }
        return {
          schema: { $ref: "/schemas/types.yaml#/definitions/uint32" },
          blockers
        };
      }
      const schema: Record<string, unknown> = {
        $ref: "/schemas/types.yaml#/definitions/uint32-array"
      };
      if (constraints.minItems != null) schema.minItems = constraints.minItems;
      if (constraints.maxItems != null) schema.maxItems = constraints.maxItems;
      return { schema, blockers };
    }
    case "phandle-list":
      return {
        schema: { $ref: "/schemas/types.yaml#/definitions/phandle-array" },
        blockers
      };
    case "mixed": {
      const example = prop.exampleValue ?? "";
      if (example.includes("&") || (constraints.cells ?? 0) > 0) {
        const cellCount = constraints.cells ?? 0;
        if (cellCount > 0) {
          return {
            schema: {
              allOf: [
                { $ref: "/schemas/types.yaml#/definitions/phandle-array" },
                {
                  items: {
                    minItems: cellCount,
                    maxItems: cellCount
                  }
                }
              ]
            },
            blockers
          };
        }
        return {
          schema: { $ref: "/schemas/types.yaml#/definitions/phandle-array" },
          blockers
        };
      }
      if (/<\s*\d/.test(example) && example.includes(",")) {
        return {
          schema: { $ref: "/schemas/types.yaml#/definitions/uint32-matrix" },
          blockers
        };
      }
      if (/<\s*\d/.test(example)) {
        return {
          schema: { $ref: "/schemas/types.yaml#/definitions/uint32-array" },
          blockers
        };
      }
      blockers.push(`schema-blocker: mixed property ${name} without phandle/cells evidence`);
      return { schema: null, blockers };
    }
    case "bytes":
      return {
        schema: { $ref: "/schemas/types.yaml#/definitions/uint8-array" },
        blockers
      };
    case "empty":
    case "boolean":
    case "bool":
      return {
        schema: { $ref: "/schemas/types.yaml#/definitions/flag" },
        blockers
      };
    default:
      blockers.push(`schema-blocker: unhandled valueShape ${prop.valueShape} for ${name}`);
      return { schema: null, blockers };
  }
}

function regSchema(): Record<string, unknown> {
  return { maxItems: 1 };
}

function mergeCommonRefProperties(
  spec: VendorSpecDoc,
  vendorDir: string,
  properties: Record<string, unknown>
): void {
  for (const ref of spec.commonRefs ?? []) {
    const refPath = join(vendorDir, ref.replace(/^wiseeff\//, ""));
    const common = yaml.load(readFileSync(refPath, "utf8")) as VendorSpecDoc;
    for (const [name, prop] of Object.entries(common.properties ?? {})) {
      if (name in properties) continue;
      const converted = propertyToDtSchema(name, prop);
      if (converted.schema) properties[name] = converted.schema;
    }
  }
}

function buildVendorProperties(
  compatible: string,
  spec: VendorSpecDoc,
  vendorDir: string | null
): {
  properties: Record<string, unknown>;
  blockers: string[];
  required: Set<string>;
} {
  const blockers: string[] = [];
  const properties: Record<string, unknown> = {};
  const required = new Set<string>(spec.required?.length ? spec.required : ["compatible"]);

  if (vendorDir) {
    mergeCommonRefProperties(spec, vendorDir, properties);
  }

  for (const [name, prop] of Object.entries(spec.properties ?? {})) {
    if (name === "compatible") continue;
    const converted = propertyToDtSchema(name, prop);
    blockers.push(...converted.blockers);
    if (!converted.schema) continue;

    if (name === "reg") {
      properties.reg = regSchema();
    } else {
      properties[name] = converted.schema;
    }

    if (prop.constraints?.required === true) {
      required.add(name);
    }
  }

  for (const child of spec.childNodes ?? []) {
    properties[child] = { type: "object" };
  }

  properties.compatible = { contains: { const: compatible } };

  if (!spec.required?.includes("status")) {
    required.delete("status");
  }
  required.add("compatible");

  return { properties, blockers, required };
}

export function renderBindingFromVendorSpec(
  compatible: string,
  spec: VendorSpecDoc,
  source: GeneratedBinding["source"] = "vendor",
  vendorDir: string | null = null
): GeneratedBinding {
  const idSlug = slug(compatible);
  const blockers = [...(spec.schemaBlockers ?? [])];
  const { properties, blockers: propBlockers, required } = buildVendorProperties(
    compatible,
    spec,
    vendorDir
  );
  blockers.push(...propBlockers);

  if (blockers.some((b) => b.startsWith("schema-blocker:"))) {
    return {
      compatible,
      fileName: `${idSlug}.yaml`,
      body: "",
      blockers,
      source
    };
  }

  const doc: Record<string, unknown> = {
    $schema: "http://devicetree.org/meta-schemas/core.yaml#",
    $id: `http://devicetree.org/schemas/vendor/wiseeff/${idSlug}.yaml#`,
    title: spec.title ?? compatible,
    description: `WiseEff vendor binding for ${compatible} (generated from vendor property schema).`,
    maintainers: ["WiseEff"]
  };

  const isGpio = source === "gpio-controller-template";
  const isAddressedContainer = ADDRESSED_CHILD_CONTAINERS.has(compatible);

  if (isGpio) {
    const cellsConst = cellsConstFromExample(spec.properties?.["#gpio-cells"]?.exampleValue) ?? 2;
    doc.allOf = [
      { $ref: "/schemas/gpio/gpio.yaml#" },
      {
        type: "object",
        properties: {
          compatible: properties.compatible,
          "#gpio-cells": { const: cellsConst },
          ...(properties.status ? { status: properties.status } : {})
        },
        required: ["compatible"],
        additionalProperties: false,
        unevaluatedProperties: false
      }
    ];
  } else {
    doc.properties = properties;
    doc.required = [...required].sort();
    doc.additionalProperties = false;
    doc.unevaluatedProperties = false;

    if (isAddressedContainer) {
      doc.patternProperties = {
        "^.*@[0-9a-fA-F]+$": { type: "object" }
      };
    }
  }

  const body = `%YAML 1.2\n---\n${yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })}`;
  return {
    compatible,
    fileName: `${idSlug}.yaml`,
    body,
    blockers,
    source
  };
}

export function buildBindingForCompatible(
  compatible: string,
  vendorByCompatible: Map<string, VendorSpecDoc>,
  vendorDir: string | null = null
): GeneratedBinding {
  if (/^wiseeff,gpio\d+$/i.test(compatible)) {
    return renderBindingFromVendorSpec(
      compatible,
      {
        title: compatible,
        compatible: [compatible],
        properties: GPIO_CONTROLLER_TEMPLATE
      },
      "gpio-controller-template",
      vendorDir
    );
  }

  const vendor = vendorByCompatible.get(compatible);
  if (!vendor) {
    return {
      compatible,
      fileName: `${slug(compatible)}.yaml`,
      body: "",
      blockers: [`schema-blocker: missing vendor schema for ${compatible}`],
      source: "missing"
    };
  }

  return renderBindingFromVendorSpec(compatible, vendor, "vendor", vendorDir);
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

export function collectReleaseCompatibles(seedDir: string, vendorByCompatible: Map<string, VendorSpecDoc>): string[] {
  const found = new Set<string>(vendorByCompatible.keys());
  for (const name of readdirSync(seedDir).filter((entry) => entry.endsWith(".dts"))) {
    const text = readFileSync(join(seedDir, name), "utf8");
    for (const match of text.matchAll(/compatible\s*=\s*"([^"]+)"/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
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

export function manifestGeneratedAt(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH?.trim();
  if (epoch && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  return "1970-01-01T00:00:00.000Z";
}
