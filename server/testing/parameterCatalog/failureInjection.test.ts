import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  cleanupLeftoverParameterCatalogDatabases,
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "./database";
import {
  CatalogCommitInjectedFailure,
  injectFailureAndRollback,
} from "./failureInjection";
import { openIndependentCatalogSessions } from "./sessions";

async function countRelease(
  session: { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult<{ n: string }>> },
  id: string,
): Promise<number> {
  const result = await session.query(
    `select count(*)::bigint as n from parameter_catalog.catalog_releases where id = $1`,
    [id],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe("parameter catalog commit failure injection", () => {
  let database: ParameterCatalogDatabase | undefined;

  afterAll(async () => {
    await database?.close().catch(() => undefined);
    await cleanupLeftoverParameterCatalogDatabases();
  });

  it("rolls back an injected application failure before COMMIT", async () => {
    database = await createDisposableParameterCatalogDatabase("failapp");
    const [writer, observer] = await openIndependentCatalogSessions(database.url, 2);
    try {
      const error = await injectFailureAndRollback(
        writer,
        "application-before-commit",
        async () => {
          await writer.query(`
            insert into parameter_catalog.catalog_releases (
              id, release_sequence, release_version, release_digest,
              compiled_model_digest, toolchain_digest, published_at
            ) values (
              'crel-app-fail', 82001, 'app-fail', 'sha256:app-fail',
              'sha256:app-fail-model', 'sha256:app-fail-tool', '2026-09-03T00:00:00Z'
            )
          `);
        },
      );
      expect(error).toBeInstanceOf(CatalogCommitInjectedFailure);
      expect(await countRelease(observer, "crel-app-fail")).toBe(0);
      expect(await countRelease(writer, "crel-app-fail")).toBe(0);
    } finally {
      await writer.close();
      await observer.close();
    }
  });

  it("rolls back a deferred unique violation that surfaces at COMMIT", async () => {
    database ??= await createDisposableParameterCatalogDatabase("failcmt");
    const [writer, observer] = await openIndependentCatalogSessions(database.url, 2);
    try {
      const error = await injectFailureAndRollback(
        writer,
        "deferred-constraint-at-commit",
        async () => {
          await writer.query(`
            insert into parameter_catalog.catalog_releases (
              id, release_sequence, release_version, release_digest,
              compiled_model_digest, toolchain_digest, published_at
            ) values
              (
                'crel-defer-a', 83001, 'defer-a', 'sha256:defer-a',
                'sha256:defer-a-model', 'sha256:defer-a-tool', '2026-09-03T00:00:00Z'
              ),
              (
                'crel-defer-b', 83001, 'defer-b', 'sha256:defer-b',
                'sha256:defer-b-model', 'sha256:defer-b-tool', '2026-09-03T00:00:00Z'
              )
          `);
        },
      );
      expect(error).toBeInstanceOf(pg.DatabaseError);
      expect((error as pg.DatabaseError).code).toBe("23505");
      expect((error as pg.DatabaseError).constraint).toBe("catalog_release_sequence_unique");
      expect(await countRelease(observer, "crel-defer-a")).toBe(0);
      expect(await countRelease(observer, "crel-defer-b")).toBe(0);
    } finally {
      await writer.close();
      await observer.close();
    }
  });
});
