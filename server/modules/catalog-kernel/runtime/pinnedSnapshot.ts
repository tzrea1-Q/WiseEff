import pg from "pg";

import type {
  CatalogKernelError,
  CatalogReleasePin,
  Result,
} from "../../parameter-catalog-contract/index";
import type { PinnedCatalogSnapshot } from "../interface";
import { loadProjection } from "./currentSnapshot";

export const loadPinnedCatalogSnapshot = async (
  pool: pg.Pool,
  pin: CatalogReleasePin,
): Promise<Result<PinnedCatalogSnapshot, CatalogKernelError>> => {
  const loaded = await loadProjection(pool, pin.id);
  if (!loaded) {
    return {
      ok: false,
      error: { kind: "historical-release-unavailable", pin },
    };
  }
  if (loaded.identity.digest !== pin.digest || loaded.identity.id !== pin.id) {
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
  const snapshot: PinnedCatalogSnapshot = Object.assign(loaded.snapshot, {
    snapshotKind: "pinned" as const,
    pin,
  });
  return { ok: true, value: snapshot };
};
