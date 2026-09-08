import type pg from "pg";

/** Resource acquisition only: this does not verify a target or grant authority. */
export async function acquireObservedManagementClient(pool: pg.Pool, onError: () => void): Promise<pg.PoolClient> {
  let failed = false, acquired: pg.PoolClient | undefined;
  const observe = () => { failed = true; onError(); };
  try {
    const client = await new Promise<pg.PoolClient>((resolve, reject) => {
      try {
        pool.connect((error, value) => {
          if (value) { acquired = value; value.on("error", observe); }
          if (error || !value) { observe(); reject(new Error("checkout-failed")); }
          else resolve(value);
        });
      } catch { observe(); reject(new Error("checkout-failed")); }
    });
    if (failed) throw new Error("checkout-failed");
    // Listener remains with this lease through the caller's release(true).
    return client;
  } catch {
    acquired?.release(true);
    throw new Error("PCAT-UPG-LEGACY-LOGIN-CONNECTION-FAILED");
  }
}
