import { fileURLToPath } from "node:url";
import type pg from "pg";

import type { Queryable } from "../../shared/database/client";
import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseNode,
  CompiledCatalogRelease,
} from "../catalog-kernel/compiler/types";
import { verifyStagedReleaseProjection } from "../catalog-kernel/verification/verifyCurrentMaterialization";
import {
  encodeBundleBytes,
  parseBundleBytes,
  refreshSuccessorSource,
  sha256Digest,
} from "./builder/bundleCodec";

export type CatalogDefinitionErasurePlan = {
  readonly definitionId: string;
  readonly releases: readonly {
    readonly id: string;
    readonly oldDigest: string;
    readonly newDigest: string;
    readonly compiledModelDigest: string;
    readonly toolchainDigest: string;
    readonly materializationFingerprint: string;
  }[];
  readonly artifacts: readonly {
    readonly id: string;
    readonly create: boolean;
    readonly oldDigest: string;
    readonly newDigest: string;
    readonly bytesChecksum: string;
    readonly artifactBytesBase64: string;
    readonly targetReleaseId: string;
    readonly predecessorReleaseId: string | null;
    readonly predecessorReleaseDigest: string | null;
    readonly toolchain: CatalogReleaseNode["manifest"]["toolchain"];
  }[];
  readonly revisions: readonly {
    readonly id: string;
    readonly oldContentDigest: string;
    readonly contentDigest: string;
    readonly content: CatalogReleaseDefinitionDocument["content"]["revision"];
  }[];
};

type StoredArtifact = {
  readonly id: string;
  readonly artifact_digest: string;
  readonly artifact_bytes: Uint8Array;
  readonly create?: boolean;
};

type InstalledRelease = { readonly id: string; readonly release_digest: string };

const compile = (bundle: CatalogReleaseBundle): CompiledCatalogRelease => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`Catalog erasure cannot rebuild an invalid release: ${JSON.stringify(compiled.error)}`);
  }
  return compiled.value;
};

const verifyArtifactProjections = async (
  db: Queryable,
  artifacts: readonly StoredArtifact[],
  installed: readonly InstalledRelease[],
): Promise<void> => {
  const sources = new Map<string, CatalogReleaseNode>();
  for (const artifact of artifacts) {
    const parsed = parseBundleBytes(artifact.artifact_bytes);
    if (!parsed.ok) throw new Error(`Catalog artifact ${artifact.id} is unreadable.`);
    for (const node of parsed.bundle.releases) sources.set(node.manifest.release.id, node);
  }
  for (const release of installed) {
    const lineage: CatalogReleaseNode[] = [];
    const seen = new Set<string>();
    let node = sources.get(release.id);
    while (node && !seen.has(node.manifest.release.id)) {
      lineage.unshift(node);
      seen.add(node.manifest.release.id);
      const predecessorId = node.manifest.release.predecessor?.id;
      node = predecessorId ? sources.get(predecessorId) : undefined;
    }
    const compiled = compile({ schemaVersion: "1.0.0", targetReleaseId: release.id, releases: lineage });
    const verified = await verifyStagedReleaseProjection(db as Pick<pg.Client, "query">, compiled);
    if (!verified.ok) throw new Error(`Catalog stored projection does not match its verified source: ${JSON.stringify(verified.error)}`);
  }
};

