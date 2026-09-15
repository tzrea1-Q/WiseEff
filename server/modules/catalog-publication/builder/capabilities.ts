/**
 * Page allow-list aligned with historical spec-editor / DTS value shapes.
 *
 * Accepts the D1 vendorValueSchemaFor mapping (bool, empty, string-list,
 * u32-array, phandle-list, bytes, mixed) plus the original scalar integer/
 * number/string schemas. Units are non-empty short strings (mV, µA, …).
 * `$ref`, pattern, and format stay forbidden.
 */
import type { Result } from "../../parameter-catalog-contract/index";

import type {
  BuildCompleteSuccessorError,
  CapabilityAllowListIdentity,
  SupportedDefinitionContent,
  SupportedValueSchema,
} from "./types";
import {
  CATALOG_CAPABILITY_ALLOW_LIST_ID,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  M1_ALLOWED_UNITS,
  M1_VALUE_SCHEMA_TYPES,
  MAX_DEFINITION_UNIT_CHARS,
} from "./types";

export { CATALOG_CAPABILITY_CONTRACT_REVISION };

export const CATALOG_CAPABILITY_ALLOW_LIST: CapabilityAllowListIdentity = {
  revision: CATALOG_CAPABILITY_CONTRACT_REVISION,
  id: CATALOG_CAPABILITY_ALLOW_LIST_ID,
  valueTypes: M1_VALUE_SCHEMA_TYPES,
  units: M1_ALLOWED_UNITS,
  jsonSchemaKeywords: {
    integer: ["type", "minimum", "maximum"],
    number: ["type", "minimum", "maximum"],
    string: ["type"],
    boolean: ["type"],
    null: ["type"],
    array: ["type", "items"],
  },
  budgets: {
    maxDisplayNameChars: 128,
    maxDocumentationChars: 8192,
    maxDescriptionChars: 512,
    maxExamples: 8,
    maxChangeSetOps: 32,
  },
};

const CONTENT_KEYS = new Set([
  "displayName",
  "documentation",
  "description",
  "unit",
  "valueSchema",
  "examples",
]);
const INTEGER_SCHEMA_KEYS = new Set(["type", "minimum", "maximum"]);
const NUMBER_SCHEMA_KEYS = new Set(["type", "minimum", "maximum"]);
const STRING_SCHEMA_KEYS = new Set(["type"]);
const BOOLEAN_SCHEMA_KEYS = new Set(["type"]);
const NULL_SCHEMA_KEYS = new Set(["type"]);
const ARRAY_SCHEMA_KEYS = new Set(["type", "items"]);
const ARRAY_ITEM_KEYS = new Set(["type", "minimum", "maximum"]);
const MIXED_SCHEMA_KEYS = new Set(["description"]);
const DOCUMENTATION_FORBIDDEN = /[\u0000\u007F-\u009F]/u;

const ok = <T>(value: T): Result<T, BuildCompleteSuccessorError> => ({ ok: true, value });

const capabilityFail = (
  detail: string,
  path: string,
): Result<never, BuildCompleteSuccessorError> => ({
  ok: false,
  error: { kind: "unsupported-catalog-capability", detail, path },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const extraKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] =>
  Object.keys(value).filter((key) => !allowed.has(key)).sort();

const isContractDisplayName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);

const isIntegerNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value);

export const capabilityAllowListIdentity = (): CapabilityAllowListIdentity =>
  CATALOG_CAPABILITY_ALLOW_LIST;

const validateBounds = (
  schema: Record<string, unknown>,
  path: string,
  requireIntegerBounds: boolean,
): Result<{ minimum?: number; maximum?: number }, BuildCompleteSuccessorError> => {
  const minimum = schema.minimum;
  const maximum = schema.maximum;
  if (minimum !== undefined) {
    if (requireIntegerBounds ? !isIntegerNumber(minimum) : !isFiniteNumber(minimum)) {
      return capabilityFail("invalid-numeric-bound", `${path}.minimum`);
    }
  }
  if (maximum !== undefined) {
    if (requireIntegerBounds ? !isIntegerNumber(maximum) : !isFiniteNumber(maximum)) {
      return capabilityFail("invalid-numeric-bound", `${path}.maximum`);
    }
  }
  if (
    isFiniteNumber(minimum) &&
    isFiniteNumber(maximum) &&
    minimum > maximum
  ) {
    return capabilityFail("invalid-numeric-bound", `${path}.minimum`);
  }
  return ok({
    ...(minimum !== undefined ? { minimum: minimum as number } : {}),
    ...(maximum !== undefined ? { maximum: maximum as number } : {}),
  });
};

