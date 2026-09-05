import pg from "pg";

import type {
  CatalogKernelError,
  CatalogKernelOperation,
  Result,
} from "../../parameter-catalog-contract/index";

export type CatalogSnapshotClient = Pick<pg.PoolClient, "query">;

export class CatalogSnapshotReadFailure extends Error {
  readonly kernelError: CatalogKernelError;

  constructor(kernelError: CatalogKernelError) {
    super(kernelError.kind);
    this.name = "CatalogSnapshotReadFailure";
    this.kernelError = kernelError;
  }
}

const storageFailure = (
  operation: CatalogKernelOperation,
  retryable: boolean,
): CatalogKernelError => ({
  kind: "storage-failure",
  operation,
  retryable,
});

const isConnectionBroken = (error: unknown): boolean => {
  if (error instanceof pg.DatabaseError) {
    const code = error.code ?? "";
    return code.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03";
  }
  return false;
};

const isRetryableStorage = (error: unknown): boolean => {
  if (error instanceof pg.DatabaseError && error.code === "23514") {
    return false;
  }
  return true;
};

const releaseClient = (client: pg.PoolClient, destroy: boolean): void => {
  try {
    client.release(destroy);
  } catch {
    try {
      client.release(true);
    } catch {
      // The client is already detached from the pool.
    }
  }
};

export const withCatalogReadTransaction = async <T>(
  pool: pg.Pool,
  operation: Extract<CatalogKernelOperation, "loadCurrentCatalog" | "loadPinnedCatalog">,
  work: (client: pg.PoolClient) => Promise<Result<T, CatalogKernelError>>,
): Promise<Result<T, CatalogKernelError>> => {
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
  } catch (error) {
    return { ok: false, error: storageFailure(operation, isRetryableStorage(error)) };
  }

  let transactionOpen = false;
  let destroy = false;
  try {
    await client.query("begin isolation level repeatable read read only");
    transactionOpen = true;
    const result = await work(client);
    await client.query("commit");
    transactionOpen = false;
    return result;
  } catch (error) {
    destroy = isConnectionBroken(error);
    if (transactionOpen) {
      try {
        await client.query("rollback");
        transactionOpen = false;
      } catch {
        destroy = true;
      }
    }
    if (error instanceof CatalogSnapshotReadFailure) {
      return { ok: false, error: error.kernelError };
    }
    return { ok: false, error: storageFailure(operation, isRetryableStorage(error)) };
  } finally {
    releaseClient(client, destroy);
  }
};
