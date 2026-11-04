import { EventEmitter } from "node:events";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type Database } from "./client";

function createFixture() {
  const db = createPostgresDatabase("postgres://unused/unused");
  const pool = getRootPostgresPool(db)!;
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [], rowCount: null })),
    release: vi.fn()
  });
  vi.spyOn(pool, "connect").mockImplementation(async () => {
    pool.emit("connect", client);
    return client as unknown as pg.PoolClient;
  });
  vi.spyOn(pool, "end").mockResolvedValue(undefined);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return { db, pool, client, log };
}

afterEach(() => vi.restoreAllMocks());

describe("PostgreSQL connection errors", () => {
  it("handles disconnects for raw pool borrowers without exposing error or client details", async () => {
    const { db, pool, client, log } = createFixture();
    try {
      const borrowed = await pool.connect();
      const disconnect = Object.assign(new Error("secret SQL and password"), { client: borrowed });

      expect(() => client.emit("error", disconnect)).not.toThrow();
      // The idle pool listener can also report the same failure after release.
      expect(() => pool.emit("error", disconnect, borrowed)).not.toThrow();
      expect(log.mock.calls).toEqual([["[database] PostgreSQL connection failed."]]);
      expect(client.query).not.toHaveBeenCalled();
      borrowed.release(disconnect);
    } finally {
      await db.close();
    }
  });

  it("handles pool errors even when no client error event preceded them", async () => {
    const { db, pool, client, log } = createFixture();
    try {
      expect(() => pool.emit("error", new Error("private connection options"), client)).not.toThrow();
      expect(log.mock.calls).toEqual([["[database] PostgreSQL connection failed."]]);
    } finally {
      await db.close();
    }
  });

  it("rejects a transaction disconnected while its callback is idle without replaying or committing", async () => {
    const { db, client } = createFixture();
    let resume!: () => void;
    let entered!: () => void;
    const idle = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const disconnect = new Error("Connection terminated unexpectedly");
    const onConfirmedRollback = vi.fn();
    const callback = vi.fn(async (tx: Database) => {
      await tx.query("insert into test_rows default values");
      entered();
      await idle;
      return "uncommitted result";
    });
    try {
      const transaction = db.transaction(callback, { onConfirmedRollback });
      const rejected = expect(transaction).rejects.toBe(disconnect);
      await started;
      expect(() => client.emit("error", disconnect)).not.toThrow();
      resume();
      await rejected;

      expect(callback).toHaveBeenCalledTimes(1);
      expect(client.query.mock.calls.map(([text]) => text)).toEqual(["begin", "insert into test_rows default values"]);
      expect(client.release).toHaveBeenCalledExactlyOnceWith(disconnect);
      expect(onConfirmedRollback).not.toHaveBeenCalled();
    } finally {
      resume();
      await db.close();
    }
  });

  it("preserves the callback failure when rollback also disconnects and discards the client", async () => {
    const { db, client } = createFixture();
    const initiating = new Error("callback failed");
    const disconnect = new Error("Connection terminated unexpectedly");
    const onConfirmedRollback = vi.fn();
    client.query.mockImplementation(async (text) => {
      if (text === "rollback") {
        client.emit("error", disconnect);
        throw disconnect;
      }
      return { rows: [], rowCount: null };
    });
    try {
      await expect(db.transaction(async () => { throw initiating; }, { onConfirmedRollback })).rejects.toBe(initiating);
      expect(client.query.mock.calls.map(([text]) => text)).toEqual(["begin", "rollback"]);
      expect(client.release).toHaveBeenCalledExactlyOnceWith(disconnect);
      expect(onConfirmedRollback).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("keeps an uncertain commit failure unconfirmed even if rollback succeeds", async () => {
    const { db, client } = createFixture();
    const uncertain = new Error("commit response lost");
    const onConfirmedRollback = vi.fn();
    client.query.mockImplementation(async (text) => {
      if (text === "commit") throw uncertain;
      return { rows: [], rowCount: null };
    });
    try {
      await expect(db.transaction(async () => "result", { onConfirmedRollback })).rejects.toBe(uncertain);
      expect(client.query.mock.calls.map(([text]) => text)).toEqual(["begin", "commit", "rollback"]);
      expect(onConfirmedRollback).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
});
