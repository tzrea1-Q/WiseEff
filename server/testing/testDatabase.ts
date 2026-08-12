import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  createDatabase,
  createSavepointDatabase,
  type Database,
  type Queryable,
  type QueryResult
} from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";
import { resolveParameterIdentityMode } from "../modules/parameters/parameterIdentityMode";

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const migrationsDir = path.join(projectRoot, "server", "migrations");

/**
 * Serializes only the rare template-build moment. Individual suites no longer take a
 * cluster-wide lock: every vitest fork works in its own database cloned from a
 * migrations-fingerprinted template, so suites parallelize freely and local runs see the
 * same fresh schema state as CI (no dependence on the dev database's cutover state).
 */
const TEMPLATE_BUILD_LOCK = 4_201_659;
const TEMPLATE_LOCK_WAIT_MS = 120_000;
const TEMPLATE_LOCK_POLL_MS = 50;

const TEMPLATE_PREFIX = "wiseeff_test_tpl_";
const WORKER_PREFIX = "wiseeff_test_wk_";

let cachedFingerprint: string | null = null;
let workerDatabaseUrl: string | null = null;

export type InMemoryTestDatabase = Database & {
  rollback: () => Promise<void>;
};

export function createSerializedTestQueryable(
  execute: <Row>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>
): Queryable {
  let queue: Promise<void> = Promise.resolve();

  return {
    query: <Row>(text: string, values: unknown[] = []) => {
      const pending = queue.then(() => execute<Row>(text, values));
      queue = pending.then(
        () => undefined,
        () => undefined
      );
      return pending;
    }
  };
}

function resolveTestDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}

function connectionStringFor(database: string) {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
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

async function migrationsFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint;
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(migrationsDir, file), "utf8"));
    hash.update("\0");
  }
  cachedFingerprint = hash.digest("hex").slice(0, 12);
  return cachedFingerprint;
}

async function databaseExists(admin: pg.Client, name: string): Promise<boolean> {
  const result = await admin.query<{ ok: boolean }>(
    "select true as ok from pg_database where datname = $1",
    [name]
  );
  return Boolean(result.rows[0]?.ok);
}

async function acquireTemplateLock(admin: pg.Client): Promise<void> {
  const deadline = Date.now() + TEMPLATE_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await admin.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [
      TEMPLATE_BUILD_LOCK
    ]);
    if (result.rows[0]?.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, TEMPLATE_LOCK_POLL_MS));
  }
  throw new Error(
    `Timed out after ${TEMPLATE_LOCK_WAIT_MS}ms waiting for test template build lock ${TEMPLATE_BUILD_LOCK}`
  );
}

async function dropStaleTestDatabases(admin: pg.Client, keepFingerprint: string): Promise<void> {
  const rows = await admin.query<{ datname: string }>(
    `select datname
     from pg_database
     where (datname like '${TEMPLATE_PREFIX}%' or datname like '${WORKER_PREFIX}%')
       and datname not like '%${keepFingerprint}%'`
  );
  for (const row of rows.rows) {
    await admin
      .query(`drop database if exists ${row.datname} with (force)`)
      .catch(() => undefined);
  }
}

async function ensureTemplateDatabase(admin: pg.Client, fingerprint: string): Promise<string> {
  const templateName = `${TEMPLATE_PREFIX}${fingerprint}`;
  if (await databaseExists(admin, templateName)) {
    return templateName;
  }

  // Build under a temporary name, then rename, so an interrupted build can never be
  // mistaken for a complete template. Caller holds the template build lock.
  const buildName = `wiseeff_test_tplbuild_${process.pid}`;
  await admin.query(`drop database if exists ${buildName} with (force)`);
  await admin.query(`create database ${buildName}`);

  const buildClient = new pg.Client({ connectionString: connectionStringFor(buildName) });
  await buildClient.connect();
  try {
    const db = createDatabase({
      query: async (text, values = []) => {
        const result = await buildClient.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      }
    });
    await applyMigrations(db, migrationsDir);
  } finally {
    await buildClient.end().catch(() => undefined);
  }

  await admin.query(`alter database ${buildName} rename to ${templateName}`);
  await dropStaleTestDatabases(admin, fingerprint);
  return templateName;
}

