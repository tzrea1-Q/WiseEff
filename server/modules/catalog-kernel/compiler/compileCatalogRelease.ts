import { hashContractJson } from "../../parameter-catalog-contract/chunkedSerialization";
import {
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import type {
  CatalogReleaseBundle,
  CatalogReleaseDocument,
  CatalogReleaseNode,
  CompiledCatalogRelease,
  CompileCatalogReleaseResult,
  CompiledCatalogReleaseModel,
} from "./types";
import { catalogCompilerContractFingerprint, catalogCompilerDtsContract, catalogCompilerOwnerContractFingerprint } from "./contract";
import { freezeCatalogJson, ownerBundleContractArtifactDigest, s1BundleContractArtifactDigest } from "./contractArtifacts";
import {
  createBuildPreparation,
  firstFailedPhase,
  isCatalogReleaseBundle,
  prepareForCompilation,
  prepareIdentityAppend,
} from "./validation";

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalKey = (value: ContractJsonValue): string =>
  serializeContract(value).trimEnd();

const sorted = <Value>(
  values: readonly Value[],
  key: (value: Value) => ContractJsonValue,
): Value[] =>
  [...values].sort((left, right) => {
    const leftKey = canonicalKey(key(left));
    const rightKey = canonicalKey(key(right));
    const keyOrder = compare(leftKey, rightKey);
    if (keyOrder !== 0) return keyOrder;
    return compare(
      canonicalKey(left as ContractJsonValue),
      canonicalKey(right as ContractJsonValue),
    );
  });

const normalizeRelease = (node: CatalogReleaseNode) => ({
  release: structuredClone(node.manifest.release),
  toolchain: structuredClone(node.manifest.toolchain),
  files: sorted(structuredClone(node.manifest.files), (file) => [file.path]),
  documents: sorted(structuredClone(node.documents), (document) => [
    document.kind,
    document.content.id,
  ]),
});

const targetCounts = (documents: readonly CatalogReleaseDocument[]) => {
  const subjects = documents.filter((document) => document.kind === "subject");
  const aliases = documents.filter((document) => document.kind === "alias");
  const definitions = documents.filter(
    (document) => document.kind === "definition",
  );
  return {
    subjects: subjects.length,
    subjectMemberships: subjects.length,
    aliases: aliases.length,
    aliasMemberships: aliases.length,
    definitions: definitions.length,
    definitionRevisions: definitions.length,
  };
};

const validateCompilationInput = (
  bundle: CatalogReleaseBundle,
  prepare = prepareForCompilation,
): Extract<CompileCatalogReleaseResult, { ok: false }> | {
  readonly ok: true;
  readonly bundle: CatalogReleaseBundle;
  readonly target: CatalogReleaseNode;
} => {
  let prepared: ReturnType<typeof prepareForCompilation> | null = null;
  try {
    prepared = prepare(bundle);
  } catch {
    prepared = null;
  }
  const validation = prepared?.validation ?? null;
  const failedPhase = validation && firstFailedPhase(validation);
  if (failedPhase && validation !== null) {
    return {
      ok: false,
      error: {
        kind: "invalid-release",
        phase: failedPhase,
        violations: validation[failedPhase],
      },
    };
  }
  if (
    prepared === null ||
    validation === null ||
    !isCatalogReleaseBundle(bundle)
  ) {
    return {
      ok: false,
      error: {
        kind: "invalid-release",
        phase: "compile",
        violations: [
          {
            code: "schema-invalid",
            location: { kind: "present", value: "bundle" },
            subjectId: { kind: "absent" },
            detail: "catalog-release-bundle-schema-invalid",
          },
        ],
      },
    };
  }

  const target = prepared.bundle.releases.find(
    (node) => node.manifest.release.id === prepared.bundle.targetReleaseId,
  );
  if (!target) throw new Error("validated target release disappeared");
  return { ok: true, bundle: prepared.bundle, target };
};

/** Fully validate a bundle when the caller only needs its aggregate digest. */
const validateDigest = (
  bundle: CatalogReleaseBundle,
  prepare = prepareForCompilation,
): Extract<CompileCatalogReleaseResult, { ok: false }> | {
  readonly ok: true;
  readonly value: { readonly aggregateDigest: CompiledCatalogRelease["aggregateDigest"] };
} => {
  const validated = validateCompilationInput(bundle, prepare);
  if (!validated.ok) return validated;
  return { ok: true, value: { aggregateDigest: CatalogReleaseDigest(validated.target.manifest.release.digest) } };
};

export const validateCatalogReleaseDigest = (bundle: CatalogReleaseBundle) => validateDigest(bundle);

export const validateIdentityAppendDigest = (base: CatalogReleaseNode, successor: CatalogReleaseNode) =>
  validateDigest({ schemaVersion: "1.0.0", targetReleaseId: successor.manifest.release.id, releases: [base, successor] },
    bundle => prepareIdentityAppend(bundle, base));

export const createCatalogReleaseDigestValidator = () => {
  const prepare = createBuildPreparation();
  return (bundle: CatalogReleaseBundle) => validateDigest(bundle, prepare);
};

export const compileCatalogRelease = (
  bundle: CatalogReleaseBundle,
): CompileCatalogReleaseResult => {
  const validated = validateCompilationInput(bundle);
  if (!validated.ok) return validated;

  const authoritativeBundle = validated.bundle;
  const releases = sorted(authoritativeBundle.releases, (node) => [
    node.manifest.release.sequence,
    node.manifest.release.id,
  ]).map(normalizeRelease);
  const target = releases.find(
    (candidate) => candidate.release.id === authoritativeBundle.targetReleaseId,
  );

  if (!target) throw new Error("validated target release disappeared");

  const owned = releases.some((release) => release.documents.some((document) =>
    document.kind === "subject" && document.content.ownerSubjectId !== undefined));
  const hasDtsExamples = releases.some((release) => release.documents.some((document) =>
    document.kind === "definition" && document.content.revision.dtsExamples !== undefined));
  const { compilerFingerprint, schemaDigest } = hasDtsExamples ? catalogCompilerDtsContract(owned) : {
    compilerFingerprint: owned ? catalogCompilerOwnerContractFingerprint : catalogCompilerContractFingerprint,
    schemaDigest: owned ? ownerBundleContractArtifactDigest : s1BundleContractArtifactDigest,
  };
  const toolchainDigest = hashContractJson({
    compilerContractFingerprint: compilerFingerprint,
    s1BundleContractArtifactDigest: schemaDigest,
    releases: releases.map(({ release, toolchain }) => ({
      releaseId: release.id,
      toolchain,
    })),
  } as unknown as ContractJsonValue);
  const model: CompiledCatalogReleaseModel = {
    schemaVersion: "1.0.0",
    compilerContractFingerprint: compilerFingerprint,
    targetReleaseId: authoritativeBundle.targetReleaseId,
    toolchainDigest,
    releases,
  };
  const compiledReleaseDigest = hashContractJson(model as unknown as ContractJsonValue);
  const materializationFingerprint = hashContractJson({
    release: target.release,
    subjects: target.documents
      .filter((document) => document.kind === "subject")
      .map((document) => document.content),
    aliases: target.documents
      .filter((document) => document.kind === "alias")
      .map((document) => document.content),
    definitions: target.documents
      .filter((document) => document.kind === "definition")
      .map((document) => document.content),
  } as unknown as ContractJsonValue);

  const projection = freezeCatalogJson({
    release: {
      id: CatalogReleaseId(target.release.id),
      version: CatalogReleaseVersion(target.release.version),
      digest: CatalogReleaseDigest(target.release.digest),
    },
    predecessor:
      target.release.predecessor === null
        ? null
        : {
            id: CatalogReleaseId(target.release.predecessor.id),
            digest: CatalogReleaseDigest(target.release.predecessor.digest),
          },
    aggregateDigest: CatalogReleaseDigest(target.release.digest),
    compiledReleaseDigest: CatalogReleaseDigest(compiledReleaseDigest),
    toolchainDigest: CatalogReleaseDigest(toolchainDigest),
    materializationFingerprint: CatalogMaterializationFingerprint(materializationFingerprint),
    counts: targetCounts(target.documents),
    model,
  });
  // Installation only consumes the frozen projection and its digests. Materialize
  // the complete canonical string only for callers explicitly requesting it.
  let bytes: string | undefined;
  return {
    ok: true,
    value: Object.freeze({
      ...projection,
      get bytes() {
        return bytes ??= serializeContract(model as unknown as ContractJsonValue);
      },
    }),
  };
};
