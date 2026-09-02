import { createRequire } from "node:module";

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

export const isValidJsonSchema202012 = (schema: unknown): boolean => {
  try {
    new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    return true;
  } catch {
    return false;
  }
};
