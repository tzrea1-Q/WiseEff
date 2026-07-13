import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, type Database } from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const migrationsDir = path.join(projectRoot, "server", "migrations");

let migrationsApplied = false;

export type InMemoryTestDatabase = Database & {
  rollback: () => Promise<void>;
};

function resolveTestDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}

export async function isTestDatabaseAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: resolveTestDatabaseUrl(),
    connectionTimeoutMillis: 2_000
  });

  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureMigrations() {
  if (migrationsApplied) return;
  const client = new pg.Client({ connectionString: resolveTestDatabaseUrl() });
  await client.connect();
  try {
    const db = createDatabase({
      query: async (text, values = []) => {
        const result = await client.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      }
    });
    await applyMigrations(db, migrationsDir);
    migrationsApplied = true;
  } finally {
    await client.end();
  }
}

export async function createInMemoryTestDatabase(): Promise<InMemoryTestDatabase> {
  await ensureMigrations();
  const client = new pg.Client({ connectionString: resolveTestDatabaseUrl() });
  await client.connect();
  await client.query("begin");

  const queryable = {
    query: async (text: string, values: unknown[] = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  };

  // Keep all writes inside the outer BEGIN so afterEach rollback isolates tests.
  // createDatabase().transaction() issues COMMIT and would persist nested service writes.
  return {
    query: queryable.query,
    transaction: async <T,>(fn: (tx: typeof queryable) => Promise<T>) => fn(queryable),
    rollback: async () => {
      await client.query("rollback");
      await client.end();
    }
  };
}
