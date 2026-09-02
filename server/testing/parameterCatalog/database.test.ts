import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  S2_SCH_CONTRACT_FINGERPRINT,
  assertCheckedEmptyCatalog,
  assertCheckedEmptyDatabase,
  assertRealPostgresUrl,
  cleanupLeftoverParameterCatalogDatabases,
  connectionStringFor,
  countUserDefinedObjects,
  createCheckedEmptyDatabase,
  createDisposableParameterCatalogDatabase,
  parameterCatalogRunDatabasePrefix,
  parameterCatalogWorkerDatabasePrefix,
  readCanonicalSchemaFingerprint,
  type ParameterCatalogDatabase,
} from "./index";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;

async function withPostgresAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: connectionStringFor("postgres") });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

async function databaseExists(name: string): Promise<boolean> {
  return withPostgresAdmin(async (admin) => {
    const result = await admin.query<{ exists: boolean }>(
      "select exists(select 1 from pg_database where datname = $1) as exists",
      [name],
    );
    return result.rows[0]?.exists === true;
  });
}

describe("parameter catalog database harness", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  it("rejects PGLite, SQLite, and in-memory URLs as catalog evidence", () => {
    expect(() => assertRealPostgresUrl("pglite://memory")).toThrow(/PGLite|in-memory|fake/i);
    expect(() => assertRealPostgresUrl("postgres://localhost/pglite")).toThrow(
      /PGLite|in-memory|fake/i,
    );
    expect(() => assertRealPostgresUrl("postgresql://127.0.0.1:5432/:memory:")).toThrow(
      /PGLite|in-memory|fake/i,
    );
    expect(() => assertRealPostgresUrl("sqlite://tmp/catalog.db")).toThrow(
      /PGLite|SQLite|in-memory|fake|postgres/i,
    );
    expect(() => assertRealPostgresUrl("memory://catalog")).toThrow(
      /PGLite|in-memory|fake|postgres/i,
    );
    expect(() => assertRealPostgresUrl("postgres://memory/catalog")).toThrow(/in-memory/i);
  });

  it("rejects shared-session style non-postgres engines", () => {
    expect(() => assertRealPostgresUrl("postgres-js://localhost/catalog")).toThrow(
      /PGLite|in-memory|fake/i,
    );
    expect(() => assertRealPostgresUrl("pg-mem://catalog")).toThrow(/PGLite|in-memory|fake/i);
  });
});

describe("disposable real-pgvector parameter catalog database", {
  timeout: CATALOG_TEST_TIMEOUT_MS,
}, () => {
  let database: ParameterCatalogDatabase | undefined;

  afterAll(async () => {
    await database?.close().catch(() => undefined);
    await cleanupLeftoverParameterCatalogDatabases();
  }, CATALOG_HOOK_TIMEOUT_MS);

  it("creates a checked-empty frozen-schema database on a real pgvector server", async () => {
    database = await createDisposableParameterCatalogDatabase("schema");
    expect(database.schemaFingerprint).toBe(S2_SCH_CONTRACT_FINGERPRINT);
    expect(database.serverVersion.length).toBeGreaterThan(0);
    expect(database.pgvectorVersion).toMatch(/^\d+\.\d+/);
    expect(await readCanonicalSchemaFingerprint(database.url)).toBe(
      S2_SCH_CONTRACT_FINGERPRINT,
    );
    await assertCheckedEmptyCatalog(database.url);

    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      const identity = await client.query<{
        version: string;
        vector: string | null;
        pid_a: number;
      }>(`
        select
          version() as version,
          (select extversion from pg_extension where extname = 'vector') as vector,
          pg_backend_pid() as pid_a
      `);
      expect(identity.rows[0]?.version).toMatch(/PostgreSQL/);
      expect(identity.rows[0]?.vector).toBeTruthy();
    } finally {
      await client.end();
    }
  });

  it("creates a user-object-empty database and drops leftover harness databases", async () => {
    const leftover = await createCheckedEmptyDatabase("leftover");
    expect(await countUserDefinedObjects(leftover.url)).toBe(0);
    await assertCheckedEmptyDatabase(leftover.url);

    const dirty = new pg.Client({ connectionString: leftover.url });
    await dirty.connect();
    try {
      await dirty.query("create schema leftover_probe");
    } finally {
      await dirty.end();
    }
    expect(await countUserDefinedObjects(leftover.url)).toBeGreaterThan(0);
    await expect(assertCheckedEmptyDatabase(leftover.url)).rejects.toThrow(/user-defined objects/);

    const leftoverName = leftover.name;
    await leftover.abandon();
    const dropped = await cleanupLeftoverParameterCatalogDatabases();
    expect(dropped).toContain(leftoverName);
    expect(await databaseExists(leftoverName)).toBe(false);
  });

  it("reaps this worker and other-run leftovers, skipping live backends and siblings", async () => {
    expect(parameterCatalogWorkerDatabasePrefix().startsWith(parameterCatalogRunDatabasePrefix())).toBe(
      true,
    );
    const live = await createCheckedEmptyDatabase("livebk");
    expect(live.name.startsWith(parameterCatalogWorkerDatabasePrefix())).toBe(true);
    const liveClient = new pg.Client({ connectionString: live.url });
    await liveClient.connect();
    const foreignName = `wiseeff_pcat_foreignrun_probe_${randomBytes(3).toString("hex")}`;
    const siblingName = `${parameterCatalogRunDatabasePrefix()}sibling_probe_${randomBytes(3).toString("hex")}`;
    await withPostgresAdmin(async (admin) => {
      await admin.query(`drop database if exists ${foreignName} with (force)`);
      await admin.query(`drop database if exists ${siblingName} with (force)`);
      await admin.query(`create database ${foreignName}`);
      await admin.query(`create database ${siblingName}`);
    });
    try {
      await live.abandon();
      const droppedWhileLive = await cleanupLeftoverParameterCatalogDatabases();
      expect(droppedWhileLive).not.toContain(live.name);
      expect(droppedWhileLive).not.toContain(siblingName);
      expect(droppedWhileLive).toContain(foreignName);
      expect(await databaseExists(live.name)).toBe(true);
      expect(await databaseExists(siblingName)).toBe(true);
      expect(await databaseExists(foreignName)).toBe(false);

      await liveClient.end();
      const droppedAfterDisconnect = await cleanupLeftoverParameterCatalogDatabases();
      expect(droppedAfterDisconnect).toContain(live.name);
      expect(droppedAfterDisconnect).not.toContain(siblingName);
      expect(await databaseExists(live.name)).toBe(false);
      expect(await databaseExists(siblingName)).toBe(true);
    } finally {
      await liveClient.end().catch(() => undefined);
      await cleanupLeftoverParameterCatalogDatabases().catch(() => undefined);
      await withPostgresAdmin(async (admin) => {
        await admin.query(`drop database if exists ${foreignName} with (force)`);
        await admin.query(`drop database if exists ${siblingName} with (force)`);
      }).catch(() => undefined);
    }
  });

  it("drops abandoned schema clones and treats later close as safe", async () => {
    const schemaDb = await createDisposableParameterCatalogDatabase("abandn");
    const name = schemaDb.name;
    await schemaDb.abandon();
    await expect(schemaDb.close()).resolves.toBeUndefined();
    await cleanupLeftoverParameterCatalogDatabases();
    expect(await databaseExists(name)).toBe(false);
    await expect(schemaDb.close()).resolves.toBeUndefined();
  });
});
