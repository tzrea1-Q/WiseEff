import type { Queryable } from "../../../shared/database/client";
import { timeCatalogStage } from "../../../observability/catalogPublicationStages";
import { decodeStoredArtifact, readArtifactLineage } from "../persistence/store";
import type { CatalogPublicationStoreResult } from "../persistence/types";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { freezeCatalogJson } from "../../catalog-kernel/compiler/index";
import { parseBundleBytes } from "./bundleCodec";

declare const preparedPredecessor: unique symbol;

/** A request-owned parsed snapshot, not proof of compiler or digest validation. */
export type PreparedPredecessorArtifact = {
  readonly digest: string;
  readonly [preparedPredecessor]: true;
};

// Weak keys keep this request-local: there is no digest-indexed cache retaining
// every historical bundle. Only handles created here can reuse a parsed graph.
const bundles = new WeakMap<PreparedPredecessorArtifact, CatalogReleaseBundle>();

export function preparePredecessorArtifact(input: {
  readonly digest: string;
  readonly bytes: Uint8Array;
}): { readonly ok: true; readonly artifact: PreparedPredecessorArtifact }
  | { readonly ok: false; readonly detail: string } {
  const parsed = parseBundleBytes(input.bytes);
  if (!parsed.ok) return parsed;
  return { ok: true, artifact: ownBundle(input.digest, parsed.bundle) };
}

export async function readPreparedPredecessor(db: Queryable, digest: string):
  Promise<CatalogPublicationStoreResult<PreparedPredecessorArtifact>> {
  const lineage = await readArtifactLineage(db, digest);
  if (!lineage.ok) return lineage;
  return timeCatalogStage("predecessor-decode", () => {
    const decoded = decodeStoredArtifact(lineage.value);
    return decoded.ok ? { ok: true as const, value: ownBundle(digest, decoded.value) } : decoded;
  });
}

function ownBundle(digest: string, bundle: CatalogReleaseBundle): PreparedPredecessorArtifact {
  // Planning and building share one graph. Neither the caller's original byte
  // buffer nor a planner may mutate that graph between those stages.
  freezeCatalogJson(bundle);
  const artifact = Object.freeze({ digest }) as PreparedPredecessorArtifact;
  bundles.set(artifact, bundle);
  return artifact;
}

export function preparedPredecessorBundle(
  artifact: { readonly digest: string },
): CatalogReleaseBundle | undefined {
  return bundles.get(artifact as PreparedPredecessorArtifact);
}
