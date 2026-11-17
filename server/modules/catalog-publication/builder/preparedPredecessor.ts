import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
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

const freezeJson = (value: unknown): void => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeJson(child);
  Object.freeze(value);
};

export function preparePredecessorArtifact(input: {
  readonly digest: string;
  readonly bytes: Uint8Array;
}): { readonly ok: true; readonly artifact: PreparedPredecessorArtifact }
  | { readonly ok: false; readonly detail: string } {
  const parsed = parseBundleBytes(input.bytes);
  if (!parsed.ok) return parsed;
  // Planning and building share one graph. Neither the caller's original byte
  // buffer nor a planner may mutate that graph between those stages.
  freezeJson(parsed.bundle);
  const artifact = Object.freeze({ digest: input.digest }) as PreparedPredecessorArtifact;
  bundles.set(artifact, parsed.bundle);
  return { ok: true, artifact };
}

export function preparedPredecessorBundle(
  artifact: { readonly digest: string },
): CatalogReleaseBundle | undefined {
  return bundles.get(artifact as PreparedPredecessorArtifact);
}
