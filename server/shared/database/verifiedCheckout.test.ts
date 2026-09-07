import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ calls: [] as string[], releases: [] as unknown[], ends: 0, clients: [] as any[], acquisitionError: false }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class Pool {
    connect(callback?: (error: unknown, client: unknown, release: unknown) => void) {
      const client = Object.assign(new EventEmitter(), {
        query: async (sql: string) => { fixture.calls.push(sql); return { rows: [], rowCount: 0 }; },
        release: (destroy?: unknown) => { fixture.releases.push(destroy); },
      });
      fixture.clients.push(client);
      if (callback) {
        callback(null, client, client.release);
        if (fixture.acquisitionError) client.emit("error", new Error("private acquisition diagnostic"));
        return;
      }
      return Promise.resolve(client);
    }
    query(sql: string) {
      return new Promise((resolve, reject) => this.connect((error, client: any) => {
        if (error) { reject(error); return; }
        client.query(sql).then(resolve, reject).finally(() => client.release());
      }));
    }
    async end() { fixture.ends++; }
  }
  return { default: { Pool } };
});

import { createPostgresDatabase, getRootPostgresPool } from "./client";

beforeEach(() => { fixture.calls = []; fixture.releases = []; fixture.ends = 0; fixture.clients = []; fixture.acquisitionError = false; });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const paths = ["query", "transaction", "raw-promise", "raw-callback", "raw-query"] as const;

function use(db: ReturnType<typeof createPostgresDatabase>, mode: typeof paths[number]) {
  const pool = getRootPostgresPool(db)!;
  if (mode === "query") return db.query("caller");
  if (mode === "transaction") return db.transaction(tx => tx.query("caller"));
  if (mode === "raw-query") return pool.query("caller");
  if (mode === "raw-promise") return pool.connect().then(async client => {
    try { return await client.query("caller"); } finally { client.release(); }
  });
  return new Promise((resolve, reject) => pool.connect((error, client, release) => {
    if (error) { reject(error); return; }
    if (!client) { reject(new Error("missing checkout")); return; }
    client.query("caller").then(resolve, reject).finally(() => release());
  }));
}

it.each(paths)("holds %s until its actual checkout passes observation", async mode => {
  let proceed!: () => void;
  const wait = new Promise<void>(resolve => { proceed = resolve; });
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", {
    verifyCheckout: async session => {
      fixture.calls.push("observing");
      await wait;
      await session.query("physical-target-observation");
    },
  });
  const result = use(db, mode);
  await tick();
  expect(fixture.calls).toEqual(["observing"]);
  expect(fixture.releases).toEqual([]);
  proceed(); await result; await tick();
  expect(fixture.calls).toEqual(mode === "transaction"
    ? ["observing", "physical-target-observation", "begin", "caller", "commit"]
    : ["observing", "physical-target-observation", "caller"]);
  expect(fixture.releases).toEqual([undefined]);
  await db.close(); await db.close();
  expect(fixture.ends).toBe(1);
});

it.each(paths)("destroys refused %s checkout without exposing it or replacing the refusal", async mode => {
  const refusal = new Error("PCAT-TARGET-IDENTITY-MISMATCH");
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", {
    verifyCheckout: async () => { throw refusal; },
  });
  await expect(use(db, mode)).rejects.toBe(refusal);
  expect(fixture.calls).toEqual([]);
  expect(fixture.releases).toEqual([true]);
  await db.close();
});

it("rechecks every lease rather than caching a pool-wide approval", async () => {
  let attempts = 0;
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", {
    verifyCheckout: async () => { if (++attempts === 2) throw new Error("target-drift"); },
  });
  await db.query("first");
  await expect(db.query("second")).rejects.toThrow("target-drift");
  expect(fixture.calls).toEqual(["first"]);
  expect(fixture.releases).toEqual([undefined, true]);
  await db.close();
});

it.each(paths)("rejects %s when the client disconnects during asynchronous observation", async mode => {
  let proceed!: () => void;
  const wait = new Promise<void>(resolve => { proceed = resolve; });
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", {
    verifyCheckout: async session => { await wait; await session.query("late-probe"); },
  });
  const result = expect(use(db, mode)).rejects.toThrow("PCAT-DATABASE-CHECKOUT-CONNECTION-FAILED");
  await tick();
  const client = fixture.clients[0];
  expect(() => client.emit("error", new Error("private network diagnostic"))).not.toThrow();
  await result;
  expect(fixture.releases).toEqual([true]);
  proceed(); await tick();
  expect(fixture.calls).toEqual([]);
  expect(fixture.releases).toEqual([true]);
  client.emit("end");
  expect(client.listenerCount("error")).toBe(0);
  await db.close();
});

it("hands a successful lease to its caller without retaining verification listeners", async () => {
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", { verifyCheckout: async () => {} });
  const client = await getRootPostgresPool(db)!.connect();
  await tick();
  expect(client.listenerCount("error")).toBe(0);
  client.release(); await db.close();
});

it("holds an error listener before the actual acquisition callback returns to pg", async () => {
  fixture.acquisitionError = true;
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", { verifyCheckout: async () => {} });
  await expect(db.query("must-not-run")).rejects.toThrow("PCAT-DATABASE-CHECKOUT-CONNECTION-FAILED");
  expect(fixture.calls).toEqual([]);
  expect(fixture.releases).toEqual([true]);
  fixture.clients[0].emit("end");
  await db.close();
});

it.each(["promise", "callback"])("keeps the listener until the %s caller receives the lease", async mode => {
  const db = createPostgresDatabase("postgres://synthetic@invalid/unused", { verifyCheckout: async () => {} });
  const pool = getRootPostgresPool(db)!;
  let client: any;
  const receive = (value: any) => { client = value; expect(client.listenerCount("error")).toBe(1); };
  if (mode === "promise") receive(await pool.connect());
  else await new Promise<void>((resolve, reject) => pool.connect((error, value) => {
    if (error) { reject(error); return; }
    receive(value); resolve();
  }));
  await tick();
  expect(client.listenerCount("error")).toBe(0);
  client.release(); await db.close();
});

it.each([undefined, null, false, 0, "", "private diagnostic", { secret: "private" }].map((value, index) => ({ value, index })))
  ("turns non-Error checkout refusal $index into a static callback/promise error", async ({ value }) => {
    const db = createPostgresDatabase("postgres://synthetic@invalid/unused", { verifyCheckout: async () => { throw value; } });
    const pool = getRootPostgresPool(db)!;
    const callback = await new Promise<{ error: unknown; client: unknown }>(resolve =>
      pool.connect((error, client) => resolve({ error, client })));
    expect(callback.error).toBeInstanceOf(Error);
    expect((callback.error as Error).message).toBe("PCAT-DATABASE-CHECKOUT-VERIFICATION-FAILED");
    expect(callback.client).toBeUndefined();
    await expect(pool.connect()).rejects.toThrow("PCAT-DATABASE-CHECKOUT-VERIFICATION-FAILED");
    await expect(pool.query("must-not-run")).rejects.toThrow("PCAT-DATABASE-CHECKOUT-VERIFICATION-FAILED");
    expect(fixture.calls).toEqual([]);
    expect(fixture.releases).toEqual([true, true, true]);
    await db.close();
  });
