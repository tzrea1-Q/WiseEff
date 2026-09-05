import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  createCatalogKernel,
} from "../interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { installPublishedReleaseA } from "./catalogChain.fixture";

const waitForIdle = async (pool: pg.Pool): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pool.waitingCount === 0 && pool.idleCount === pool.totalCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("catalog snapshot pool lifecycle", () => {
  let database: ParameterCatalogDatabase | undefined;
  let pools: pg.Pool[] = [];

  afterEach(async () => {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    pools = [];
    await database?.close();
    database = undefined;
  });

  const open = async (label: string, max: number): Promise<{
    pool: pg.Pool;
    kernel: ReturnType<typeof createCatalogKernel>;
    pin: { id: ReturnType<typeof CatalogReleaseId>; digest: ReturnType<typeof CatalogReleaseDigest> };
  }> => {
    database = await createDisposableParameterCatalogDatabase(label);
    const pool = new pg.Pool({
      connectionString: database.url,
      max,
      connectionTimeoutMillis: 4_000,
    });
    pools.push(pool);
    const installed = await installPublishedReleaseA(pool);
    return {
      pool,
      kernel: createCatalogKernel(pool),
      pin: installed.pinA,
    };
  };

  it("CATFIX-POOL-01 installed current with pool max=1 completes without waiting for a second client", async () => {
    const { pool, kernel, pin } = await open("pool1", 1);
    const started = Date.now();
    const loaded = await kernel.loadCurrentCatalog(pin);
    expect(loaded.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(4_000);
    await waitForIdle(pool);
    expect(pool.waitingCount).toBe(0);
    expect(pool.totalCount).toBeLessThanOrEqual(1);
  }, 20_000);

  it("CATFIX-POOL-02 N requests with pool max=N all finish; waitingCount is 0 after", async () => {
    const n = 3;
    const { pool, kernel, pin } = await open("pooln", n);
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: n }, () => kernel.loadCurrentCatalog(pin)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
    await waitForIdle(pool);
    expect(pool.waitingCount).toBe(0);
  }, 30_000);

  it("CATFIX-POOL-03 more requests than pool size queue and complete without a nested-acquire deadlock", async () => {
    const { pool, kernel, pin } = await open("poolq", 2);
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => kernel.loadCurrentCatalog(pin)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
    await waitForIdle(pool);
    expect(pool.waitingCount).toBe(0);
  }, 30_000);

  it("CATFIX-POOL-04 query and commit faults release or destroy the client so the next request works", async () => {
    const { pool, kernel, pin } = await open("poolf", 1);
    const connect = pool.connect.bind(pool);
    let failQuery = true;
    pool.connect = (async () => {
      const client = await connect();
      const query = client.query.bind(client) as typeof client.query;
      client.query = ((text: unknown, values?: unknown) => {
        const sql = typeof text === "string" ? text : String((text as { text?: string })?.text ?? "");
        if (failQuery && sql.includes("catalog_release_subjects")) {
          return Promise.reject(new Error("injected mid-query failure"));
        }
        return query(text as never, values as never);
      }) as typeof client.query;
      return client;
    }) as typeof pool.connect;
    const failedQuery = await kernel.loadCurrentCatalog(pin);
    expect(failedQuery.ok).toBe(false);
    if (!failedQuery.ok) {
      expect(failedQuery.error.kind).toBe("storage-failure");
    }
    failQuery = false;
    const recoveredFromQuery = await kernel.loadCurrentCatalog(pin);
    expect(recoveredFromQuery.ok).toBe(true);

    let failCommit = true;
    pool.connect = (async () => {
      const client = await connect();
      const query = client.query.bind(client) as typeof client.query;
      client.query = ((text: unknown, values?: unknown) => {
        const sql = typeof text === "string" ? text : String((text as { text?: string })?.text ?? "");
        if (failCommit && sql === "commit") {
          return Promise.reject(new Error("injected commit failure"));
        }
        return query(text as never, values as never);
      }) as typeof client.query;
      return client;
    }) as typeof pool.connect;
    const failedCommit = await kernel.loadCurrentCatalog(pin);
    expect(failedCommit.ok).toBe(false);
    if (!failedCommit.ok) {
      expect(failedCommit.error.kind).toBe("storage-failure");
    }
    failCommit = false;
    pool.connect = connect;
    const recoveredFromCommit = await kernel.loadCurrentCatalog(pin);
    expect(recoveredFromCommit.ok).toBe(true);
    await waitForIdle(pool);
    expect(pool.waitingCount).toBe(0);
  }, 30_000);

  it("CATFIX-POOL-05 not-ready and digest mismatch do not leak connections", async () => {
    database = await createDisposableParameterCatalogDatabase("pool5");
    const pool = new pg.Pool({
      connectionString: database.url,
      max: 2,
      connectionTimeoutMillis: 4_000,
    });
    pools.push(pool);
    const kernel = createCatalogKernel(pool);
    const notReady = await kernel.loadCurrentCatalog({
      id: CatalogReleaseId("crel_missing"),
      digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
    });
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) {
      expect(notReady.error.kind).toBe("release-mismatch");
    }
    const installed = await installPublishedReleaseA(pool);
    const mismatch = await kernel.loadCurrentCatalog({
      id: installed.pinA.id,
      digest: CatalogReleaseDigest(`sha256:${"f".repeat(64)}`),
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.kind).toBe("release-mismatch");
    }
    const loaded = await kernel.loadCurrentCatalog(installed.pinA);
    expect(loaded.ok).toBe(true);
    await waitForIdle(pool);
    expect(pool.waitingCount).toBe(0);
    // Authentication refusal is owned by OP-01; Kernel not-ready and digest mismatch
    // are the connection-leak cases in this package.
  }, 30_000);
});
