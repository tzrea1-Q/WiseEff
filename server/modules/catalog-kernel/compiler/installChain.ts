import { hashContractJson } from "../../parameter-catalog-contract/chunkedSerialization";
import type { ContractJsonValue } from "../../parameter-catalog-contract";
import {
  catalogCompilerContractFingerprint, catalogCompilerDtsContract, catalogCompilerOwnerContractFingerprint,
  INSTALL_CHAIN_COMPILER, INSTALL_CHAIN_SOURCE_FORMAT,
} from "./contract";
import { freezeCatalogJson, ownerBundleContractArtifactDigest, s1BundleContractArtifactDigest } from "./contractArtifacts";
import { subjectRulesProvenance } from "./subjectIdentity";
import type { CatalogModelReceipt, CompiledCatalogRelease, CompiledCatalogReleaseModel } from "./types";

type NormalizedRelease = CompiledCatalogReleaseModel["releases"][number];

interface ChainState {
  readonly releaseCount: number;
  readonly modelChainDigest: string;
  readonly toolchainChainDigest: string;
  readonly hasOwners: boolean;
  readonly hasDtsExamples: boolean;
  readonly versionedSubjectIds: readonly string[];
}

/** Store only with a verified installation and the checksum of its exact target node. */
export interface CatalogInstallProof extends ChainState {
  readonly version: typeof INSTALL_CHAIN_COMPILER;
  readonly sourceCompilerFingerprint: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly sequence: number;
  readonly compiledReleaseDigest: string;
  readonly toolchainDigest: string;
  readonly materializationFingerprint: string;
}

export const sourceCompilerContract = (hasOwners: boolean, hasDtsExamples: boolean) =>
  hasDtsExamples ? catalogCompilerDtsContract(hasOwners) : {
    compilerFingerprint: hasOwners ? catalogCompilerOwnerContractFingerprint : catalogCompilerContractFingerprint,
    schemaDigest: hasOwners ? ownerBundleContractArtifactDigest : s1BundleContractArtifactDigest,
  };

export function extendInstallChain(previous: ChainState | undefined, node: NormalizedRelease): ChainState {
  const subjects = new Set(previous?.versionedSubjectIds);
  let hasOwners = previous?.hasOwners ?? false;
  let hasDtsExamples = previous?.hasDtsExamples ?? false;
  const documents = node.documents.map(document => {
    if (document.kind === "subject") {
      hasOwners ||= document.content.ownerSubjectId !== undefined;
      if (subjectRulesProvenance(document)) subjects.add(document.content.id);
    } else if (document.kind === "definition") {
      hasDtsExamples ||= document.content.revision.dtsExamples !== undefined;
    }
    return [document.kind, document.content.id, document.normalizedDigest];
  });
  // Each aggregate was verified against exact sources, declarations and the complete
  // normalized documents. File and document commitments make the model leaf explicit.
  const modelChainDigest = hashContractJson({
    contract: INSTALL_CHAIN_COMPILER, kind: "model-node", previous: previous?.modelChainDigest ?? null,
    release: node.release, files: node.files, documents,
  } as unknown as ContractJsonValue);
  const toolchainChainDigest = hashContractJson({
    contract: INSTALL_CHAIN_COMPILER, kind: "toolchain-node", previous: previous?.toolchainChainDigest ?? null,
    releaseId: node.release.id, toolchain: node.toolchain,
  } as unknown as ContractJsonValue);
  return {
    releaseCount: (previous?.releaseCount ?? 0) + 1,
    modelChainDigest, toolchainChainDigest, hasOwners, hasDtsExamples, versionedSubjectIds: [...subjects].sort(),
  };
}

export function replayInstallChain(releases: readonly NormalizedRelease[]): ChainState {
  // The legacy export's lexical sort puts sequence 10 before 2. The chain has its
  // own explicit numeric sequence order; validated lineages have gap-free unique sequences.
  const ordered = [...releases].sort((a, b) => a.release.sequence - b.release.sequence);
  let state: ChainState | undefined;
  for (const release of ordered) state = extendInstallChain(state, release);
  if (state === undefined) throw new Error("validated release lineage is empty");
  return state;
}

