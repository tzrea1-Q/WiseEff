import { createHash } from "node:crypto";

import {
  catalogReleaseViolationCodes,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import { dtsExamplesBundleContractArtifactDigest, ownerBundleContractArtifactDigest, s1BundleContractArtifactDigest } from "./contractArtifacts";

/** Both declarations enter the release aggregate; the source format also gates legacy validators. */
export const INSTALL_CHAIN_COMPILER = "wiseeff-catalog-install-chain/v2";
export const INSTALL_CHAIN_SOURCE_FORMAT = "wiseeff-catalog-release@2";

export function isInstallChainToolchain(toolchain: { readonly compiler: string; readonly sourceFormat: string } | null | undefined): boolean {
  return toolchain?.sourceFormat === INSTALL_CHAIN_SOURCE_FORMAT && toolchain.compiler === INSTALL_CHAIN_COMPILER;
}

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

/** v6 extends the frozen v1 contract; old artifacts retain their exact fingerprint. */
export const catalogCompilerOwnerContractFingerprint = `sha256:${createHash("sha256")
  .update(serializeContract({ ...catalogCompilerContract, contractVersion: "1.1.0",
    input: { ...catalogCompilerContract.input, s1BundleContractArtifactDigest: ownerBundleContractArtifactDigest,
      subjectOwnership: "driver-scoped-v1" } } as unknown as ContractJsonValue))
  .digest("hex")}`;

export const catalogCompilerDtsContract = (owned: boolean) => {
  const schemaDigest = dtsExamplesBundleContractArtifactDigest(owned);
  const contract = {
    ...catalogCompilerContract,
    contractVersion: "1.2.0",
    input: { ...catalogCompilerContract.input, s1BundleContractArtifactDigest: schemaDigest,
      ...(owned ? { subjectOwnership: "driver-scoped-v1" } : {}), definitionDtsExamples: "verbatim-v1" },
  };
  return { schemaDigest, compilerFingerprint: `sha256:${createHash("sha256")
    .update(serializeContract(contract as unknown as ContractJsonValue)).digest("hex")}` };
};
