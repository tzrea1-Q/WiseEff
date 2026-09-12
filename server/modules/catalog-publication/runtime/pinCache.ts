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
