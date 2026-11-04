import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { withTempDatabase } from "../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "./client";

const databaseAvailable = await isTestDatabaseAvailable();

function waitForBackendEnd(client: pg.PoolClient) {
  let dispose = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    const onEnd = () => {
      dispose();
      resolve();
    };
    const timeout = setTimeout(() => {
      dispose();
      reject(new Error("Timed out waiting for the terminated test backend to close"));
    }, 5_000);
    dispose = () => {
      clearTimeout(timeout);
      client.removeListener("end", onEnd);
    };
    // Observe end instead of error: an error listener in this test would hide
    // the original unhandled Client/Pool error regression.
    client.once("end", onEnd);
  });
  // The control connection can still be awaiting pg_terminate_backend when
  // the timeout fires. Keep the rejection handled until the caller awaits it.
  void promise.catch(() => undefined);
  return { promise, dispose: () => dispose() };
}

async function prepareIdleClient(root: RootDatabase) {
  const pool = getRootPostgresPool(root)!;
  const client = await pool.connect();
  try {
    const result = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    return { pool, client, pid: result.rows[0]!.pid };
  } finally {
    client.release();
  }
}

describe.skipIf(!databaseAvailable)("PostgreSQL connection recovery after backend termination", () => {
  it("rejects a checked-out idle transaction and serves the next query on a fresh connection", async () => {
    await withTempDatabase({ prefix: "client_tx_recovery", migrate: false }, async ({ db: control, connectionString }) => {
      await control.query("create table connection_recovery_probe (id integer primary key)");
      const root = createPostgresDatabase(connectionString);
      try {
        const { client, pid } = await prepareIdleClient(root);
        const ended = waitForBackendEnd(client);
        const onConfirmedRollback = vi.fn();
        let callbackCount = 0;
        let callbackCompleted = false;
        try {
          await expect(root.transaction(async (tx) => {
            callbackCount += 1;
            await tx.query("insert into connection_recovery_probe(id) values (1)");
            const current = await tx.query<{ pid: number }>("select pg_backend_pid() as pid");
            expect(current.rows[0]!.pid).toBe(pid);

            // This separate control session belongs to the same disposable
            // database. The checked-out transaction is idle while it waits.
            const killed = await control.query<{ terminated: boolean }>(
              "select pg_terminate_backend($1) as terminated", [pid]
            );
            expect(killed.rows[0]!.terminated).toBe(true);
            await ended.promise;
            callbackCompleted = true;
            return "uncommitted result";
          }, { onConfirmedRollback })).rejects.toMatchObject({ code: "57P01" });

          expect(callbackCount).toBe(1);
          expect(callbackCompleted).toBe(true);
          expect(onConfirmedRollback).not.toHaveBeenCalled();
          const recovered = await root.query<{ pid: number; count: number }>(
            "select pg_backend_pid() as pid, count(*)::integer as count from connection_recovery_probe"
          );
          expect(recovered.rows[0]!.pid).not.toBe(pid);
          expect(recovered.rows[0]!.count).toBe(0);
        } finally {
          ended.dispose();
        }
      } finally {
        await root.close();
      }
    });
  });

  it("removes a terminated idle pooled connection and serves the next query", async () => {
    await withTempDatabase({ prefix: "client_pool_recovery", migrate: false }, async ({ db: control, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      try {
        const { pool, client, pid } = await prepareIdleClient(root);
        const ended = waitForBackendEnd(client);
        try {
          expect(pool.idleCount).toBe(1);
          const killed = await control.query<{ terminated: boolean }>(
            "select pg_terminate_backend($1) as terminated", [pid]
          );
          expect(killed.rows[0]!.terminated).toBe(true);
          await ended.promise;

          expect(pool.totalCount).toBe(0);
          expect(pool.idleCount).toBe(0);
          const recovered = await root.query<{ pid: number; ok: number }>("select pg_backend_pid() as pid, 1 as ok");
          expect(recovered.rows[0]!.pid).not.toBe(pid);
          expect(recovered.rows[0]!.ok).toBe(1);
        } finally {
          ended.dispose();
        }
      } finally {
        await root.close();
      }
    });
  });
});
