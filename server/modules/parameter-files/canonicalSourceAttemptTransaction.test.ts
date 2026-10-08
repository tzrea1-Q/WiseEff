import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool, type Database } from "../../shared/database/client";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
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

describe("canonical source attempt confirmed PostgreSQL rollback", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("sourceattempt");
    db = createPostgresDatabase(database.url);
    await db.query("create table source_attempt_commit_test (id integer unique deferrable initially deferred)");
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
  });

  it("cleans after a callback failure and successful root rollback", async () => {
    const objectStore = createMemoryObjectStore();
    const failure = new Error("callback failure");
    await expect(withCanonicalSourceAttemptTransaction(db, objectStore, async (_tx, attempt) => {
      await putAttemptObject(attempt.objectStore);
      throw failure;
    })).rejects.toBe(failure);
    expect(objectStore.entries.size).toBe(0);
  });

  it("cleans after PostgreSQL rejects COMMIT with a deferred constraint error", async () => {
    const objectStore = createMemoryObjectStore();
    let callbackCompleted = false;
    await expect(withCanonicalSourceAttemptTransaction(db, objectStore, async (tx, attempt) => {
      await putAttemptObject(attempt.objectStore);
      await tx.query("insert into source_attempt_commit_test(id) values (1),(1)");
      callbackCompleted = true;
    })).rejects.toMatchObject({ code: "23505" });
    expect(callbackCompleted).toBe(true);
    expect(objectStore.entries.size).toBe(0);
    expect((await db.query("select count(*)::int as count from source_attempt_commit_test")).rows[0]).toEqual({ count: 0 });
  });

  it.each(["commit", "rollback"])("retains objects when the root %s outcome is unknown (simulation)", async (statement) => {
    const objectStore = createMemoryObjectStore();
    const pool = getRootPostgresPool(db)!;
    const client = await pool.connect();
    const query = client.query.bind(client);
    const failure = new Error(`simulated unknown ${statement} outcome`);
    const querySpy = vi.spyOn(client, "query");
    querySpy.mockImplementation(((...args: Parameters<typeof client.query>) => {
      if (args[0] === statement) return Promise.reject(failure);
      return Reflect.apply(query, client, args);
    }) as typeof client.query);
    const connectSpy = vi.spyOn(pool, "connect").mockImplementationOnce(() => Promise.resolve(client));
    try {
      await expect(withCanonicalSourceAttemptTransaction(db, objectStore, async (_tx, attempt) => {
        await putAttemptObject(attempt.objectStore);
        if (statement === "rollback") throw new Error("callback failure before unknown rollback");
      })).rejects.toThrow(statement === "commit" ? failure.message : "callback failure before unknown rollback");
      expect(objectStore.entries.size).toBe(1);
    } finally {
      querySpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
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