/** Retains every surviving identity and revision; embedded source bytes are rebuilt too. */
export const rebuildCatalogForDefinitionErasure = (
  artifacts: readonly StoredArtifact[],
  installed: readonly InstalledRelease[],
  definitionId: string,
): CatalogDefinitionErasurePlan => {
  const originals = new Map<string, CatalogReleaseNode>();
  const bundles = new Map<string, CatalogReleaseBundle>();
  for (const artifact of artifacts) {
    const parsed = parseBundleBytes(artifact.artifact_bytes);
    if (!parsed.ok) throw new Error(`Catalog artifact ${artifact.id} is unreadable.`);
    if (compile(parsed.bundle).aggregateDigest !== artifact.artifact_digest) {
      throw new Error(`Catalog artifact ${artifact.id} has a conflicting digest.`);
    }
    bundles.set(artifact.id, parsed.bundle);
    for (const node of parsed.bundle.releases) {
      const existing = originals.get(node.manifest.release.id);
      if (existing && existing.manifest.release.digest !== node.manifest.release.digest) {
        throw new Error(`Catalog release ${node.manifest.release.id} has conflicting artifacts.`);
      }
      originals.set(node.manifest.release.id, node);
    }
  }

  for (const release of installed) {
    const original = originals.get(release.id);
    if (!original || original.manifest.release.digest !== release.release_digest) {
      throw new Error(`Catalog erasure requires the verified source artifact for release ${release.id}.`);
    }
  }

  const rebuilt = new Map<string, CatalogReleaseNode>();
  const revisions = new Map<string, CatalogDefinitionErasurePlan["revisions"][number]>();
  const pending = new Map(originals);
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, node] of pending) {
      const predecessor = node.manifest.release.predecessor;
      if (predecessor && !rebuilt.has(predecessor.id)) continue;
      const previous = predecessor ? rebuilt.get(predecessor.id)! : null;
      const documents = node.documents.filter(
        (document) => document.kind !== "definition" || document.content.id !== definitionId,
      ).map((document) => {
        if (document.kind !== "definition" || document.content.revision.successorDefinitionId !== definitionId) {
          return document;
        }
        const { successorDefinitionId: _erasedSuccessor, ...revision } = document.content.revision;
        // Deprecated revisions require a valid successor. Once that successor
        // is erased, retain the old parameter as retired with no dangling link.
        return { ...document, content: { ...document.content, revision: { ...revision, lifecycle: "retired" as const } } };
      });
      const changed = documents.length !== node.documents.length
        || documents.some((document, index) => document !== node.documents[index])
        || (predecessor !== null && predecessor.digest !== previous!.manifest.release.digest);
      const rewritten = changed ? refreshSuccessorSource({
        ...node,
        documents,
        manifest: {
          ...node.manifest,
          release: {
            ...node.manifest.release,
            predecessor: previous ? { id: previous.manifest.release.id, digest: previous.manifest.release.digest } : null,
          },
        },
      }) : node;
      for (const document of rewritten.documents) {
        if (document.kind !== "definition") continue;
        const original = node.documents.find((candidate) => candidate.kind === "definition"
          && candidate.content.revision.id === document.content.revision.id);
        if (original?.kind === "definition"
          && original.content.revision.contentDigest !== document.content.revision.contentDigest) {
          revisions.set(document.content.revision.id, {
            id: document.content.revision.id,
            oldContentDigest: original.content.revision.contentDigest,
            contentDigest: document.content.revision.contentDigest,
            content: document.content.revision,
          });
        }
      }
      rebuilt.set(id, rewritten);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) throw new Error("Catalog erasure cannot rebuild an incomplete release lineage.");
  }

  const lineage = (releaseId: string): CatalogReleaseNode[] => {
    const nodes: CatalogReleaseNode[] = [];
    let node = rebuilt.get(releaseId);
    while (node) {
      nodes.unshift(node);
      const predecessorId = node.manifest.release.predecessor?.id;
      node = predecessorId ? rebuilt.get(predecessorId) : undefined;
    }
    return nodes;
  };
  const compiledByTarget = new Map<string, CompiledCatalogRelease>();
  const rewrittenArtifacts: CatalogDefinitionErasurePlan["artifacts"][number][] = [];
  for (const artifact of artifacts) {
    const original = bundles.get(artifact.id)!;
    const bundle = { ...original, releases: original.releases.map((node) => rebuilt.get(node.manifest.release.id)!) };
    const compiled = compile(bundle);
    compiledByTarget.set(bundle.targetReleaseId, compiled);
    if (compiled.aggregateDigest === artifact.artifact_digest) continue;
    const bytes = encodeBundleBytes(bundle);
    rewrittenArtifacts.push({
      id: artifact.id,
      create: artifact.create ?? false,
      oldDigest: artifact.artifact_digest,
      newDigest: compiled.aggregateDigest,
      bytesChecksum: sha256Digest(bytes),
      artifactBytesBase64: Buffer.from(bytes).toString("base64"),
      targetReleaseId: bundle.targetReleaseId,
      predecessorReleaseId: compiled.predecessor?.id ?? null,
      predecessorReleaseDigest: compiled.predecessor?.digest ?? null,
      toolchain: bundle.releases.find((node) => node.manifest.release.id === bundle.targetReleaseId)!.manifest.toolchain,
    });
  }
  const releases: CatalogDefinitionErasurePlan["releases"][number][] = [];
  for (const release of installed) {
    const node = rebuilt.get(release.id)!;
    if (node.manifest.release.digest === release.release_digest) continue;
    const compiled = compiledByTarget.get(release.id) ?? compile({
      schemaVersion: "1.0.0",
      targetReleaseId: release.id,
      releases: lineage(release.id),
    });
    releases.push({
      id: release.id,
      oldDigest: release.release_digest,
      newDigest: compiled.aggregateDigest,
      compiledModelDigest: compiled.compiledReleaseDigest,
      toolchainDigest: compiled.toolchainDigest,
      materializationFingerprint: compiled.materializationFingerprint,
    });
  }
  return { definitionId, releases, artifacts: rewrittenArtifacts, revisions: [...revisions.values()] };
};

