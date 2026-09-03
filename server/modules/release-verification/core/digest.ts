import { createHash } from "node:crypto";
import {
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

export const toContractJson = (value: unknown): ContractJsonValue => {
  if (value === null) {
    return null;
  }
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError("Verification digest rejected a non-JSON number");
      }
      return value;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(`Verification digest rejected ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => toContractJson(item));
  }
  const record = value as { readonly [key: string]: unknown };
  const keys = Object.keys(record).sort();
  const output: { [key: string]: ContractJsonValue } = {};
  for (const key of keys) {
    output[key] = toContractJson(record[key]);
  }
  return output;
};

export const canonicalBytes = (value: unknown): string =>
  serializeContract(toContractJson(value));

export const sha256Digest = (bytes: string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const digestOf = (value: unknown): string => sha256Digest(canonicalBytes(value));
