import { createHash } from "node:crypto";

import {
  catalogReleaseViolationCodes,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import { s1BundleContractArtifactDigest } from "./contractArtifacts";

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

export const catalogCompilerContract = deepFreeze({
  contractVersion: "1.0.0",
  input: {
    bundleSchemaVersion: "1.0.0",
    s1BundleContractArtifactDigest,
    authority: "exact-yaml-source-bytes",
    declarationRole: "compiler-verified-evidence",
    schemaValidator: "ajv-2020-12",
  },
  output: {
    modelSchemaVersion: "1.0.0",
    canonicalSerialization: "parameter-catalog-contract-serialize",
    digestAlgorithm: "sha256",
    ordering: "ecmascript-utf16-code-unit",
    includesExactSourceBytes: false,
  },
  violationOrder: [...catalogReleaseViolationCodes],
} as const);

export const catalogCompilerContractFingerprint = `sha256:${createHash("sha256")
  .update(
    serializeContract(catalogCompilerContract as unknown as ContractJsonValue),
  )
  .digest("hex")}`;