function currentRunToken(): string {
  // Set by server/testing/globalSetup.ts for vitest runs; the pid fallback covers
  // direct harness use outside the configured suite.
  return (process.env.WISEEFF_TEST_RUN_TOKEN?.trim() || `p${process.pid}`).replace(
    /[^a-z0-9_]/gi,
    ""
  );
}

function currentPoolId(): string {
  return (process.env.VITEST_POOL_ID?.trim() || String(process.pid)).replace(/[^a-z0-9_]/gi, "");
}

/**
 * Run-scoped setup: stamp the run token, pre-build the migrations template so no suite
 * pays the build inside its own test budget, and reap orphaned worker databases left by
 * crashed runs (connection-free databases carrying a different run token).
 */
export async function setupTestDatabaseRun(): Promise<void> {
  process.env.WISEEFF_TEST_RUN_TOKEN = `r${process.pid}`;
  const fingerprint = await migrationsFingerprint();
  const admin = new pg.Client({ connectionString: connectionStringFor("postgres") });
  await admin.connect();
  try {
    await acquireTemplateLock(admin);
    try {
      await ensureTemplateDatabase(admin, fingerprint);
      const orphans = await admin.query<{ datname: string }>(
        `select datname
         from pg_database d
         where datname like '${WORKER_PREFIX}%'
           and datname not like '%_${currentRunToken()}_%'
           and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`
      );
      for (const row of orphans.rows) {
        // No force: if another live run connects between the check and the drop, the
        // drop fails and we leave their database alone.
        await admin.query(`drop database if exists ${row.datname}`).catch(() => undefined);
      }
    } finally {
      await admin
        .query("select pg_advisory_unlock($1)", [TEMPLATE_BUILD_LOCK])
        .catch(() => undefined);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/** Run-scoped teardown: drop this run's worker databases. */
export async function teardownTestDatabaseRun(): Promise<void> {
  const token = currentRunToken();
  const admin = new pg.Client({ connectionString: connectionStringFor("postgres") });
  await admin.connect();
  try {
    const rows = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname like '${WORKER_PREFIX}%' and datname like '%_${token}_%'`
    );
    for (const row of rows.rows) {
      await admin
        .query(`drop database if exists ${row.datname} with (force)`)
        .catch(() => undefined);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function ensureWorkerDatabase(): Promise<string> {
  if (workerDatabaseUrl) return workerDatabaseUrl;

  const fingerprint = await migrationsFingerprint();
  // Keyed by run token + pool slot: forks of the same worker slot reuse one database
  // across test files (rollback isolation restores the template state between files),
  // so a run keeps at most maxWorkers databases and teardown removes them.
  const workerName = `${WORKER_PREFIX}${fingerprint}_${currentRunToken()}_w${currentPoolId()}`;
  const admin = new pg.Client({ connectionString: connectionStringFor("postgres") });
  await admin.connect();
  try {
    if (!(await databaseExists(admin, workerName))) {
      // Serialize template build and worker-database cloning: concurrent CREATE DATABASE
      // from one template fails while the template is being copied by another backend.
      await acquireTemplateLock(admin);
      try {
        const templateName = await ensureTemplateDatabase(admin, fingerprint);
        if (!(await databaseExists(admin, workerName))) {
          await admin.query(`create database ${workerName} template ${templateName}`);
        }
      } finally {
        await admin
          .query("select pg_advisory_unlock($1)", [TEMPLATE_BUILD_LOCK])
          .catch(() => undefined);
      }
    }
  } finally {
    await admin.end().catch(() => undefined);
  }

  workerDatabaseUrl = connectionStringFor(workerName);
  return workerDatabaseUrl;
}

export async function createInMemoryTestDatabase(): Promise<InMemoryTestDatabase> {
  const connectionString = await ensureWorkerDatabase();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  const queryable = createSerializedTestQueryable(async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
  });

  // Keep all writes inside the outer BEGIN so afterEach rollback isolates tests.
  // transaction() maps to savepoints inside that BEGIN, so nested service
  // transactions keep real commit/rollback semantics without persisting.
  const savepointDb = createSavepointDatabase(queryable);
  // The fixture is the test's wiring: pin the identity mode from the real
  // database exactly like production entrypoints do at boot.
  await resolveParameterIdentityMode(queryable);
  return {
    query: queryable.query,
    transaction: savepointDb.transaction,
    rollback: async () => {
      try {
        await queryable.query("rollback");
      } finally {
        await client.end();
      }
    }
  };
}
