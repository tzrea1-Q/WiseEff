import type {
  CatalogKernelError,
  CatalogReleasePin,
  Result,
} from "../../parameter-catalog-contract/index";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
} from "../../parameter-catalog-contract/index";
import type { PinnedCatalogSnapshot } from "../interface";
import { loadSnapshotBody, locatorPin, readReleaseHeader } from "./currentSnapshot";
import { catalogSnapshotCachePool, withCatalogReadTransaction, type CatalogReadSource } from "./readTransaction";

export const resolveCatalogReleasePin = async (
  pool: CatalogReadSource,
  releaseId: CatalogReleaseId,
): Promise<Result<CatalogReleasePin, CatalogKernelError>> =>
  withCatalogReadTransaction(pool, "loadPinnedCatalog", async (client) => {
    const release = await client.query<{ id: string; release_digest: string }>(
      `select id, release_digest
         from parameter_catalog.catalog_releases
        where id = $1`,
      [releaseId],
    );
    const row = release.rows[0];
    if (!row) {
      return {
        ok: false,
        error: {
          kind: "historical-release-unavailable",
          pin: locatorPin(releaseId),
        },
      };
    }
    return {
      ok: true,
      value: {
        id: CatalogReleaseId(row.id),
        digest: CatalogReleaseDigest(row.release_digest),
      },
    };
  });

export const loadPinnedCatalogSnapshot = async (
  pool: CatalogReadSource,
  pin: CatalogReleasePin,
  { fresh = false } = {},
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> =>
  withCatalogReadTransaction(pool, "loadPinnedCatalog", async (client) => {
    const cachePool = fresh ? null : catalogSnapshotCachePool(pool);
    const row = await readReleaseHeader(client, pin.id, { cache: cachePool !== null });
    if (!row) {
      return {
        ok: false,
        error: { kind: "historical-release-unavailable", pin },
      };
    }
    const actualDigest = CatalogReleaseDigest(row.release_digest);
    if (row.id !== pin.id || actualDigest !== pin.digest) {
      return {
        ok: false,
        error: {
          kind: "digest-conflict",
          releaseId: pin.id,
          expected: pin.digest,
          actual: actualDigest,
        },
      };
    }
    const snapshot = await loadSnapshotBody(cachePool, client, row, "pinned", pin);
    return { ok: true, value: snapshot };
  });

export const loadPinnedCatalogById = async (
  pool: CatalogReadSource,
  releaseId: CatalogReleaseId,
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> => {
  const resolved = await resolveCatalogReleasePin(pool, releaseId);
  if (!resolved.ok) {
    return resolved;
  }
  return loadPinnedCatalogSnapshot(pool, resolved.value);
};
