/**
 * Page allow-list aligned with historical spec-editor / DTS value shapes.
 *
 * v4 adds recursive/nested arrays, mixed item schemas, array-level description,
 * and metadata minItems/maxItems. v3 stays frozen so historical meaning does
 * not widen. `$ref`, pattern, and format stay forbidden.
 */
import type { ContractJsonValue, Result } from "../../parameter-catalog-contract/index";
import {
  catalogCompilerContractFingerprint, catalogCompilerDtsContract, catalogCompilerOwnerContractFingerprint,
  INSTALL_CHAIN_COMPILER, INSTALL_CHAIN_SOURCE_FORMAT,
} from "../../catalog-kernel/compiler/contract";
import { hashContractJson } from "../../parameter-catalog-contract/chunkedSerialization";
import type { CatalogReleaseSubjectDocument, CompiledCatalogReleaseModel } from "../../catalog-kernel/compiler/types";
import {
  dtsExampleIssue, exampleMatchesSchema, hasDtsExampleControlCharacters, MAX_DTS_EXAMPLE_CHARS,
  MAX_DTS_EXAMPLES, normalizeDtsExample,
} from "../../../../src/domain/parameter-catalog/dtsExamples";

import type {
  BuildCompleteSuccessorError,
  CapabilityAllowListIdentity,
  SupportedDefinitionContent,
  SupportedValueSchema,
} from "./types";
import {
  CATALOG_CAPABILITY_ALLOW_LIST_ID,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  CATALOG_CAPABILITY_V3_REVISION,
  CATALOG_STANDALONE_SUBJECT_CAPABILITY_REVISION,
  CATALOG_SUBJECT_OWNER_CAPABILITY_REVISION,
  CATALOG_SUBJECT_IDENTITY_CAPABILITY_REVISION,
  CATALOG_SUBJECT_RULES_CAPABILITY_REVISION,
  M1_ALLOWED_UNITS,
  M1_VALUE_SCHEMA_TYPES,
  MAX_DEFINITION_UNIT_CHARS,
} from "./types";

export { CATALOG_CAPABILITY_CONTRACT_REVISION, CATALOG_CAPABILITY_V3_REVISION, CATALOG_STANDALONE_SUBJECT_CAPABILITY_REVISION, CATALOG_SUBJECT_OWNER_CAPABILITY_REVISION, CATALOG_SUBJECT_IDENTITY_CAPABILITY_REVISION, CATALOG_SUBJECT_RULES_CAPABILITY_REVISION };

const SHARED_BUDGETS = {
  maxDisplayNameChars: 128,
  maxDocumentationChars: 8192,
  maxDescriptionChars: 512,
  maxExamples: 8,
  maxChangeSetOps: 32,
} as const;

const SHARED_KEYWORDS = {
  integer: ["type", "minimum", "maximum"],
  number: ["type", "minimum", "maximum"],
  string: ["type"],
  boolean: ["type"],
  null: ["type"],
} as const;

export const CATALOG_CAPABILITY_V3_ALLOW_LIST: CapabilityAllowListIdentity = {
  revision: CATALOG_CAPABILITY_V3_REVISION,
  id: CATALOG_CAPABILITY_ALLOW_LIST_ID,
  valueTypes: M1_VALUE_SCHEMA_TYPES,
  units: M1_ALLOWED_UNITS,
  jsonSchemaKeywords: {
    ...SHARED_KEYWORDS,
    array: ["type", "items"],
  },
  budgets: { ...SHARED_BUDGETS },
};

export const CATALOG_CAPABILITY_ALLOW_LIST: CapabilityAllowListIdentity = {
  revision: CATALOG_CAPABILITY_CONTRACT_REVISION,
  id: CATALOG_CAPABILITY_ALLOW_LIST_ID,
  valueTypes: M1_VALUE_SCHEMA_TYPES,
  units: M1_ALLOWED_UNITS,
  jsonSchemaKeywords: {
    ...SHARED_KEYWORDS,
    array: ["type", "items", "description", "minItems", "maxItems"],
  },
  budgets: {
    ...SHARED_BUDGETS,
    maxChangeSetOps: 1024,
    maxArraySchemaDepth: 4,
    maxSchemaContainerNodes: 256,
    maxItemsBound: 4096,
    maxDtsExamples: MAX_DTS_EXAMPLES,
    maxDtsExampleChars: MAX_DTS_EXAMPLE_CHARS,
  },
};

