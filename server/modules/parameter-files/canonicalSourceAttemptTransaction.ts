import { isRootDatabase, type Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import {
  createCanonicalSourceAttempt,
  type CanonicalSourceAttempt,
} from "./canonicalSourceAttempt";

/**
 * Run a non-Agent database transaction with an attempt-owned source store.
 * Only the pool-backed root guarantees that rethrowing the callback error
 * follows a successful ROLLBACK. Other Database adapters retain objects.
 */
export async function withCanonicalSourceAttemptTransaction<T>(
  db: Database,
  objectStore: ObjectStore,
  callback: (tx: Database, attempt: CanonicalSourceAttempt) => Promise<T>,
): Promise<T> {
  const attempt = createCanonicalSourceAttempt(objectStore);
  let callbackFailed = false;
  let callbackError: unknown;
  try {
    return await db.transaction(async (tx) => {
      try {
        return await callback(tx, attempt);
      } catch (error) {
        callbackFailed = true;
        callbackError = error;
        throw error;
      }
    });
  } catch (error) {
    if (!isRootDatabase(db) || !callbackFailed || !Object.is(error, callbackError)) {
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
