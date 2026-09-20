import { describe, expect, it } from "vitest";

import {
  CATALOG_CAPABILITY_ALLOW_LIST,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  CATALOG_CAPABILITY_V3_ALLOW_LIST,
  CATALOG_CAPABILITY_V3_REVISION,
  capabilityAllowListIdentity,
  validateSupportedDefinitionContent,
  validateSupportedDefinitionContentAt,
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

  it("accepts historical DTS/spec shapes including boolean, arrays, mixed, and multiline docs", () => {
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: " Flag ",
          documentation: "Line one.\nLine two.",
          valueSchema: { type: "boolean" },
          examples: [true],
        },
        "content",
      ),
    ).toMatchObject({
      ok: true,
      value: { displayName: "Flag", valueSchema: { type: "boolean" } },
    });
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "Names",
          documentation: "x",
          valueSchema: { type: "array", items: { type: "string" } },
          examples: [["a", "b"]],
        },
        "content",
      ).ok,
    ).toBe(true);
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "Cells",
          documentation: "x",
          unit: "µA",
          valueSchema: { type: "array", items: { type: "integer", minimum: 0 } },
        },
        "content",
      ).ok,
    ).toBe(true);
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "Mixed",
          documentation: "x",
          valueSchema: { description: "mixed" },
        },
        "content",
      ).ok,
    ).toBe(true);
  });

  it("rejects $ref, pattern, and format instead of dropping them", () => {
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
        unit: `${"u".repeat(40)}`,
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
    expect(CATALOG_CAPABILITY_CONTRACT_REVISION).toBe("catalog-capability/v4");
    expect(CATALOG_CAPABILITY_V3_ALLOW_LIST.revision).toBe(CATALOG_CAPABILITY_V3_REVISION);
    expect(CATALOG_CAPABILITY_V3_ALLOW_LIST.budgets.maxChangeSetOps).toBe(32);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps).toBe(128);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.units).toEqual(["non-empty-short-string"]);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.valueTypes).toEqual([
      "integer",
      "number",
      "string",
      "boolean",
      "null",
      "array",
    ]);
    expect(CATALOG_CAPABILITY_ALLOW_LIST.jsonSchemaKeywords.array).toEqual([
      "type",
      "items",
      "description",
      "minItems",
      "maxItems",
    ]);
  });

  const nestedMatrix = {
    displayName: "Profile matrix",
    documentation: "Nested string rows.",
    valueSchema: {
      type: "array",
      description: "unbounded rows",
      items: { type: "array", items: { type: "string" } },
    },
    examples: [
      [
        ["0", "5000"],
        ["1", "9000"],
      ],
    ],
  };

  it("accepts nested arrays, mixed items, array description, and metadata cardinality", () => {
    expect(validateSupportedDefinitionContent(nestedMatrix, "content")).toMatchObject({
      ok: true,
      value: {
        valueSchema: {
          type: "array",
          description: "unbounded rows",
          items: { type: "array", items: { type: "string" } },
        },
      },
    });
    expect(
      validateSupportedDefinitionContent(
        {
          displayName: "GPIO specifier",
          documentation: "x",
          valueSchema: {
            type: "array",
            description: "phandle pin flags",
            items: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { description: "mixed" },
            },
          },
        },
        "content",
      ).ok,
    ).toBe(true);
  });

  it("keeps v3 meaning: frozen v3 allow-list rejects nested arrays and array cardinality", () => {
    const nested = validateSupportedDefinitionContentAt(
      {
        displayName: "Profile matrix",
        documentation: "Nested string rows.",
        valueSchema: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
        },
      },
      "content",
      CATALOG_CAPABILITY_V3_ALLOW_LIST,
    );
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(["unsupported-value-schema-type", "unknown-json-schema-keyword"]).toContain(
        nested.error.detail,
      );
    }
    const withMinItems = validateSupportedDefinitionContentAt(
      {
        displayName: "Cells",
        documentation: "x",
        valueSchema: { type: "array", minItems: 3, items: { type: "integer" } },
      },
      "content",
      CATALOG_CAPABILITY_V3_ALLOW_LIST,
    );
    expect(withMinItems.ok).toBe(false);
    if (!withMinItems.ok) {
      expect(withMinItems.error).toMatchObject({
        detail: "unknown-json-schema-keyword",
        path: "content.valueSchema.minItems",
      });
    }
  });

  it("does not infer cardinality from example row counts", () => {
    const result = validateSupportedDefinitionContent(
      {
        displayName: "Observed matrix",
        documentation: "x",
        valueSchema: { type: "array", items: { type: "array", items: { type: "string" } } },
        examples: [
          [
            ["a", "b", "c", "d", "e"],
            ["f", "g", "h", "i", "j"],
            ["k", "l", "m", "n", "o"],
          ],
        ],
      },
      "content",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valueSchema).toEqual({
      type: "array",
      items: { type: "array", items: { type: "string" } },
    });
  });

  it("fail-closes unknown array keywords and over-budget nesting", () => {
    const prefixItems = validateSupportedDefinitionContent(
      {
        displayName: "Bad",
        documentation: "x",
        valueSchema: { type: "array", prefixItems: [{ type: "string" }] },
      },
      "content",
    );
    expect(prefixItems.ok).toBe(false);
    if (!prefixItems.ok) {
      expect(prefixItems.error).toMatchObject({
        detail: "unknown-json-schema-keyword",
        path: "content.valueSchema.prefixItems",
      });
    }

    let schema: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 5; depth += 1) {
      schema = { type: "array", items: schema };
    }
    const deep = validateSupportedDefinitionContent(
      { displayName: "Deep", documentation: "x", valueSchema: schema },
      "content",
    );
    expect(deep.ok).toBe(false);
    if (!deep.ok) {
      expect(deep.error.detail).toBe("resource-budget-exceeded");
    }
  });
});
