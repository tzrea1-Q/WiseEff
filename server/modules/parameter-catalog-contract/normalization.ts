import { DriverCompatible, NormalizedNodeTypeName, PropertyKey } from "./ids";
import type { Result } from "./results";

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
  return { ok: true, value: DriverCompatible(compatible) };
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
  return { ok: true, value: NormalizedNodeTypeName(nodeName) };
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
  return { ok: true, value: PropertyKey(propertyKey) };
};
