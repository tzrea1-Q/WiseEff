import { createHash } from "node:crypto";

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
  CompileCatalogReleaseResult,
  CompiledCatalogReleaseModel,
} from "./types";
import { catalogCompilerContractFingerprint } from "./contract";
import { s1BundleContractArtifactDigest } from "./contractArtifacts";
import {
  firstFailedPhase,
  isCatalogReleaseBundle,
  validateForCompilation,
} from "./validation";

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalKey = (value: ContractJsonValue): string =>
  serializeContract(value).trimEnd();

const hash = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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
  files: sorted(node.manifest.files, (file) => [file.path]),
  documents: sorted(node.documents, (document) => [
    document.kind,
    document.content.id,
  ]),
});

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
};

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

export const compileCatalogRelease = (
  bundle: CatalogReleaseBundle,
): CompileCatalogReleaseResult => {
  let validation: ReturnType<typeof validateForCompilation> | null = null;
  try {
    validation = validateForCompilation(bundle);
  } catch {
    validation = null;
  }
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
  if (validation === null || !isCatalogReleaseBundle(bundle)) {
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

  const releases = sorted(bundle.releases, (node) => [
    node.manifest.release.sequence,
    node.manifest.release.id,
  ]).map(normalizeRelease);
  const target = releases.find(
    (candidate) => candidate.release.id === bundle.targetReleaseId,
  );

  if (!target) throw new Error("validated target release disappeared");

  const toolchainDigest = hash(
    serializeContract(
      {
        compilerContractFingerprint: catalogCompilerContractFingerprint,
        s1BundleContractArtifactDigest,
        releases: releases.map(({ release, toolchain }) => ({
          releaseId: release.id,
          toolchain,
        })),
      } as unknown as ContractJsonValue,
    ),
  );
  const model: CompiledCatalogReleaseModel = {
    schemaVersion: "1.0.0",
    compilerContractFingerprint: catalogCompilerContractFingerprint,
    targetReleaseId: bundle.targetReleaseId,
    toolchainDigest,
    releases,
  };
  const bytes = serializeContract(model as unknown as ContractJsonValue);
  const compiledReleaseDigest = hash(bytes);
  const materializationFingerprint = hash(
    serializeContract(
      {
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
      } as unknown as ContractJsonValue,
    ),
  );

  return {
    ok: true,
    value: deepFreeze({
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
      materializationFingerprint: CatalogMaterializationFingerprint(
        materializationFingerprint,
      ),
      counts: targetCounts(target.documents),
      model,
      bytes,
    }),
  };
};
