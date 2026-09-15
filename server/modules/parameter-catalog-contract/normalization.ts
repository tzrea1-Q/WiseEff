import type { Result } from "./results";

declare const canonicalParameterIdentityBrand: unique symbol;

type CanonicalParameterIdentity<Name extends string> = string & {
  readonly [canonicalParameterIdentityBrand]: Name;
};

export type DriverCompatible = CanonicalParameterIdentity<"DriverCompatible">;
export type NormalizedNodeTypeName = CanonicalParameterIdentity<
  "NormalizedNodeTypeName"
>;
export type PropertyKey = CanonicalParameterIdentity<"PropertyKey">;
/**
 * Governed software-configuration model identifier (Issue #849 D09). Platform-owned
 * and exact. Syntax only bounds the accepted shape; authority comes from the
 * reviewed publication manifest.
 */
export type NormalizedConfigurationSchemaId =
  CanonicalParameterIdentity<"NormalizedConfigurationSchemaId">;

const asDriverCompatible = (value: string): DriverCompatible =>
  value as DriverCompatible;
const asNormalizedNodeTypeName = (value: string): NormalizedNodeTypeName =>
  value as NormalizedNodeTypeName;
const asPropertyKey = (value: string): PropertyKey => value as PropertyKey;
const asNormalizedConfigurationSchemaId = (
  value: string
): NormalizedConfigurationSchemaId =>
  value as NormalizedConfigurationSchemaId;

/**
 * Source-file extensions that must never be read as a governed model identity.
 * A filename or extension is not identity evidence (Issue #849 T4), so any model id
 * whose final segment is a known source/config extension is refused outright rather
 * than relying on the author to choose a different spelling.
 */
const forbiddenConfigurationSchemaIdSuffixes = Object.freeze([
  ".dts",
  ".dtsi",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".json",
  ".csv",
  ".xlsx",
  ".ini",
  ".bin",
  ".txt",
  ".xml",
  ".conf"
]);

export const canonicalIdentityFailureReasons = Object.freeze([
  "not-string",
  "empty",
  "control-character",
  "non-ascii",
  "surrounding-whitespace",
  "whitespace-forbidden",
  "quoted-source-token",
  "wildcard-forbidden",
  "unit-address-present",
  "length-out-of-range",
  "invalid-syntax",
  "structural-property"
] as const);
export type CanonicalIdentityFailureReason =
  (typeof canonicalIdentityFailureReasons)[number];

export type CanonicalIdentityParseResult<Value> = Result<
  Value,
  CanonicalIdentityFailureReason
>;

const classifyCommonFailure = (
  input: unknown
): CanonicalIdentityFailureReason | null => {
  if (typeof input !== "string") {
    return "not-string";
  }
  if (input.length === 0) {
    return "empty";
  }
  if (/[\u0000-\u001F\u007F]/u.test(input)) {
    return "control-character";
  }
  if (/[^\u0000-\u007F]/u.test(input)) {
    return "non-ascii";
  }
  if (input.startsWith(" ") || input.endsWith(" ")) {
    return "surrounding-whitespace";
  }
  if (/\s/u.test(input)) {
    return "whitespace-forbidden";
  }
  const first = input[0];
  if (
    input.length >= 2 &&
    (first === '"' || first === "'") &&
    input.at(-1) === first
  ) {
    return "quoted-source-token";
  }
  return null;
};

export const parseCanonicalCompatibleSelector = (
  input: unknown
): CanonicalIdentityParseResult<DriverCompatible> => {
  const commonFailure = classifyCommonFailure(input);
  if (commonFailure !== null) {
    return { ok: false, error: commonFailure };
  }

  const compatible = input as string;
  if (compatible.includes("*")) {
    return { ok: false, error: "wildcard-forbidden" };
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9+._/-]*(?:,[A-Za-z0-9][A-Za-z0-9+._/-]*)?$/u.test(
      compatible
    )
  ) {
    return { ok: false, error: "invalid-syntax" };
  }
  return { ok: true, value: asDriverCompatible(compatible) };
};

export const parseCanonicalNodeName = (
  input: unknown
): CanonicalIdentityParseResult<NormalizedNodeTypeName> => {
  const commonFailure = classifyCommonFailure(input);
  if (commonFailure !== null) {
    return { ok: false, error: commonFailure };
  }

  const nodeName = input as string;
  if (nodeName.includes("@")) {
    return { ok: false, error: "unit-address-present" };
  }
  if (nodeName.length > 31) {
    return { ok: false, error: "length-out-of-range" };
  }
  if (
    nodeName !== "/" &&
    !/^[A-Za-z][A-Za-z0-9,._+-]{0,30}$/u.test(nodeName)
  ) {
    return { ok: false, error: "invalid-syntax" };
  }
  return { ok: true, value: asNormalizedNodeTypeName(nodeName) };
};

/**
 * Parse a governed configuration-model identifier.
 *
 * Deliberately excludes `,` (so a driver compatible list can never read as a model
 * id), `@` (a unit address) and `*`, and refuses filename/extension shapes, so the
 * three selector namespaces stay distinguishable by construction and no uploaded
 * declaration can allocate an identity.
 */
export const parseCanonicalConfigurationSchemaId = (
  input: unknown
): CanonicalIdentityParseResult<NormalizedConfigurationSchemaId> => {
  const commonFailure = classifyCommonFailure(input);
  if (commonFailure !== null) {
    return { ok: false, error: commonFailure };
  }

  const modelId = input as string;
  if (modelId.includes("*")) return { ok: false, error: "wildcard-forbidden" };
  if (modelId.includes("@")) return { ok: false, error: "unit-address-present" };
  if (modelId.length > 96) return { ok: false, error: "length-out-of-range" };
  if (!/^[A-Za-z0-9][A-Za-z0-9+._/-]*$/u.test(modelId)) {
    return { ok: false, error: "invalid-syntax" };
  }
  const lowered = modelId.toLowerCase();
  if (forbiddenConfigurationSchemaIdSuffixes.some((suffix) => lowered.endsWith(suffix))) {
    return { ok: false, error: "invalid-syntax" };
  }
  return { ok: true, value: asNormalizedConfigurationSchemaId(modelId) };
};

const structuralPropertyKeys = new Set([
  "compatible",
  "device_type",
  "gpio-controller",
  "interrupt-controller",
  "linux,phandle",
  "phandle",
  "ranges",
  "reg",
  "status",
  "#address-cells",
  "#gpio-cells",
  "#interrupt-cells",
  "#size-cells"
]);

export const parseCanonicalPropertyKey = (
  input: unknown
): CanonicalIdentityParseResult<PropertyKey> => {
  const commonFailure = classifyCommonFailure(input);
  if (commonFailure !== null) {
    return { ok: false, error: commonFailure };
  }

  const propertyKey = input as string;
  if (propertyKey.length > 31) {
    return { ok: false, error: "length-out-of-range" };
  }
  if (
    propertyKey.startsWith("#") ||
    structuralPropertyKeys.has(propertyKey.toLowerCase())
  ) {
    return { ok: false, error: "structural-property" };
  }
  if (!/^[A-Za-z0-9,._+?#-]{1,31}$/u.test(propertyKey)) {
    return { ok: false, error: "invalid-syntax" };
  }
  return { ok: true, value: asPropertyKey(propertyKey) };
};
