import { createRequire } from "node:module";

import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import type { CatalogReleaseBundle } from "./types";
import {
  catalogManifestSchema,
  catalogReleaseSchema,
} from "./contractArtifacts";

interface ValidateFunction {
  (value: unknown): boolean;
  readonly errors?: readonly unknown[] | null;
}

interface AjvLike {
  addSchema(schema: unknown): void;
  compile(schema: unknown): ValidateFunction;
}

type AjvConstructor = new (options: {
  readonly allErrors: boolean;
  readonly strict: boolean;
}) => AjvLike;

const localRequire = createRequire(import.meta.url);
const Ajv2020 = (
  localRequire("ajv/dist/2020") as { readonly default: AjvConstructor }
).default;

const contractAjv = new Ajv2020({ allErrors: true, strict: true });
contractAjv.addSchema(catalogManifestSchema);
const validateBundle = contractAjv.compile(catalogReleaseSchema);

export const isCatalogReleaseBundle = (
  value: unknown,
): value is CatalogReleaseBundle => validateBundle(value);

const valueSchemaValidity = new Map<string, boolean>();

export const isValidJsonSchema202012 = (schema: unknown): boolean => {
  let cacheKey: string | undefined;
  try {
    const serialized = serializeContract(schema as ContractJsonValue);
    if (serialized.length <= 65_536) cacheKey = serialized;
  } catch {
    cacheKey = undefined;
  }
  const cached = cacheKey === undefined ? undefined : valueSchemaValidity.get(cacheKey);
  if (cached !== undefined) return cached;

  let valid: boolean;
  try {
    new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    valid = true;
  } catch {
    valid = false;
  }
  if (cacheKey !== undefined) {
    if (valueSchemaValidity.size >= 256) {
      const oldest = valueSchemaValidity.keys().next().value;
      if (oldest !== undefined) valueSchemaValidity.delete(oldest);
    }
    valueSchemaValidity.set(cacheKey, valid);
  }
  return valid;
};
