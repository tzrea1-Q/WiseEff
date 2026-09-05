import pg from "pg";

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
import { loadProjection, locatorPin } from "./currentSnapshot";
import { withCatalogReadTransaction } from "./readTransaction";

const asPinned = (
  snapshot: Exclude<Awaited<ReturnType<typeof loadProjection>>, null>["snapshot"],
  pin: CatalogReleasePin,
): PinnedCatalogSnapshot => {
  const pinned: PinnedCatalogSnapshot = Object.assign(snapshot, {
    snapshotKind: "pinned" as const,
    pin,
  });
  Object.freeze(pinned);
  return pinned;
};

export const resolveCatalogReleasePin = async (
  pool: pg.Pool,
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
  pool: pg.Pool,
  pin: CatalogReleasePin,
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> =>
  withCatalogReadTransaction(pool, "loadPinnedCatalog", async (client) => {
    const release = await client.query<{
      id: string;
      release_digest: string;
    }>(
      `select id, release_digest
         from parameter_catalog.catalog_releases
        where id = $1`,
      [pin.id],
    );
    const row = release.rows[0];
    if (!row) {
      return {
        ok: false,
        error: { kind: "historical-release-unavailable", pin },
      };
    }
    const actualDigest = CatalogReleaseDigest(row.release_digest);
    if (actualDigest !== pin.digest) {
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
    const loaded = await loadProjection(client, pin.id, "pinned", pin);
    if (!loaded) {
      return {
        ok: false,
        error: { kind: "historical-release-unavailable", pin },
      };
    }
    if (loaded.identity.id !== pin.id || loaded.identity.digest !== pin.digest) {
      return {
        ok: false,
        error: {
          kind: "digest-conflict",
          releaseId: pin.id,
          expected: pin.digest,
          actual: loaded.identity.digest,
        },
      };
    }
    return { ok: true, value: asPinned(loaded.snapshot, pin) };
  });

export const loadPinnedCatalogById = async (
  pool: pg.Pool,
  releaseId: CatalogReleaseId,
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> => {
  const resolved = await resolveCatalogReleasePin(pool, releaseId);
  if (!resolved.ok) {
    return resolved;
  }
  return loadPinnedCatalogSnapshot(pool, resolved.value);
};
