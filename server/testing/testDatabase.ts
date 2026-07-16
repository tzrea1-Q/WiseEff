import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, type Database } from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const migrationsDir = path.join(projectRoot, "server", "migrations");

/** Shared-DB transactional fixtures serialize on this advisory lock across vitest workers. */
const FIXTURE_ADVISORY_LOCK = 4_201_658;
const FIXTURE_LOCK_WAIT_MS = 120_000;
const FIXTURE_LOCK_POLL_MS = 50;

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

async function acquireFixtureLock(client: pg.Client): Promise<void> {
  const deadline = Date.now() + FIXTURE_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [
      FIXTURE_ADVISORY_LOCK
    ]);
    if (result.rows[0]?.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, FIXTURE_LOCK_POLL_MS));
  }
  throw new Error(
    `Timed out after ${FIXTURE_LOCK_WAIT_MS}ms waiting for shared PG fixture advisory lock ${FIXTURE_ADVISORY_LOCK}`
  );
}

export async function createInMemoryTestDatabase(): Promise<InMemoryTestDatabase> {
  await ensureMigrations();
  const client = new pg.Client({ connectionString: resolveTestDatabaseUrl() });
  await client.connect();
  let lockHeld = false;
  try {
    // Non-blocking try-lock with polling so timed-out vitest workers do not leave
    // a forever-blocked pg_advisory_lock wait that cascades under test:all.
    await acquireFixtureLock(client);
    lockHeld = true;
    await client.query("begin");
  } catch (error) {
    if (lockHeld) {
      await client.query("select pg_advisory_unlock($1)", [FIXTURE_ADVISORY_LOCK]).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    throw error;
  }

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
      try {
        await client.query("rollback");
      } finally {
        if (lockHeld) {
          await client.query("select pg_advisory_unlock($1)", [FIXTURE_ADVISORY_LOCK]).catch(() => undefined);
          lockHeld = false;
        }
        await client.end();
      }
    }
  };
}
