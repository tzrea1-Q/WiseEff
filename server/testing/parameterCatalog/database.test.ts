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
  readCanonicalSchemaFingerprint,
  type ParameterCatalogDatabase,
} from "./index";

describe("parameter catalog database harness", () => {
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

describe("disposable real-pgvector parameter catalog database", () => {
  let database: ParameterCatalogDatabase | undefined;

  afterAll(async () => {
    await database?.close().catch(() => undefined);
    await cleanupLeftoverParameterCatalogDatabases();
  });

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

    const admin = new pg.Client({
      connectionString: connectionStringFor("postgres"),
    });
    await admin.connect();
    try {
      const exists = await admin.query<{ exists: boolean }>(
        "select exists(select 1 from pg_database where datname = $1) as exists",
        [leftoverName],
      );
      expect(exists.rows[0]?.exists).toBe(false);
    } finally {
      await admin.end();
    }
  });
});
