import pg from "pg";

import type {
  CatalogKernelError,
  CatalogReleaseIdentity,
  CatalogReleasePin,
  Result,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogKernel,
  CurrentCatalogSnapshot,
  PinnedCatalogSnapshot,
} from "../../catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { resolveCatalogReleasePin } from "../../catalog-kernel/runtime/pinnedSnapshot";
import {
  CatalogSnapshotCache,
  createCatalogSnapshotCache,
} from "../../catalog-kernel/cache/rebuildCatalogCache";

/**
 * Digest-keyed current/pinned snapshot cache. Invalidation is acceleration
 * only: every new operation re-reads the database current pointer before using
 * a cache entry. An in-flight loadCurrentCatalog(expectedOldPin) fails closed
 * instead of mixing heads.
 *
 * Production current-catalog consumers wrapped here: Catalog HTTP
 * (productionWire), ingest `loadPublishedCatalog`, governance
 * `assertCurrentPin`. Remaining production kernel loads are pinned-only
 * (`loadPinnedCatalog` / historical binding releases) or test fixtures:
 * projectReadAdapter, catalogProjectValueSync pinned path, comparison
 * contributions, dts-reload CatalogRuntime probe, verification API evidence.
 */
export class DigestKeyedCatalogRuntimeCache {
  private readonly current = new Map<string, CurrentCatalogSnapshot>();
  private readonly pinned = new Map<string, PinnedCatalogSnapshot>();

  constructor(readonly payloadCache: CatalogSnapshotCache = createCatalogSnapshotCache()) {}

  getCurrent(digest: string): CurrentCatalogSnapshot | undefined {
    return this.current.get(digest);
  }

  putCurrent(digest: string, snapshot: CurrentCatalogSnapshot): void {
    this.current.set(digest, snapshot);
  }

  getPinned(digest: string): PinnedCatalogSnapshot | undefined {
    return this.pinned.get(digest);
  }

  putPinned(digest: string, snapshot: PinnedCatalogSnapshot): void {
    this.pinned.set(digest, snapshot);
  }

  discardReplacedRelease(pin: CatalogReleasePin): void {
    for (const [digest, snapshot] of this.current) {
      if (snapshot.release.id === pin.id && digest !== pin.digest) this.current.delete(digest);
    }
    for (const [digest, snapshot] of this.pinned) {
      if (snapshot.pin.id === pin.id && digest !== pin.digest) this.pinned.delete(digest);
    }
  }
}

export const captureCurrentCatalogPin = async (
  pool: pg.Pool,
): Promise<CatalogReleasePin | null> => {
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind !== "installed") {
    return null;
  }
  return { id: pointer.current.id, digest: pointer.current.digest };
};

const mismatch = (
  expected: CatalogReleasePin,
  actual: CatalogReleaseIdentity | null,
): Result<never, CatalogKernelError> => ({
  ok: false,
  error: { kind: "release-mismatch", expected, actual },
});

export const createPinCapturingCatalogRuntime = (
  pool: pg.Pool,
  kernel: CatalogKernel,
  cache: DigestKeyedCatalogRuntimeCache = new DigestKeyedCatalogRuntimeCache(),
): CatalogKernel & { readonly cache: DigestKeyedCatalogRuntimeCache } => ({
  ...kernel,
  cache,
  async loadCurrentCatalog(expected) {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      return mismatch(expected, null);
    }
    const actual = pointer.current;
    cache.discardReplacedRelease(actual);
    if (actual.id !== expected.id || actual.digest !== expected.digest) {
      return mismatch(expected, actual);
    }
    const hit = cache.getCurrent(expected.digest);
    if (hit && hit.release.id === expected.id && hit.release.digest === expected.digest) {
      return { ok: true, value: hit };
    }
    const loaded = await kernel.loadCurrentCatalog(expected);
    if (loaded.ok) {
      cache.putCurrent(expected.digest, loaded.value);
    }
    return loaded;
  },
  async loadPinnedCatalog(pin) {
    // A privileged erasure replaces a release's bytes and digest while retaining
    // its identity. A cached historical snapshot must not bypass the new pin.
    const actual = await resolveCatalogReleasePin(pool, pin.id);
    if (!actual.ok) return actual;
    cache.discardReplacedRelease(actual.value);
    if (actual.value.digest !== pin.digest) {
      return {
        ok: false,
        error: { kind: "digest-conflict", releaseId: pin.id, expected: pin.digest, actual: actual.value.digest },
      };
    }
    const hit = cache.getPinned(pin.digest);
    if (hit && hit.pin.id === pin.id && hit.pin.digest === pin.digest) {
      return { ok: true, value: hit };
    }
    const loaded = await kernel.loadPinnedCatalog(pin);
    if (loaded.ok) {
      cache.putPinned(pin.digest, loaded.value);
    }
    return loaded;
  },
});
