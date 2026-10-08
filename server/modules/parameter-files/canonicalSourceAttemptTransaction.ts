import { isRootDatabase, type Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import {
  createCanonicalSourceAttempt,
  type CanonicalSourceAttempt,
} from "./canonicalSourceAttempt";

/**
 * Run a non-Agent database transaction with an attempt-owned source store.
 * Only the pool-backed root can confirm rollback, including a server-rejected
 * COMMIT. Other Database adapters and unknown COMMIT outcomes retain objects.
 */
export async function withCanonicalSourceAttemptTransaction<T>(
  db: Database,
  objectStore: ObjectStore,
  callback: (tx: Database, attempt: CanonicalSourceAttempt) => Promise<T>,
): Promise<T> {
  const attempt = createCanonicalSourceAttempt(objectStore);
  let rollbackConfirmed = false;
  try {
    return await db.transaction((tx) => callback(tx, attempt), {
      onConfirmedRollback: () => { rollbackConfirmed = true; },
    });
  } catch (error) {
    if (!isRootDatabase(db) || !rollbackConfirmed) {
      // COMMIT or ROLLBACK failed, or its result is unknown. Deleting the
      // object could destroy a source referenced by a transaction that committed.
      throw error;
    }
    try {
      await attempt.cleanupAfterConfirmedRollback();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Canonical source transaction rolled back but object cleanup failed.",
      );
    }
    throw error;
  }
}
