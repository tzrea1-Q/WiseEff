import { describe, expect, it } from "vitest";

import {
  CATALOG_CAPABILITY_ALLOW_LIST,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  capabilityAllowListIdentity,
  validateSupportedDefinitionContent,
} from "./capabilities";

describe("catalog publication capability allow-list", () => {
  it("accepts the acme fixture integer schema with unit mA", () => {
    const result = validateSupportedDefinitionContent(
      {
        displayName: "Input current limit",
        documentation: "Maximum accepted input current.",
        unit: "mA",
        valueSchema: { type: "integer", minimum: 0 },
        examples: [0],
      },
      "change[0].content",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        displayName: "Input current limit",
        documentation: "Maximum accepted input current.",
        unit: "mA",
        valueSchema: { type: "integer", minimum: 0 },
        examples: [0],
      },
    });
  });

  it("accepts number and string schemas the ProjectValue payload kinds already store", () => {
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "Voltage",
          documentation: "Measured voltage.",
          unit: "mV",
          valueSchema: { type: "number", minimum: 0, maximum: 5000 },
        },
        "content",
      ).ok,
    ).toBe(true);
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "Label",
          documentation: "",
          valueSchema: { type: "string" },
          examples: ["acme"],
        },
        "content",
      ).ok,
    ).toBe(true);
  });

  it("rejects unknown JSON Schema keywords instead of dropping them", () => {
    const result = validateSupportedDefinitionContent(
      {
        displayName: "Input current limit",
        documentation: "Maximum accepted input current.",
        valueSchema: { type: "integer", minimum: 0, exclusiveMinimum: 0 },
      },
      "content",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "unsupported-catalog-capability",
      detail: "unknown-json-schema-keyword",
      path: "content.valueSchema.exclusiveMinimum",
    });
  });

  it("rejects $ref, pattern, format, mixed, and boolean vendor shapes", () => {
    const cases: readonly { content: unknown; detail: string }[] = [
      {
        content: {
          displayName: "Ref",
          documentation: "x",
          valueSchema: { $ref: "#/$defs/value" },
        },
        detail: "json-schema-ref-forbidden",
      },
      {
        content: {
          displayName: "Pattern",
          documentation: "x",
          valueSchema: { type: "string", pattern: "^[0-9]+$" },
        },
        detail: "unknown-json-schema-keyword",
      },
      {
        content: {
          displayName: "Format",
          documentation: "x",
          valueSchema: { type: "string", format: "uri" },
        },
        detail: "unknown-json-schema-keyword",
      },
      {
        content: {
          displayName: "Mixed",
          documentation: "x",
          valueSchema: { description: "mixed" },
        },
        detail: "unsupported-value-schema-type",
      },
      {
        content: {
          displayName: "Flag",
          documentation: "x",
          valueSchema: { type: "boolean" },
        },
        detail: "unsupported-value-schema-type",
      },
    ];
    for (const entry of cases) {
      const result = validateSupportedDefinitionContent(entry.content, "content");
      expect(result.ok, entry.detail).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("unsupported-catalog-capability");
      expect(result.error.detail).toBe(entry.detail);
    }
  });

  it("rejects unknown content fields, units, and examples that miss the schema", () => {
    const extraField = validateSupportedDefinitionContent(
      {
        displayName: "Input current limit",
        documentation: "x",
        valueSchema: { type: "integer", minimum: 0 },
        matching: { sourceProperty: "iin_max" },
      },
      "content",
    );
    expect(extraField.ok).toBe(false);
    if (!extraField.ok) {
      expect(extraField.error.detail).toBe("unknown-field");
    }

    const unit = validateSupportedDefinitionContent(
      {
        displayName: "Input current limit",
        documentation: "x",
        unit: "amperes",
        valueSchema: { type: "integer", minimum: 0 },
      },
      "content",
    );
    expect(unit.ok).toBe(false);
    if (!unit.ok) {
      expect(unit.error.detail).toBe("unsupported-unit");
    }

    const examples = validateSupportedDefinitionContent(
      {
        displayName: "Input current limit",
        documentation: "x",
        valueSchema: { type: "integer", minimum: 0 },
        examples: [-1],
      },
      "content",
    );
    expect(examples.ok).toBe(false);
    if (!examples.ok) {
      expect(examples.error.detail).toBe("example-does-not-match-schema");
    }
  });

  it("rejects over-budget display names and example lists", () => {
    const name = validateSupportedDefinitionContent(
      {
        displayName: "n".repeat(CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDisplayNameChars + 1),
        documentation: "x",
        valueSchema: { type: "integer" },
      },
      "content",
    );
    expect(name.ok).toBe(false);
    if (!name.ok) {
      expect(name.error.detail).toBe("resource-budget-exceeded");
    }
  });

  it("publishes a frozen allow-list identity for the capability contract", () => {
    expect(capabilityAllowListIdentity().revision).toBe(
      CATALOG_CAPABILITY_CONTRACT_REVISION,
    );
    expect(capabilityAllowListIdentity()).toEqual(CATALOG_CAPABILITY_ALLOW_LIST);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.units).toEqual(["mA", "mV", "ms", "uOhm"]);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.valueTypes).toEqual([
      "integer",
      "number",
      "string",
    ]);
  });
});
