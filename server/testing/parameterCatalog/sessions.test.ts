import { afterAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import {
  cleanupLeftoverParameterCatalogDatabases,
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "./database";
import {
  openIndependentCatalogSessions,
  type IndependentCatalogSession,
} from "./sessions";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;

describe("independent parameter catalog sessions", {
  timeout: CATALOG_TEST_TIMEOUT_MS,
}, () => {
  let database: ParameterCatalogDatabase | undefined;
  let sessions: IndependentCatalogSession[] = [];

  afterAll(async () => {
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
    await database?.close().catch(() => undefined);
    await cleanupLeftoverParameterCatalogDatabases();
  }, CATALOG_HOOK_TIMEOUT_MS);

  it("refuses to treat a single shared session as independent catalog evidence", async () => {
    database = await createDisposableParameterCatalogDatabase("sessions");
    await expect(openIndependentCatalogSessions(database.url, 1)).rejects.toThrow(
      /at least two dedicated pools/,
    );
  });

  it("gives two clients distinct backends that cannot share a transaction", async () => {
    database ??= await createDisposableParameterCatalogDatabase("sessions");
    sessions = await openIndependentCatalogSessions(database.url, 2);
    const [sessionA, sessionB] = sessions;

    expect(sessionA.backendPid).not.toBe(sessionB.backendPid);

    const activity = await sessionB.query<{ pid: number }>(
      `select pid from pg_catalog.pg_stat_activity where pid = any($1::int[])`,
      [[sessionA.backendPid, sessionB.backendPid]],
    );
    expect(new Set(activity.rows.map((row) => row.pid))).toEqual(
      new Set([sessionA.backendPid, sessionB.backendPid]),
    );

    await sessionA.begin();
    await sessionA.query(
      `
      insert into parameter_catalog.catalog_releases (
        id, release_sequence, release_version, release_digest,
        compiled_model_digest, toolchain_digest, published_at
      ) values (
        'crel-session-a', 81001, 'session-a', 'sha256:session-a',
        'sha256:session-a-model', 'sha256:session-a-tool', '2026-09-03T00:00:00Z'
      )
    `,
    );

    const uncommitted = await sessionB.query<{ n: string }>(
      `select count(*)::bigint as n from parameter_catalog.catalog_releases where id = 'crel-session-a'`,
    );
    expect(Number(uncommitted.rows[0]?.n)).toBe(0);

    await sessionA.commit();

    const committed = await sessionB.query<{ n: string }>(
      `select count(*)::bigint as n from parameter_catalog.catalog_releases where id = 'crel-session-a'`,
    );
    expect(Number(committed.rows[0]?.n)).toBe(1);
  });

  it("closes already-opened sessions when a later connect fails", async () => {
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
    sessions = [];
    database ??= await createDisposableParameterCatalogDatabase("sessions");
    const catalog = database;
    const originalConnect = pg.Pool.prototype.connect;
    let connectCount = 0;
    const spy = vi.spyOn(pg.Pool.prototype, "connect").mockImplementation(function (
      this: pg.Pool,
    ) {
      connectCount += 1;
      if (connectCount >= 2) {
        return Promise.reject(new Error("injected catalog session connect failure"));
      }
      return Reflect.apply(originalConnect, this, []) as Promise<pg.PoolClient>;
    });

    try {
      await expect(openIndependentCatalogSessions(catalog.url, 2)).rejects.toThrow(
        /injected catalog session connect failure/,
      );
    } finally {
      spy.mockRestore();
    }

    const observer = new pg.Client({ connectionString: catalog.url });
    await observer.connect();
    try {
      await expect
        .poll(async () => {
          const leftover = await observer.query<{ n: string }>(
            `select count(*)::bigint as n
             from pg_catalog.pg_stat_activity
             where datname = current_database()
               and pid <> pg_backend_pid()
               and backend_type = 'client backend'`,
          );
          return Number(leftover.rows[0]?.n);
        })
        .toBe(0);
    } finally {
      await observer.end();
    }
  });
});
