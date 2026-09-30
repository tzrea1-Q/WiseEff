import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

import type { QueryResult } from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";
import { provisionPublicationRuntimeLogins } from "../modules/catalog-publication/runtime/provisionRuntimeLogins";
import { provisionPublicationRuntimeLogins as provisionLabRuntimeLogins } from "./labRuntimeLogins";
import { applyTestMigrations, migrationsDir, withTempDatabase } from "./tempDatabase";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  createSerializedTestQueryable,
  dropTestDatabase,
  hasTestClusterRoleCatalogLock,
  isTestDatabaseAvailable,
  withTestClusterRoleCatalogLock,
  type InMemoryTestDatabase
} from "./testDatabase";

describe("test database query scheduling", () => {
  it("routes server test migration imports through the cluster lease wrapper", () => {
    expect(applyMigrations).toBe(applyTestMigrations);
    expect(provisionPublicationRuntimeLogins).toBe(provisionLabRuntimeLogins);
  });

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

  it("waits for a closing client before dropping its ephemeral database", async () => {
    const ephemeral = await createEphemeralTestDatabase("closing");
    const client = new pg.Client({ connectionString: ephemeral.url });
    const errors: string[] = [];
    client.on("error", (error) => errors.push((error as Error & { code?: string }).code ?? error.message));
    await client.connect();
    const close = new Promise<void>((resolve, reject) => {
      setTimeout(() => void client.end().then(resolve, reject), 200);
    });

    try {
      await ephemeral.drop();
      await close;
      expect(errors).toEqual([]);
    } finally {
      await close;
      await ephemeral.drop();
    }
  });

  it("waits for a closing client in the temporary database helper", async () => {
    const errors: string[] = [];
    let close: Promise<void> | undefined;
    await withTempDatabase({ prefix: "cleanup_race", migrate: false }, async ({ connectionString }) => {
      const client = new pg.Client({ connectionString });
      client.on("error", (error) => errors.push((error as Error & { code?: string }).code ?? error.message));
      await client.connect();
      close = new Promise<void>((resolve, reject) => {
        setTimeout(() => void client.end().then(resolve, reject), 200);
      });
    });
    await close;
    expect(errors).toEqual([]);
  });

  it("reports the blocking connection and permits a later safe drop", async () => {
    const ephemeral = await createEphemeralTestDatabase("timeout");
    const client = new pg.Client({ connectionString: ephemeral.url });
    await client.connect();
    const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    try {
      await expect(ephemeral.drop()).rejects.toThrow(new RegExp(`Timed out waiting to drop test database .*${pid}`));
      expect((await client.query("select 1")).rowCount).toBe(1);
    } finally {
      await client.end();
      await ephemeral.drop();
    }
  });

  it("reports a connection that arrives between observation and drop", async () => {
    const ephemeral = await createEphemeralTestDatabase("lateconn");
    const name = new URL(ephemeral.url).pathname.slice(1);
    const adminUrl = new URL(ephemeral.url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    const late = new pg.Client({ connectionString: ephemeral.url });
    await admin.connect();
    let injected = false;
    let latePid = 0;
    let close: Promise<void> | undefined;
    const gatedAdmin = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        if (text.startsWith("drop database") && !injected) {
          injected = true;
          await late.connect();
          latePid = (await late.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
          close = new Promise<void>((resolve, reject) => {
            setTimeout(() => void late.end().then(resolve, reject), 6_000);
          });
        }
        return admin.query<Row>(text, values);
      }
    } as pg.Client;
    try {
      const dropError = await dropTestDatabase(gatedAdmin, name).then(() => null, (error: Error) => error);
      expect(dropError?.message).toMatch(new RegExp(`Timed out waiting to drop test database .*${latePid}`));
      expect(injected).toBe(true);
    } finally {
      await close;
      await admin.end();
      await ephemeral.drop();
    }
  });

  it("retries a transient late connection within the cleanup deadline", async () => {
    const ephemeral = await createEphemeralTestDatabase("lateclose");
    const name = new URL(ephemeral.url).pathname.slice(1);
    const adminUrl = new URL(ephemeral.url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    const late = new pg.Client({ connectionString: ephemeral.url });
    await admin.connect();
    let injected = false;
    let close: Promise<void> | undefined;
    const gatedAdmin = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        if (text.startsWith("drop database") && !injected) {
          injected = true;
          await late.connect();
          close = new Promise<void>((resolve, reject) => {
            setTimeout(() => void late.end().then(resolve, reject), 200);
          });
          throw Object.assign(new Error("database is being accessed by other users"), { code: "55006" });
        }
        return admin.query<Row>(text, values);
      }
    } as pg.Client;
    try {
      await dropTestDatabase(gatedAdmin, name);
      expect(injected).toBe(true);
    } finally {
      await close;
      await admin.end();
      await ephemeral.drop();
    }
  });
});

describe.skipIf(!databaseAvailable)("cluster role lifecycle lease", () => {
  it("serializes role migrations across databases while ordinary queries remain parallel", async () => {
    await withTempDatabase({ prefix: "role_lease_a", migrate: false }, async ({ db: a }) => {
      await withTempDatabase({ prefix: "role_lease_b", migrate: false }, async ({ db: b }) => {
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const acquired = new Promise<void>((resolve) => { entered = resolve; });
        const first = withTestClusterRoleCatalogLock(async () => {
          entered();
          await expect(withTestClusterRoleCatalogLock(async () => undefined))
            .rejects.toThrow("Nested test cluster role catalog lease");
          await held;
        });
        await acquired;
        let secondEntered = false;
        const second = withTestClusterRoleCatalogLock(async () => { secondEntered = true; });
        try {
          expect((await Promise.all([a.query("select 1"), b.query("select 1")])).map((r) => r.rows))
            .toEqual([[{ "?column?": 1 }], [{ "?column?": 1 }]]);
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(secondEntered).toBe(false);
        } finally {
          release();
          await Promise.all([first, second]);
        }
        expect(secondEntered).toBe(true);
        const applied = await Promise.all([
          applyTestMigrations(a, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }),
          applyTestMigrations(b, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }),
        ]);
        expect(applied.map((names) => names.at(-1))).toEqual([
          "0180_mod_d02_offline_capture.sql",
          "0180_mod_d02_offline_capture.sql",
        ]);
        await withTestClusterRoleCatalogLock(async () => {
          expect(await applyTestMigrations(a, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }))
            .toEqual([]);
        });
      });
    });
  }, 180_000);

  it("releases the lease after a callback throws", async () => {
    await expect(withTestClusterRoleCatalogLock(async () => {
      throw new Error("lease probe");
    })).rejects.toThrow("lease probe");
    await expect(withTestClusterRoleCatalogLock(async () => "acquired")).resolves.toBe("acquired");
    let releaseProbe!: () => void;
    const gate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    let inheritedContext!: Promise<boolean>;
    await withTestClusterRoleCatalogLock(async () => {
      inheritedContext = gate.then(() => hasTestClusterRoleCatalogLock());
    });
    releaseProbe();
    expect(await inheritedContext).toBe(false);
  });
});