export function installChainReceipt(state: ChainState, target: NormalizedRelease): CatalogModelReceipt {
  const sourceCompilerFingerprint = sourceCompilerContract(state.hasOwners, state.hasDtsExamples).compilerFingerprint;
  const compilerContractFingerprint = hashContractJson({
    contract: INSTALL_CHAIN_COMPILER, sourceFormat: INSTALL_CHAIN_SOURCE_FORMAT, sourceCompilerFingerprint,
  });
  const toolchainDigest = hashContractJson({
    contract: INSTALL_CHAIN_COMPILER, kind: "toolchain-root", compilerContractFingerprint,
    releaseCount: state.releaseCount, toolchainChainDigest: state.toolchainChainDigest,
  });
  return {
    version: INSTALL_CHAIN_COMPILER, sourceFormat: INSTALL_CHAIN_SOURCE_FORMAT, compilerContractFingerprint, sourceCompilerFingerprint,
    targetReleaseId: target.release.id, targetReleaseDigest: target.release.digest,
    releaseCount: state.releaseCount, modelChainDigest: state.modelChainDigest, toolchainDigest,
  };
}

const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);

export function isCatalogInstallProof(value: unknown): value is CatalogInstallProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<CatalogInstallProof>;
  return proof.version === INSTALL_CHAIN_COMPILER && typeof proof.releaseId === "string" && proof.releaseId.length > 0 &&
    Number.isSafeInteger(proof.sequence) && proof.sequence! >= 0 &&
    Number.isSafeInteger(proof.releaseCount) && proof.releaseCount! >= 1 &&
    typeof proof.hasOwners === "boolean" && typeof proof.hasDtsExamples === "boolean" &&
    proof.sourceCompilerFingerprint === sourceCompilerContract(proof.hasOwners, proof.hasDtsExamples).compilerFingerprint &&
    digest(proof.releaseDigest) && digest(proof.compiledReleaseDigest) && digest(proof.toolchainDigest) &&
    digest(proof.materializationFingerprint) && digest(proof.modelChainDigest) && digest(proof.toolchainChainDigest) &&
    Array.isArray(proof.versionedSubjectIds) && proof.versionedSubjectIds.every((id, i, ids) =>
      typeof id === "string" && id.length > 0 && (i === 0 || ids[i - 1] < id));
}

type InstallPins = Pick<CompiledCatalogRelease, "compiledReleaseDigest" | "materializationFingerprint" | "toolchainDigest">;

export function proofForInstall(state: ChainState, target: NormalizedRelease, pins: InstallPins): CatalogInstallProof {
  return freezeCatalogJson({
    version: INSTALL_CHAIN_COMPILER,
    // Copy only the chain state. A previous proof also has the previous install's pins.
    releaseCount: state.releaseCount, modelChainDigest: state.modelChainDigest, toolchainChainDigest: state.toolchainChainDigest,
    hasOwners: state.hasOwners, hasDtsExamples: state.hasDtsExamples, versionedSubjectIds: state.versionedSubjectIds,
    sourceCompilerFingerprint: sourceCompilerContract(state.hasOwners, state.hasDtsExamples).compilerFingerprint,
    releaseId: target.release.id, releaseDigest: target.release.digest, sequence: target.release.sequence,
    compiledReleaseDigest: pins.compiledReleaseDigest, toolchainDigest: pins.toolchainDigest,
    materializationFingerprint: pins.materializationFingerprint,
  });
}

// Full v2 compilation already calculated this state to emit the receipt.
export const fullInstallProofs = new WeakMap<CompiledCatalogRelease, CatalogInstallProof>();

export function buildCatalogInstallProof(compiled: CompiledCatalogRelease): CatalogInstallProof {
  const cached = fullInstallProofs.get(compiled);
  if (cached) return cached;
  const target = compiled.model.releases.find(node => node.release.id === compiled.release.id);
  if (!target) throw new Error("validated target release disappeared");
  const proof = proofForInstall(replayInstallChain(compiled.model.releases), target, compiled);
  fullInstallProofs.set(compiled, proof);
  return proof;
}