/** Bump the algorithm revision for changes to admission logic outside the frozen contracts. */
export const ACTIVATION_CHECKPOINT_VERSION = hashContractJson({
  algorithm: "catalog-activation-checkpoint/v1",
  compiler: INSTALL_CHAIN_COMPILER,
  sourceFormat: INSTALL_CHAIN_SOURCE_FORMAT,
  sourceContracts: [catalogCompilerContractFingerprint, catalogCompilerOwnerContractFingerprint,
    catalogCompilerDtsContract(false).compilerFingerprint, catalogCompilerDtsContract(true).compilerFingerprint],
  allowList: CATALOG_CAPABILITY_ALLOW_LIST,
} as unknown as ContractJsonValue);

const CONTENT_KEYS = new Set([
  "displayName",
  "documentation",
  "description",
  "unit",
  "valueSchema",
  "examples",
  "dtsExamples",
]);
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

const keywordSet = (keys: readonly string[]): ReadonlySet<string> => new Set(keys);

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

const validateDescription = (
  value: unknown,
  path: string,
  allowList: CapabilityAllowListIdentity,
): Result<string, BuildCompleteSuccessorError> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return capabilityFail("unsupported-value-schema-type", path);
  }
  if (DOCUMENTATION_FORBIDDEN.test(value)) {
    return capabilityFail("invalid-documentation", path);
  }
  if (value.length > allowList.budgets.maxDescriptionChars) {
    return capabilityFail("resource-budget-exceeded", path);
  }
  return ok(value);
};

const validateCardinality = (
  schema: Record<string, unknown>,
  path: string,
  allowList: CapabilityAllowListIdentity,
): Result<{ minItems?: number; maxItems?: number }, BuildCompleteSuccessorError> => {
  const minItems = schema.minItems;
  const maxItems = schema.maxItems;
  const bound = allowList.budgets.maxItemsBound;
  if (minItems !== undefined) {
    if (!isIntegerNumber(minItems) || minItems < 0) {
      return capabilityFail("invalid-numeric-bound", `${path}.minItems`);
    }
    if (bound !== undefined && minItems > bound) {
      return capabilityFail("resource-budget-exceeded", `${path}.minItems`);
    }
  }
  if (maxItems !== undefined) {
    if (!isIntegerNumber(maxItems) || maxItems < 0) {
      return capabilityFail("invalid-numeric-bound", `${path}.maxItems`);
    }
    if (bound !== undefined && maxItems > bound) {
      return capabilityFail("resource-budget-exceeded", `${path}.maxItems`);
    }
  }
  if (isIntegerNumber(minItems) && isIntegerNumber(maxItems) && minItems > maxItems) {
    return capabilityFail("invalid-numeric-bound", `${path}.minItems`);
  }
  return ok({
    ...(minItems !== undefined ? { minItems: minItems as number } : {}),
    ...(maxItems !== undefined ? { maxItems: maxItems as number } : {}),
  });
};

type SchemaWalkState = {
  containerNodes: number;
};

const countContainer = (
  state: SchemaWalkState,
  path: string,
  allowList: CapabilityAllowListIdentity,
): Result<void, BuildCompleteSuccessorError> => {
  state.containerNodes += 1;
  const limit = allowList.budgets.maxSchemaContainerNodes;
  if (limit !== undefined && state.containerNodes > limit) {
    return capabilityFail("resource-budget-exceeded", path);
  }
  return ok(undefined);
};

const validateMixedSchema = (
  value: Record<string, unknown>,
  path: string,
  allowList: CapabilityAllowListIdentity,
): Result<SupportedValueSchema, BuildCompleteSuccessorError> => {
  const extras = extraKeys(value, MIXED_SCHEMA_KEYS);
  if (extras.length > 0) {
    return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
  }
  const description = validateDescription(value.description, path, allowList);
  if (!description.ok) return description;
  return ok({ description: description.value });
};

