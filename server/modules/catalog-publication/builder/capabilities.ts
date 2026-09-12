/**
 * M1 page allow-list: narrower than the vendor compiler.
 *
 * Proven consumers:
 * - acme fixture valueSchema `{ type: "integer", minimum: 0 }` and unit `mA`
 * - runtime snapshot copies valueSchema/unit/examples as opaque json-schema content
 * - ProjectValue stores string/number payloads and does not interpret format, pattern, or $ref
 * - vendor YAML already stores units mV/ms/uOhm as catalog unit strings
 *
 * Unknown fields fail closed. Mixed/boolean/array vendor shapes stay compiler-only.
 */
import type { Result } from "../../parameter-catalog-contract/index";

import type {
  BuildCompleteSuccessorError,
  CapabilityAllowListIdentity,
  M1AllowedUnit,
  SupportedDefinitionContent,
  SupportedValueSchema,
} from "./types";
import {
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  M1_ALLOWED_UNITS,
  M1_VALUE_SCHEMA_TYPES,
} from "./types";

export { CATALOG_CAPABILITY_CONTRACT_REVISION };

export const CATALOG_CAPABILITY_ALLOW_LIST: CapabilityAllowListIdentity = {
  revision: CATALOG_CAPABILITY_CONTRACT_REVISION,
  id: "page-m1-definition-content",
  valueTypes: M1_VALUE_SCHEMA_TYPES,
  units: M1_ALLOWED_UNITS,
  jsonSchemaKeywords: {
    integer: ["type", "minimum", "maximum"],
    number: ["type", "minimum", "maximum"],
    string: ["type"],
  },
  budgets: {
    maxDisplayNameChars: 128,
    maxDocumentationChars: 8192,
    maxExamples: 8,
    maxChangeSetOps: 32,
  },
};

const CONTENT_KEYS = new Set(["displayName", "documentation", "unit", "valueSchema", "examples"]);
const INTEGER_SCHEMA_KEYS = new Set(["type", "minimum", "maximum"]);
const NUMBER_SCHEMA_KEYS = new Set(["type", "minimum", "maximum"]);
const STRING_SCHEMA_KEYS = new Set(["type"]);
const UNITS = new Set<string>(M1_ALLOWED_UNITS);

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
  return capabilityFail("unsupported-value-schema-type", path);
};

const exampleMatchesSchema = (
  schema: SupportedValueSchema,
  example: unknown,
): boolean => {
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
  if (!isContractDisplayName(content.displayName)) {
    return capabilityFail("invalid-display-name", `${path}.displayName`);
  }
  if (content.displayName.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDisplayNameChars) {
    return capabilityFail("resource-budget-exceeded", `${path}.displayName`);
  }
  if (typeof content.documentation !== "string") {
    return capabilityFail("invalid-documentation", `${path}.documentation`);
  }
  if (
    /[\u0000-\u001F\u007F-\u009F]/u.test(content.documentation) ||
    content.documentation.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDocumentationChars
  ) {
    return capabilityFail(
      content.documentation.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxDocumentationChars
        ? "resource-budget-exceeded"
        : "invalid-documentation",
      `${path}.documentation`,
    );
  }
  let unit: M1AllowedUnit | undefined;
  if (content.unit !== undefined) {
    if (typeof content.unit !== "string" || !UNITS.has(content.unit)) {
      return capabilityFail("unsupported-unit", `${path}.unit`);
    }
    unit = content.unit as M1AllowedUnit;
  }
  const schema = validateValueSchema(content.valueSchema, `${path}.valueSchema`);
  if (!schema.ok) return schema;
  let examples: readonly (number | string)[] | undefined;
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
    examples = content.examples as readonly (number | string)[];
  }
  return ok({
    displayName: content.displayName,
    documentation: content.documentation,
    ...(unit !== undefined ? { unit } : {}),
    valueSchema: schema.value,
    ...(examples !== undefined ? { examples } : {}),
  });
};
