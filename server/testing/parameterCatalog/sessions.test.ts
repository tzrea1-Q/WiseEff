import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupLeftoverParameterCatalogDatabases,
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "./database";
import {
  openIndependentCatalogSessions,
  type IndependentCatalogSession,
} from "./sessions";

describe("independent parameter catalog sessions", () => {
  let database: ParameterCatalogDatabase | undefined;
  let sessions: IndependentCatalogSession[] = [];

  afterAll(async () => {
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
    await database?.close().catch(() => undefined);
    await cleanupLeftoverParameterCatalogDatabases();
  });

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
});