export const validateValueSchema = (
  value: unknown,
  path: string,
  allowList: CapabilityAllowListIdentity = CATALOG_CAPABILITY_ALLOW_LIST,
  arrayDepth = 0,
  state: SchemaWalkState = { containerNodes: 0 },
): Result<SupportedValueSchema, BuildCompleteSuccessorError> => {
  if (!isRecord(value)) {
    return capabilityFail("unsupported-value-schema-type", path);
  }
  const counted = countContainer(state, path, allowList);
  if (!counted.ok) return counted;
  if ("$ref" in value || "$dynamicRef" in value) {
    return capabilityFail("json-schema-ref-forbidden", path);
  }
  const type = value.type;
  if (type === "integer") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.integer));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    const bounds = validateBounds(value, path, true);
    if (!bounds.ok) return bounds;
    return ok({ type: "integer", ...bounds.value });
  }
  if (type === "number") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.number));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    const bounds = validateBounds(value, path, false);
    if (!bounds.ok) return bounds;
    return ok({ type: "number", ...bounds.value });
  }
  if (type === "string") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.string));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "string" });
  }
  if (type === "boolean") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.boolean));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "boolean" });
  }
  if (type === "null") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.null));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    return ok({ type: "null" });
  }
  if (type === "array") {
    const extras = extraKeys(value, keywordSet(allowList.jsonSchemaKeywords.array));
    if (extras.length > 0) {
      return capabilityFail("unknown-json-schema-keyword", `${path}.${extras[0]}`);
    }
    const nextDepth = arrayDepth + 1;
    const depthLimit = allowList.budgets.maxArraySchemaDepth;
    if (depthLimit !== undefined && nextDepth > depthLimit) {
      return capabilityFail("resource-budget-exceeded", path);
    }
    let description: string | undefined;
    if (value.description !== undefined) {
      const checked = validateDescription(value.description, `${path}.description`, allowList);
      if (!checked.ok) return checked;
      description = checked.value;
    }
    const cardinality = validateCardinality(value, path, allowList);
    if (!cardinality.ok) return cardinality;
    if (value.items === undefined) {
      return ok({
        type: "array",
        ...(description !== undefined ? { description } : {}),
        ...cardinality.value,
      });
    }
    if (allowList.revision === CATALOG_CAPABILITY_V3_REVISION) {
      if (!isRecord(value.items)) {
        return capabilityFail("unsupported-value-schema-type", `${path}.items`);
      }
      const itemExtras = extraKeys(value.items, new Set(["type", "minimum", "maximum"]));
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
    const items = validateValueSchema(value.items, `${path}.items`, allowList, nextDepth, state);
    if (!items.ok) return items;
    return ok({
      type: "array",
      ...(description !== undefined ? { description } : {}),
      ...cardinality.value,
      items: items.value,
    });
  }
  if (type === undefined && typeof value.description === "string") {
    return validateMixedSchema(value, path, allowList);
  }
  return capabilityFail("unsupported-value-schema-type", path);
};

export { exampleMatchesSchema };

export function validateDtsExamples(
  input: unknown, path: string, allowList: CapabilityAllowListIdentity,
  context?: { propertyKey: string; subjectKind: CatalogReleaseSubjectDocument["content"]["kind"] | null; schema?: SupportedValueSchema },
): Result<SupportedDefinitionContent["dtsExamples"], BuildCompleteSuccessorError> {
  if (input === undefined) return ok(undefined);
  if (context?.subjectKind === "configuration-schema") return capabilityFail("dts-examples-require-dts-subject", path);
  const { maxDtsExamples, maxDtsExampleChars } = allowList.budgets;
  if (maxDtsExamples === undefined || maxDtsExampleChars === undefined) return capabilityFail("unknown-field", path);
  if (input === null) return ok(null);
  if (!Array.isArray(input) || input.length === 0) return capabilityFail("invalid-dts-example", path);
  if (input.length > maxDtsExamples) return capabilityFail("resource-budget-exceeded", `${path}[${maxDtsExamples}]`);
  const examples: string[] = [];
  for (const [index, raw] of input.entries()) {
    const examplePath = `${path}[${index}]`;
    if (typeof raw !== "string") return capabilityFail("invalid-dts-example", examplePath);
    const text = normalizeDtsExample(raw);
    if (text.length > maxDtsExampleChars) return capabilityFail("resource-budget-exceeded", examplePath);
    if (!text.trim() || hasDtsExampleControlCharacters(text)) return capabilityFail("invalid-dts-example", examplePath);
    if (context) {
      const issue = dtsExampleIssue(text, context.propertyKey, context.schema);
      if (issue) return capabilityFail(issue, examplePath);
    }
    examples.push(text);
  }
  return ok(examples);
}

