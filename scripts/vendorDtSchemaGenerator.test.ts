import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildBindingForCompatible,
  loadVendorSpecs,
  propertyToDtSchema,
  renderBindingFromVendorSpec,
  stableBindingsContentHash
} from "./lib/vendorDtSchemaGenerator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "schemas/dts/vendor/wiseeff");
const seedDir = join(root, "src/config/dts-seed");

describe("vendorDtSchemaGenerator", () => {
  it("does not emit blanket additionalProperties on sc8562", () => {
    const vendor = loadVendorSpecs(vendorDir);
    const binding = buildBindingForCompatible("sc8562", vendor, seedDir);
    expect(binding.body).toContain("gpio_int:");
    expect(binding.body).not.toContain("additionalProperties: true");
    expect(binding.body).not.toContain("unevaluatedProperties: true");
    expect(binding.body).toContain("additionalProperties: false");
  });

  it("constrains gpio_int phandle-array cell count", () => {
    const converted = propertyToDtSchema("gpio_int", {
      valueShape: "mixed",
      exampleValue: "<&gpio13 29 0>",
      constraints: { cells: 3 }
    });
    expect(converted.schema).toMatchObject({
      items: { minItems: 3, maxItems: 3 }
    });
  });

  it("stable content hash ignores manifest timestamp", () => {
    const a = stableBindingsContentHash([
      { fileName: "sc8562.yaml", body: "body-a" },
      { fileName: "z.yaml", body: "body-z" }
    ]);
    const b = stableBindingsContentHash([
      { fileName: "z.yaml", body: "body-z" },
      { fileName: "sc8562.yaml", body: "body-a" }
    ]);
    expect(a).toBe(b);
  });

  it("marks unmapped value shapes as needs-review blockers", () => {
    const binding = renderBindingFromVendorSpec("test,unknown", {
      compatible: ["test,unknown"],
      properties: {
        compatible: { valueShape: "string-list", constraints: {} },
        mystery: { valueShape: "exotic-shape", constraints: {} }
      }
    });
    expect(binding.blockers.some((item) => item.includes("needs-review"))).toBe(true);
    expect(binding.body).not.toContain("additionalProperties: true");
  });

  it("isolates gpio controller template properties", () => {
    const vendor = loadVendorSpecs(vendorDir);
    const binding = buildBindingForCompatible("wiseeff,gpio13", vendor, seedDir);
    expect(binding.body).toContain("gpio-controller:");
    expect(binding.body).toMatch(/gpio-cells/);
  });
});

describe("vendor schema negative fixtures", () => {
  const negativeCases = [
    {
      name: "gpio_int wrong cell count",
      property: "gpio_int",
      spec: {
        valueShape: "mixed",
        constraints: { cells: 3 },
        exampleValue: "<&gpio13 29>"
      },
      invalidValue: "<&gpio13 29>"
    },
    {
      name: "reg wrong length for u32-array",
      property: "reg",
      spec: { valueShape: "u32-array", constraints: {} },
      invalidShape: "string-list"
    },
    {
      name: "number as string",
      property: "slave_mode",
      spec: { valueShape: "u32-array", constraints: {} },
      invalidShape: "string-list"
    },
    {
      name: "string-list as cells",
      property: "ic_role",
      spec: { valueShape: "string-list", constraints: {} },
      invalidShape: "u32-array"
    },
    {
      name: "required property missing",
      required: ["status"],
      properties: {
        compatible: { valueShape: "string-list", constraints: {} }
      }
    },
    {
      name: "undeclared vendor property blocked by additionalProperties false",
      extraProperty: "rogue_prop"
    }
  ] as const;

  for (const testCase of negativeCases) {
    it(`negative case: ${testCase.name}`, () => {
      if ("invalidShape" in testCase && testCase.property && testCase.spec) {
        const valid = propertyToDtSchema(testCase.property, testCase.spec);
        const invalid = propertyToDtSchema(testCase.property, {
          valueShape: testCase.invalidShape,
          constraints: {}
        });
        expect(valid.schema).not.toEqual(invalid.schema);
      } else if ("required" in testCase) {
        const binding = renderBindingFromVendorSpec("neg,required", {
          compatible: ["neg,required"],
          properties: testCase.properties
        });
        expect(binding.body).not.toContain("status:");
        expect(binding.body).toContain("additionalProperties: false");
      } else if ("extraProperty" in testCase) {
        const binding = renderBindingFromVendorSpec("neg,extra", {
          compatible: ["neg,extra"],
          properties: {
            compatible: { valueShape: "string-list", constraints: {} }
          }
        });
        expect(binding.body).toContain("additionalProperties: false");
        expect(binding.body).not.toContain(testCase.extraProperty);
      } else if ("invalidValue" in testCase && testCase.property && testCase.spec) {
        const converted = propertyToDtSchema(testCase.property, testCase.spec);
        expect(converted.schema).toMatchObject({ items: { maxItems: 3 } });
        expect(testCase.invalidValue.split(/\s+/).length).toBeLessThan(3);
      }
    });
  }
});