const validateValueSchema = (
  value: unknown,
  path: string,
): Result<SupportedValueSchema, BuildCompleteSuccessorError> => {
  if (!isRecord(value)) {
    return capabilityFail("unsupported-value-schema-type", path);
  }
  if ("$ref" in value || "$dynamicRef" in value) {
    return capabilityFail("json-schema-ref-forbidden", path);
  }
  const type = value.type;
  if (type === "integer") {
    const extras = extraKeys(value, INTEGER_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    const bounds = validateBounds(value, path, true);
    if (!bounds.ok) return bounds;
    return ok({ type: "integer", ...bounds.value });
  }
  if (type === "number") {
    const extras = extraKeys(value, NUMBER_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    const bounds = validateBounds(value, path, false);
    if (!bounds.ok) return bounds;
    return ok({ type: "number", ...bounds.value });
  }
  if (type === "string") {
    const extras = extraKeys(value, STRING_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "string" });
  }
  if (type === "boolean") {
    const extras = extraKeys(value, BOOLEAN_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "boolean" });
  }
  if (type === "null") {
    const extras = extraKeys(value, NULL_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "null" });
  }
  if (type === "array") {
    const extras = extraKeys(value, ARRAY_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    if (value.items === undefined) {
      return ok({ type: "array" });
    }
    if (!isRecord(value.items)) {
      return capabilityFail("unsupported-value-schema-type", `${path}.items`);
    }
    const itemExtras = extraKeys(value.items, ARRAY_ITEM_KEYS);
    if (itemExtras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.items.${itemExtras[0]}`);
    }
    if (value.items.type === "string") {
      if (value.items.minimum !== undefined || value.items.maximum !== undefined) {
        return capabilityFail("unknown-json-schema-keyword", `${path}.items`);
      }
      return ok({ type: "array", items: { type: "string" } });
    }
    if (value.items.type === "integer") {
      const bounds = validateBounds(value.items, `${path}.items`, true);
      if (!bounds.ok) return bounds;
      return ok({ type: "array", items: { type: "integer", ...bounds.value } });
    }
    return capabilityFail("unsupported-value-schema-type", `${path}.items`);
  }
  if (type === undefined && typeof value.description === "string") {
    const extras = extraKeys(value, MIXED_SCHEMA_KEYS);
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    if (value.description.trim().length === 0) {
      return capabilityFail("unsupported-value-schema-type", path);
    }
    return ok({ description: value.description });
  }
  return capabilityFail("unsupported-value-schema-type", path);
};

const exampleMatchesSchema = (
  schema: SupportedValueSchema,
  example: unknown,
): boolean => {
  if (!("type" in schema)) {
    return true;
  }
  if (schema.type === "integer") {
    if (!isIntegerNumber(example)) return false;
    if (schema.minimum !== undefined && example < schema.minimum) return false;
    if (schema.maximum !== undefined && example > schema.maximum) return false;
    return true;
  }
  if (schema.type === "number") {
    if (!isFiniteNumber(example)) return false;
    if (schema.minimum !== undefined && example < schema.minimum) return false;
    if (schema.maximum !== undefined && example > schema.maximum) return false;
    return true;
  }
  if (schema.type === "boolean") {
    return typeof example === "boolean";
  }
  if (schema.type === "null") {
    return example === null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(example)) return false;
    const items = schema.items;
    if (!items) return true;
    return example.every((entry) => exampleMatchesSchema(items, entry));
  }
  return typeof example === "string";
};

export const validateSupportedDefinitionContent = (
  content: unknown,
  path: string,
): Result<SupportedDefinitionContent, BuildCompleteSuccessorError> => {
  if (!isRecord(content)) {
    return capabilityFail("definition-content-not-object", path);
  }
  const extras = extraKeys(content, CONTENT_KEYS);
  if (extras.length > 0) {
    return capabilityFail("unknown-field", `${path}.${extras[0]}`);
  }
  const displayName =
    typeof content.displayName === "string" ? content.displayName.trim() : content.displayName;
  if (!isContractDisplayName(displayName)) {
    return capabilityFail("invalid-display-name", `${path}.displayName`);
  }
  if (displayName.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDisplayNameChars) {
    return capabilityFail("resource-budget-exceeded", `${path}.displayName`);
  }
  if (typeof content.documentation !== "string") {
    return capabilityFail("invalid-documentation", `${path}.documentation`);
  }
  if (
    DOCUMENTATION_FORBIDDEN.test(content.documentation) ||
    content.documentation.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDocumentationChars
  ) {
    return capabilityFail(
      content.documentation.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDocumentationChars
        ? "resource-budget-exceeded"
        : "invalid-documentation",
      `${path}.documentation`,
    );
  }
  let description: string | undefined;
  if (content.description !== undefined) {
    const candidate = content.description;
    if (typeof candidate !== "string") {
      return capabilityFail("invalid-documentation", `${path}.description`);
    }
    if (candidate.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDescriptionChars) {
      return capabilityFail("resource-budget-exceeded", `${path}.description`);
    }
    if (DOCUMENTATION_FORBIDDEN.test(candidate)) {
      return capabilityFail("invalid-documentation", `${path}.description`);
    }
    description = candidate;
  }
  let unit: string | undefined;
  if (content.unit !== undefined) {
    if (
      typeof content.unit !== "string" ||
      content.unit.trim().length === 0 ||
      content.unit.trim() !== content.unit ||
      content.unit.length > MAX_DEFINITION_UNIT_CHARS ||
      DOCUMENTATION_FORBIDDEN.test(content.unit)
    ) {
      return capabilityFail("unsupported-unit", `${path}.unit`);
    }
    unit = content.unit;
  }
  const schema = validateValueSchema(content.valueSchema, `${path}.valueSchema`);
  if (!schema.ok) return schema;
  let examples: readonly (number | string | boolean | null)[] | undefined;
  if (content.examples !== undefined) {
    if (!Array.isArray(content.examples)) {
      return capabilityFail("invalid-examples", `${path}.examples`);
    }
    if (content.examples.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxExamples) {
      return capabilityFail("resource-budget-exceeded", `${path}.examples`);
    }
    for (const [index, example] of content.examples.entries()) {
      if (!exampleMatchesSchema(schema.value, example)) {
        return capabilityFail("example-does-not-match-schema", `${path}.examples[${index}]`);
      }
    }
    examples = content.examples as readonly (number | string | boolean | null)[];
  }
  return ok({
    displayName,
    documentation: content.documentation,
    ...(description !== undefined ? { description } : {}),
    ...(unit !== undefined ? { unit } : {}),
    valueSchema: schema.value,
    ...(examples !== undefined ? { examples } : {}),
  });
};
