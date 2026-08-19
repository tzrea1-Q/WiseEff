import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type { QueryResult } from "../shared/database/client";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  createSerializedTestQueryable,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "./testDatabase";

describe("test database query scheduling", () => {
  it("serializes concurrent service queries on the transaction client", async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    const execute = vi.fn(async <Row>(text: string): Promise<QueryResult<Row>> => {
      activeQueries += 1;
      maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      activeQueries -= 1;
      return { rows: [{ text }] as Row[], rowCount: 1 };
    });
    const queryable = createSerializedTestQueryable(execute);

    const results = await Promise.all([
      queryable.query<{ text: string }>("first"),
      queryable.query<{ text: string }>("second"),
      queryable.query<{ text: string }>("third")
    ]);

    expect(maximumConcurrentQueries).toBe(1);
    expect(results.map((result) => result.rows[0]?.text)).toEqual(["first", "second", "third"]);
  });
});

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("test database fixture transactions", () => {
  let db: InMemoryTestDatabase | undefined;

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("commits nested transactions and rolls back only the failing inner scope", async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`create temporary table fixture_tx_rows (label text) on commit drop`);

    await db.transaction(async (tx) => {
      await tx.query(`insert into fixture_tx_rows (label) values ('outer')`);
      await tx
        .transaction(async (inner) => {
          await inner.query(`insert into fixture_tx_rows (label) values ('inner')`);
          throw new Error("inner failure");
        })
        .catch(() => undefined);
      await tx.query(`insert into fixture_tx_rows (label) values ('after')`);
    });

    const rows = await db.query<{ label: string }>(`select label from fixture_tx_rows order by label`);
    expect(rows.rows.map((row) => row.label)).toEqual(["after", "outer"]);
  });

  it("rolls back a failed service transaction without aborting the fixture session", async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`create temporary table fixture_tx_rows (label text) on commit drop`);

    await expect(
      db.transaction(async (tx) => {
        await tx.query(`insert into fixture_tx_rows (label) values ('doomed')`);
        // Force a real Postgres error so the transaction enters the aborted state.
        await tx.query(`select * from fixture_missing_table`);
      })
    ).rejects.toThrow();

    // The savepoint rollback must recover the session: further queries succeed
    // and the doomed write is gone.
    const rows = await db.query<{ label: string }>(`select label from fixture_tx_rows`);
    expect(rows.rows).toEqual([]);
  });

  it("keeps ephemeral committed writes off the shared worker rollback fixture", async () => {
    const ephemeral = await createEphemeralTestDatabase("pollute");
    const client = new pg.Client({ connectionString: ephemeral.url });
    await client.connect();
    try {
      await client.query(
        `insert into organizations (id, name) values ('org-eph-leak', 'Eph Leak')`
      );
    } finally {
      await client.end();
    }

    db = await createInMemoryTestDatabase();
    try {
      const leaked = await db.query<{ id: string }>(
        `select id from organizations where id = 'org-eph-leak'`
      );
      expect(leaked.rows).toEqual([]);
    } finally {
      await ephemeral.drop();
    }
  });
});
