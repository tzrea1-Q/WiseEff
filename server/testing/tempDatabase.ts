import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, type Database } from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";
import { createSerializedTestQueryable } from "./testDatabase";

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** Absolute path to `server/migrations`, shared by suites that replay migrations manually. */
export const migrationsDir = path.join(projectRoot, "server", "migrations");

export function resolveTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}

export function adminConnectionString(database = "postgres"): string {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

export async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminConnectionString("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type TempDatabaseContext = {
  db: Database;
  connectionString: string;
};

export type WithTempDatabaseOptions = {
  /** Identifier fragment baked into the generated database name: `wiseeff_<prefix>_<ts>_<rand>`. */
  prefix: string;
  /**
   * Apply every repository migration before the callback runs. Defaults to true.
   * Suites that replay migrations selectively (upgrade/backfill tests) pass false
   * and drive `applyMigrations`/their own subset against `migrationsDir` themselves.
   */
  migrate?: boolean;
};

/**
 * Create a disposable PostgreSQL database, hand it to the callback, and drop it afterwards
 * regardless of outcome. Consolidates the per-suite copies that previously lived in the
 * parameter-topology, parameter-specs, and parameters/dashboard suites.
 */
export async function withTempDatabase<T>(
  options: WithTempDatabaseOptions,
  fn: (context: TempDatabaseContext) => Promise<T>
): Promise<T> {
  const dbName = `wiseeff_${options.prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
    /[^a-z0-9_]/gi,
    ""
  );
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });

  const connectionString = adminConnectionString(dbName);
  const client = new pg.Client({ connectionString });
  await client.connect();
  // FIFO-serialize queries on the single client so route handlers that fan out
  // concurrent queries stay deterministic (see testing-strategy: transactional FIFO).
  const db = createDatabase(
    createSerializedTestQueryable(async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    })
  );

  try {
    if (options.migrate !== false) {
      await applyMigrations(db, migrationsDir);
    }
    return await fn({ db, connectionString });
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

/**
 * Lazily connected `Database` handle for reconnect-style assertions (for example proving a
 * staged migration survives a fresh connection). The connection opens on first query.
 */
export function openDatabaseConnection(connectionString: string): {
  db: Database;
  close: () => Promise<void>;
} {
  const client = new pg.Client({ connectionString });
  let connected = false;
  const db = createDatabase({
    query: async (text, values = []) => {
      if (!connected) {
        await client.connect();
        connected = true;
      }
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  return {
    db,
    close: async () => {
      if (connected) {
        await client.end().catch(() => undefined);
      }
    }
  };
}
