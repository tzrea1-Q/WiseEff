import pg from "pg";

import { PUBLICATION_GUARD_FUNCTION_IDENTITY } from "../security/catalogRoleManifest";
import type { CatalogKernelError } from "../../parameter-catalog-contract/index";

/** S2-SCH repository-wide Catalog current-pointer advisory lock. */
export const CURRENT_POINTER_LOCK_KEY = 688004000041;

/** CP-05 lock order: exclusive current-pointer lock, then publication guard. */
export const CATALOG_ACTIVATION_LOCK_ORDER = [
  "parameter_catalog.acquire_current_pointer_lock_exclusive()",
  PUBLICATION_GUARD_FUNCTION_IDENTITY,
] as const;

export const SYNCHRONIZATION_BUSY: CatalogKernelError = Object.freeze({
  kind: "synchronization-busy",
  retryable: true as const,
});

export type CatalogLockClient = Pick<pg.Client, "query">;

export const isSynchronizationBusyError = (error: unknown): boolean =>
  error instanceof pg.DatabaseError && error.code === "PCA05";

export const acquireCurrentPointerLockExclusive = async (
  client: CatalogLockClient,
): Promise<void> => {
  await client.query(
    "select parameter_catalog.acquire_current_pointer_lock_exclusive()",
  );
};

export const acquirePublicationGuardLock = async (
  client: CatalogLockClient,
): Promise<void> => {
  await client.query(`select ${PUBLICATION_GUARD_FUNCTION_IDENTITY}`);
};
