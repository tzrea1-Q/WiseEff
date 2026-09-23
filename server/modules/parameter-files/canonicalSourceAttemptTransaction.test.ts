import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { createMemoryObjectStore } from "../../testing/objectStore";
import type { CanonicalSourceAttempt } from "./canonicalSourceAttempt";
import { withCanonicalSourceAttemptTransaction } from "./canonicalSourceAttemptTransaction";

function databaseWithTransaction(
  transaction: Database["transaction"],
): Database {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction,
  };
}

const putAttemptObject = async (
  attemptObjectStore: CanonicalSourceAttempt["objectStore"],
) => attemptObjectStore.put({
  organizationId: "org-attempt-transaction-test",
  fileName: "settings.json",
  contentType: "application/json",
  bytes: Buffer.from('{"value":1}\n'),
});

describe("canonical source attempt transaction", () => {
  it("retains objects when an untrusted adapter rethrows the callback error", async () => {
    const objectStore = createMemoryObjectStore();
    const callbackError = new Error("injected callback failure");
    const db = databaseWithTransaction(async (callback) => {
      try {
        return await callback(db);
      } catch (error) {
        throw error;
      }
    });

    await expect(
      withCanonicalSourceAttemptTransaction(db, objectStore, async (_tx, attempt) => {
        await putAttemptObject(attempt.objectStore);
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);
    expect(objectStore.entries).toHaveLength(1);
  });

  it("retains objects when a callback succeeds but the COMMIT result is unknown (simulation)", async () => {
    const objectStore = createMemoryObjectStore();
    const commitError = new Error("simulated unknown COMMIT result");
    const db = databaseWithTransaction(async (callback) => {
      await callback(db);
      throw commitError;
    });

    await expect(
      withCanonicalSourceAttemptTransaction(db, objectStore, async (_tx, attempt) => {
        await putAttemptObject(attempt.objectStore);
      }),
    ).rejects.toBe(commitError);
    expect(objectStore.entries).toHaveLength(1);
  });

  it("retains objects when ROLLBACK fails after the callback failure", async () => {
    const objectStore = createMemoryObjectStore();
    const rollbackError = new Error("injected ROLLBACK failure");
    const db = databaseWithTransaction(async (callback) => {
      try {
        await callback(db);
      } catch {
        throw rollbackError;
      }
      throw new Error("callback unexpectedly succeeded");
    });

    await expect(
      withCanonicalSourceAttemptTransaction(db, objectStore, async (_tx, attempt) => {
        await putAttemptObject(attempt.objectStore);
        throw new Error("injected callback failure");
      }),
    ).rejects.toBe(rollbackError);
    expect(objectStore.entries).toHaveLength(1);
  });
});