export const validateSupportedDefinitionContentAt = (
  content: unknown,
  path: string,
  allowList: CapabilityAllowListIdentity,
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
  if (displayName.length > allowList.budgets.maxDisplayNameChars) {
    return capabilityFail("resource-budget-exceeded", `${path}.displayName`);
  }
  if (typeof content.documentation !== "string") {
    return capabilityFail("invalid-documentation", `${path}.documentation`);
  }
  if (
    DOCUMENTATION_FORBIDDEN.test(content.documentation) ||
    content.documentation.length > allowList.budgets.maxDocumentationChars
  ) {
    return capabilityFail(
      content.documentation.length > allowList.budgets.maxDocumentationChars
        ? "resource-budget-exceeded"
        : "invalid-documentation",
      `${path}.documentation`,
    );
  }
  let description: string | null | undefined = content.description === null ? null : undefined;
  if (content.description != null) {
    const candidate = content.description;
    if (typeof candidate !== "string") {
      return capabilityFail("invalid-documentation", `${path}.description`);
    }
    if (candidate.length > allowList.budgets.maxDescriptionChars) {
      return capabilityFail("resource-budget-exceeded", `${path}.description`);
    }
    if (DOCUMENTATION_FORBIDDEN.test(candidate)) {
      return capabilityFail("invalid-documentation", `${path}.description`);
    }
    description = candidate;
  }
  let unit: string | null | undefined = content.unit === null ? null : undefined;
  if (content.unit != null) {
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
  const schema = validateValueSchema(content.valueSchema, `${path}.valueSchema`, allowList);
  if (!schema.ok) return schema;
  let examples: readonly ContractJsonValue[] | null | undefined = content.examples === null ? null : undefined;
  if (content.examples != null) {
    if (!Array.isArray(content.examples)) {
      return capabilityFail("invalid-examples", `${path}.examples`);
    }
    if (content.examples.length > allowList.budgets.maxExamples) {
      return capabilityFail("resource-budget-exceeded", `${path}.examples`);
    }
    for (const [index, example] of content.examples.entries()) {
      if (!exampleMatchesSchema(schema.value, example)) {
        return capabilityFail("example-does-not-match-schema", `${path}.examples[${index}]`);
      }
    }
    examples = content.examples as readonly ContractJsonValue[];
  }
  const dtsExamples = validateDtsExamples(content.dtsExamples, `${path}.dtsExamples`, allowList);
  if (!dtsExamples.ok) return dtsExamples;
  return ok({
    displayName,
    documentation: content.documentation,
    ...(description !== undefined ? { description } : {}),
    ...(unit !== undefined ? { unit } : {}),
    valueSchema: schema.value,
    ...(examples !== undefined ? { examples } : {}),
    ...(dtsExamples.value !== undefined ? { dtsExamples: dtsExamples.value } : {}),
  });
};

export const validateSupportedDefinitionContent = (
  content: unknown,
  path: string,
): Result<SupportedDefinitionContent, BuildCompleteSuccessorError> =>
  validateSupportedDefinitionContentAt(content, path, CATALOG_CAPABILITY_ALLOW_LIST);

export const admitCompiledReleaseSchemas = (
  compiled: { readonly model: Pick<CompiledCatalogReleaseModel, "releases"> },
  allowList: CapabilityAllowListIdentity = CATALOG_CAPABILITY_ALLOW_LIST,
): Result<void, { readonly detail: string }> => {
  for (const release of compiled.model.releases) {
    const subjects = new Map(release.documents.flatMap((document) =>
      document.kind === "subject" ? [[document.content.id, document.content.kind] as const] : []));
    for (const document of release.documents) {
      if (document.kind !== "definition") continue;
      const path = `definition:${document.content.id}.valueSchema`;
      const result = validateValueSchema(document.content.revision.valueSchema, path, allowList);
      if (!result.ok) {
        const detail =
          result.error.kind === "unsupported-catalog-capability"
            ? `${result.error.detail}:${result.error.path}`
            : result.error.kind;
        return { ok: false, error: { detail } };
      }
      const examples = document.content.revision.dtsExamples;
      if (examples !== undefined) {
        const dtsPath = `definition:${document.content.id}.dtsExamples`;
        const checked = validateDtsExamples(examples, dtsPath, allowList, {
          propertyKey: document.content.propertyKey, subjectKind: subjects.get(document.content.subjectId) ?? null, schema: result.value,
        });
        if (!checked.ok) {
          const { error } = checked;
          return { ok: false, error: { detail: error.kind === "unsupported-catalog-capability" ? `${error.detail}:${error.path}` : error.kind } };
        }
        if (checked.value?.some((text, index) => text !== examples[index])) {
          return { ok: false, error: { detail: `noncanonical-dts-example:${dtsPath}` } };
        }
      }
    }
  }
  return { ok: true, value: undefined };
};