/** Call inside the purge transaction after acquiring the Catalog/publication fences. */
export const prepareCatalogDefinitionErasure = async (
  db: Queryable,
  definitionId: string,
): Promise<CatalogDefinitionErasurePlan> => {
  const [artifacts, releases] = await Promise.all([
    db.query<StoredArtifact>(`select id, artifact_digest, artifact_bytes
      from catalog_publication.release_artifacts order by created_at, id`),
    db.query<InstalledRelease>(`select id, release_digest
      from parameter_catalog.catalog_releases order by release_sequence, id`),
  ]);
  const sourced = new Set(artifacts.rows.flatMap((artifact) => {
    const parsed = parseBundleBytes(artifact.artifact_bytes);
    if (!parsed.ok) throw new Error(`Catalog artifact ${artifact.id} is unreadable.`);
    return parsed.bundle.releases.map((node) => node.manifest.release.id);
  }));
  const missing = releases.rows.filter((release) => !sourced.has(release.id));
  if (missing.length > 0) {
    // Native bootstrap predates artifact persistence. Reuse its original source
    // provider, then independently verify every recovered DB projection before
    // treating those bytes as an erasure source. Unknown bootstraps fail closed.
    const { compileLocalizedVendorCatalogSuccessor } = await import("../../../scripts/compile-vendor-catalog-release");
    const native = compileLocalizedVendorCatalogSuccessor(fileURLToPath(new URL("../../../", import.meta.url))).bundle;
    let recovered: CatalogReleaseBundle | undefined;
    for (const release of missing) {
      const index = native.releases.findIndex((node) => node.manifest.release.id === release.id
        && node.manifest.release.digest === release.release_digest);
      if (index < 0) throw new Error(`Catalog erasure requires the verified source artifact for release ${release.id}.`);
      const bundle = { ...native, targetReleaseId: release.id, releases: native.releases.slice(0, index + 1) };
      if (!recovered || bundle.releases.length > recovered.releases.length) recovered = bundle;
    }
    const compiled = compile(recovered!);
    artifacts.rows.push({
      id: `cart_erasure_bootstrap_${sha256Digest(recovered!.targetReleaseId).slice(7, 31)}`,
      artifact_digest: compiled.aggregateDigest,
      artifact_bytes: encodeBundleBytes(recovered!),
      create: true,
    });
  }
  await verifyArtifactProjections(db, artifacts.rows, releases.rows);
  return rebuildCatalogForDefinitionErasure(artifacts.rows, releases.rows, definitionId);
};
