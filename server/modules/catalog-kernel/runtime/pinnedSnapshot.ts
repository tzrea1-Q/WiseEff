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
import {
  catalogSnapshotCachePool,
  CatalogSnapshotReadFailure,
  withCatalogReadTransaction,
  type CatalogReadSource,
} from "./readTransaction";

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

const ownerEpochChanged: CatalogKernelError = {
  kind: "storage-failure",
  operation: "loadPinnedCatalog",
  retryable: true,
};

export const loadPinnedCatalogSnapshot = async (
  pool: CatalogReadSource,
  pin: CatalogReleasePin,
  { fresh = false } = {},
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> => {
  const cachePool = fresh ? null : catalogSnapshotCachePool(pool);
  const load = () => withCatalogReadTransaction<PinnedCatalogSnapshot>(pool, "loadPinnedCatalog", async (client, commit) => {
    const readPinnedHeader = async (options: { cache?: boolean; checkOwnerEpoch: boolean }) => {
      const row = await readReleaseHeader(client, pin.id, options);
      if (!row) {
        throw new CatalogSnapshotReadFailure({ kind: "historical-release-unavailable", pin });
      }
      const actual = CatalogReleaseDigest(row.release_digest);
      if (row.id !== pin.id || actual !== pin.digest) {
        throw new CatalogSnapshotReadFailure({
          kind: "digest-conflict",
          releaseId: pin.id,
          expected: pin.digest,
          actual,
        });
      }
      return row;
    };
    const row = await readPinnedHeader({
      cache: cachePool !== null,
      checkOwnerEpoch: cachePool !== null || commit !== undefined,
    });
    const validation = commit && {
      commit,
      async recheck() {
        const after = await readPinnedHeader({ checkOwnerEpoch: row.subject_owner_epoch !== null });
        if (after.subject_owner_epoch !== row.subject_owner_epoch) {
          throw new CatalogSnapshotReadFailure(ownerEpochChanged);
        }
      },
    };
    const snapshot = await loadSnapshotBody(cachePool, client, row, "pinned", pin, validation);
    return { ok: true, value: snapshot };
  });
  const result = await load();
  return !result.ok && result.error === ownerEpochChanged ? load() : result;
};

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
