import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { ApiError } from "../../../shared/http/errors";

// ponytail: only the reviewed 1.0.4 public schema; review this contract on upgrade.
const checkpointPackageVersion = createRequire(import.meta.url)("@langchain/langgraph-checkpoint-postgres/package.json").version;
const checkpointTables = {
  checkpoint_migrations: { columns: ["v:int4:required"], key: ["v"] },
  checkpoints: {
    columns: ["thread_id:text:required", "checkpoint_ns:text:required", "checkpoint_id:text:required", "parent_checkpoint_id:text:nullable", "type:text:nullable", "checkpoint:jsonb:required", "metadata:jsonb:required"],
    key: ["thread_id", "checkpoint_ns", "checkpoint_id"]
  },
  checkpoint_blobs: {
    columns: ["thread_id:text:required", "checkpoint_ns:text:required", "channel:text:required", "version:text:required", "type:text:required", "blob:bytea:nullable"],
    key: ["thread_id", "checkpoint_ns", "channel", "version"]
  },
  checkpoint_writes: {
    columns: ["thread_id:text:required", "checkpoint_ns:text:required", "checkpoint_id:text:required", "task_id:text:required", "idx:int4:required", "channel:text:required", "type:text:nullable", "blob:bytea:required"],
    key: ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx"]
  }
};

async function ensureRuntimeReady(pool: pg.Pool): Promise<void> {
  const incompatible = (detail: string) => new Error(`Xiaoze checkpoint runtime is not ready (${detail}); run official checkpointer setup as the migration owner`);
  if (checkpointPackageVersion !== "1.0.4") throw incompatible("unreviewed PostgresSaver version");
  const client = await pool.connect();
  let releaseError: Error | true | undefined;
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query<{
      name: string; usable: boolean; privileges: boolean; key: string[] | null;
      columns: Array<{ name: string; type: string; required: boolean; default: string | null }>;
    }>(`
      SELECT c.relname AS name,
        c.relkind = 'r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
          AND has_schema_privilege(n.oid, 'USAGE') AS usable,
        has_table_privilege(c.oid, 'SELECT') AND (c.relname = 'checkpoint_migrations'
          OR (has_table_privilege(c.oid, 'INSERT') AND has_table_privilege(c.oid, 'UPDATE')
            AND has_table_privilege(c.oid, 'DELETE'))) AS privileges,
        (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
          FROM pg_constraint p JOIN pg_index i ON i.indexrelid = p.conindid
          CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY k(attnum, ordinality)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
          WHERE p.conrelid = c.oid AND p.contype = 'p' AND NOT p.condeferrable
            AND i.indisvalid AND i.indisready AND i.indimmediate) AS key,
        (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type',
          CASE WHEN t.typnamespace = 'pg_catalog'::regnamespace THEN t.typname ELSE 'unsupported' END,
          'required', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
          FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    `, [Object.keys(checkpointTables)]);
    for (const [name, expected] of Object.entries(checkpointTables)) {
      const table = rows.find((row) => row.name === name);
      if (!table?.usable || !table.privileges || JSON.stringify(table.key) !== JSON.stringify(expected.key)) {
        throw incompatible(`${name} table, privileges or primary key`);
      }
      for (const specification of expected.columns) {
        const [columnName, type, nullability] = specification.split(":");
        const column = table.columns.find((item) => item.name === columnName);
        if (!column || column.type !== type || column.required !== (nullability === "required")) {
          throw incompatible(`${name}.${columnName} shape`);
        }
        if (columnName === "checkpoint_ns" || columnName === "metadata") {
          // Compare only known literal catalog spellings; never execute catalog text.
          let literal = column.default;
          while (literal?.startsWith("(") && literal.endsWith(")")) literal = literal.slice(1, -1);
          if (literal !== (columnName === "metadata" ? "'{}'::jsonb" : "''::text")) {
            throw incompatible(`${name}.${columnName} default`);
          }
        }
      }
      if (table.columns.some((column) => column.required && column.default === null
        && !expected.columns.some((specification) => specification.startsWith(`${column.name}:`)))) {
        throw incompatible(`${name} extra required column`);
      }
    }
    const history = await client.query<{ v: number }>("SELECT v FROM public.checkpoint_migrations ORDER BY v");
    if (JSON.stringify(history.rows.map((row) => row.v)) !== "[0,1,2,3,4]") throw incompatible("migration history");
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : true;
    }
    throw error;
  } finally {
    if (releaseError) client.release(releaseError);
    else client.release();
  }
}

const DEFAULT_INTERRUPT_DURABILITY_TIMEOUT_MS = 2000;
const DEFAULT_INTERRUPT_DURABILITY_POLL_MS = 10;

function threadCheckpointConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

export function isInterruptCheckpointReadable(tuple: CheckpointTuple | undefined): boolean {
  if (!tuple?.checkpoint) {
    return false;
  }
  const values = tuple.checkpoint.channel_values ?? {};
  return Boolean(values.pendingMutatingCall);
}

function getInterruptDurabilityProbeSaver(connectionString: string): PostgresCheckpointerHandle {
  if (!interruptDurabilityProbe) {
    interruptDurabilityProbe = createPostgresCheckpointerSaver({ connectionString, initialization: "runtime" });
  }
  return interruptDurabilityProbe;
}

export async function waitForInterruptCheckpointDurable(options: {
  threadId: string;
  saver: BaseCheckpointSaver;
  connectionString?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const {
    threadId,
    saver,
    connectionString,
    timeoutMs = DEFAULT_INTERRUPT_DURABILITY_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_INTERRUPT_DURABILITY_POLL_MS
  } = options;

  const config = threadCheckpointConfig(threadId);
  const deadline = Date.now() + timeoutMs;
  let durableReader: BaseCheckpointSaver = saver;

  if (connectionString?.trim()) {
    // A second pool (not the writer) so getTuple cannot be satisfied by an
    // in-process cache. Reuse one probe for the process — fromConnString on
    // every HITL would leak pg.Pool instances (PostgresSaver.end() is never
    // called on those one-shots) and re-run setup/migrations on the hot path.
    const probe = getInterruptDurabilityProbeSaver(connectionString.trim());
    await probe.ensureSetup();
    durableReader = probe.saver;
  }

  while (Date.now() < deadline) {
    const tuple = await durableReader.getTuple(config);
    if (isInterruptCheckpointReadable(tuple)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Interrupt checkpoint for thread ${threadId} did not become durable within ${timeoutMs}ms`
  );
}

export type PostgresCheckpointerHandle = {
  saver: PostgresSaver;
  ensureSetup: () => Promise<void>;
  withNamespaceLease: NamespaceLease;
};

export type NamespaceLease = <T>(threadId: string, work: () => Promise<T>) => Promise<T>;
const leaseOwners = new WeakMap<BaseCheckpointSaver, NamespaceLease>();
export function isPostgresNamespaceLeaseOwner(saver: BaseCheckpointSaver, lease: NamespaceLease | undefined): boolean {
  return Boolean(lease && leaseOwners.get(saver) === lease);
}

let sharedPostgresCheckpointer: PostgresCheckpointerHandle | undefined;
let interruptDurabilityProbe: PostgresCheckpointerHandle | undefined;

export function createPostgresCheckpointerSaver(options: {
  connectionString: string;
  initialization?: "bootstrap" | "runtime";
}): PostgresCheckpointerHandle {
  const poolOptions = { connectionString: options.connectionString, connectionTimeoutMillis: 2000 };
  const pool = options.initialization === "runtime" ? new pg.Pool(poolOptions) : undefined;
  const saver = pool ? new PostgresSaver(pool) : PostgresSaver.fromConnString(options.connectionString);
  let hasSetup = false;
  let setupPromise: Promise<void> | undefined;
  let runPool = pool;
  let closing = false;
  let endPromise: Promise<void> | undefined;
  type Run = {
    threadId: string; client: pg.PoolClient; saver: PostgresSaver;
    phase: "active" | "closing" | "dead" | "closed";
    tail: Promise<void>; slots: Set<() => void>; failure?: unknown;
    termination?: Promise<void>;
    released?: boolean;
  };
  const context = new AsyncLocalStorage<Run>();
  const runs = new Set<Run>();
  const originalGetTuple = saver.getTuple.bind(saver);
  const originalList = saver.list?.bind(saver);
  const originalEnd = saver.end.bind(saver);
  const refused = () => new ApiError("CONFLICT", "Xiaoze checkpoint writer lease is not active.", { reason: "xiaoze-writer-lease-inactive" });
  const active = (run: Run) => { if (run.phase !== "active") throw run.failure ?? refused(); };
  const releasePhysical = (run: Run, discard: boolean) => {
    if (run.released) return;
    run.released = true;
    run.client.release(discard ? true : undefined);
  };
  const terminate = (run: Run, error: unknown): Promise<void> => {
    run.failure ??= error;
    run.phase = "dead";
    return run.termination ??= (async () => {
      // pg's pooled client exposes Client.end at runtime, omitted by PoolClient's type.
      try { await (run.client as unknown as Pick<pg.Client, "end">).end(); }
      finally {
        releasePhysical(run, true);
        for (const release of run.slots) release();
      }
    })();
  };
  const reserve = async (run: Run) => {
    active(run);
    const previous = run.tail;
    let resolve!: () => void;
    const slot = new Promise<void>((done) => { resolve = done; });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      run.slots.delete(release);
      resolve();
    };
    run.slots.add(release);
    run.tail = previous.then(() => slot);
    await previous;
    try { active(run); } catch (error) { release(); throw error; }
    return release;
  };
  const writer = (threadId: unknown, checkpointNs: unknown = "") => {
    const run = context.getStore();
    if (!run) throw refused();
    active(run);
    if (threadId !== run.threadId || checkpointNs !== "") throw refused();
    return run.saver;
  };
  saver.getTuple = (...args) => {
    const run = context.getStore();
    return run ? run.saver.getTuple(...args) : originalGetTuple(...args);
  };
  // Capture at call time: an async generator may first be consumed in another context.
  saver.list = (...args) => {
    const run = context.getStore();
    if (run) return run.saver.list(...args);
    if (!originalList) throw refused();
    return originalList(...args);
  };
  saver.put = async (...args) => writer(args[0].configurable?.thread_id, args[0].configurable?.checkpoint_ns).put(...args);
  saver.putWrites = async (...args) => writer(args[0].configurable?.thread_id, args[0].configurable?.checkpoint_ns).putWrites(...args);
  saver.deleteThread = async (threadId) => writer(threadId).deleteThread(threadId);
  saver.end = () => {
    closing = true;
    return endPromise ??= (async () => {
      await Promise.all([...runs].map((run) => terminate(run, refused())));
      await originalEnd();
      if (runPool && runPool !== pool) await runPool.end();
    })();
  };
  const withNamespaceLease: NamespaceLease = async (threadId, work) => {
    if (closing || context.getStore() || !threadId) throw refused();
    // ponytail: one client per active namespace; measure capacity before changing this ceiling.
    runPool ??= new pg.Pool(poolOptions);
    const client = await runPool.connect();
    const run: Run = { threadId, client, saver: undefined as unknown as PostgresSaver, phase: "active", tail: Promise.resolve(), slots: new Set() };
    runs.add(run);
    const lost = (error?: unknown) => { run.failure ??= error ?? refused(); run.phase = "dead"; };
    client.on("error", lost);
    client.on("end", lost);
    let locked = false;
    let lockUncertain = false;
    let callbackFailure: unknown;
    let callbackFailed = false;
    let result: Awaited<ReturnType<typeof work>> | undefined;
    const key = JSON.stringify(["wiseeff:xiaoze-writer:v1", threadId, ""]);
    try {
      if (closing) throw refused();
      active(run);
      lockUncertain = true;
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key]);
      lockUncertain = false;
      locked = lock.rows[0]?.locked === true;
      active(run);
      if (!locked) throw new ApiError("CONFLICT", "Xiaoze thread is busy.", { reason: "xiaoze-thread-busy" });
      const connect = async () => {
        const release = await reserve(run);
        let released = false;
        let firstFailure: unknown;
        return {
          async query(...args: Parameters<pg.PoolClient["query"]>) {
            if (released || run.phase === "dead" || run.phase === "closed") throw run.failure ?? refused();
            try { return await client.query(...args); }
            catch (error) {
              firstFailure ??= error;
              const sql = args[0];
              const code = (error as { code?: string })?.code;
              if (sql === "COMMIT" || sql === "ROLLBACK" || !code || code.startsWith("08") || code === "57P01") lost(firstFailure);
              throw firstFailure;
            }
          },
          release() { released = true; release(); }
        };
      };
      const adapter = {
        connect,
        async query(...args: Parameters<pg.PoolClient["query"]>) {
          const borrower = await connect();
          try { return await borrower.query(...args); } finally { borrower.release(); }
        },
        async end() { throw refused(); }
      };
      // The reviewed official saver uses only query/connect/end, never a general pool API.
      run.saver = new PostgresSaver(adapter as unknown as pg.Pool, saver.serde);
      run.saver.setup = async () => { throw refused(); };
      result = await context.run(run, work);
    } catch (error) { callbackFailed = true; callbackFailure = error; if (lockUncertain) lost(error); }
    finally {
      if (run.phase === "active") run.phase = "closing";
      // A stuck granted SQL interval loses its physical session before any unlock.
      const timer = setTimeout(() => { void terminate(run, refused()).catch(lost); }, 2000);
      try {
        await run.tail;
        if (run.termination) await run.termination;
        if (run.phase !== "dead" && locked) {
          const unlock = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked", [key]);
          if (unlock.rows[0]?.unlocked !== true) throw refused();
        }
      } catch (error) { lost(error); }
      finally {
        clearTimeout(timer);
        if (run.termination) await run.termination.catch(lost);
        client.removeListener("end", lost);
        // Retain the error listener through discard: pg may emit after release.
        const discard = run.phase === "dead";
        if (!discard) client.removeListener("error", lost);
        run.phase = "closed";
        releasePhysical(run, discard);
        runs.delete(run);
      }
    }
    if (callbackFailed) throw callbackFailure;
    if (run.failure !== undefined) throw run.failure;
    return result as Awaited<ReturnType<typeof work>>;
  };
  leaseOwners.set(saver, withNamespaceLease);

  return {
    saver,
    withNamespaceLease,
    async ensureSetup() {
      if (hasSetup) {
        return;
      }
      if (!setupPromise) {
        setupPromise = (pool ? ensureRuntimeReady(pool) : saver.setup()).then(() => {
          hasSetup = true;
        });
      }
      await setupPromise;
    }
  };
}

export function getSharedPostgresCheckpointerSaver(connectionString: string): PostgresCheckpointerHandle {
  if (!sharedPostgresCheckpointer) {
    sharedPostgresCheckpointer = createPostgresCheckpointerSaver({ connectionString, initialization: "runtime" });
  }
  return sharedPostgresCheckpointer;
}

export function resetSharedPostgresCheckpointerSaverForTests(): void {
  sharedPostgresCheckpointer = undefined;
  interruptDurabilityProbe = undefined;
}

export async function closeSharedPostgresCheckpointerSaversForTests(): Promise<void> {
  const handles = [sharedPostgresCheckpointer, interruptDurabilityProbe].filter(
    (handle, index, all): handle is PostgresCheckpointerHandle => Boolean(handle) && all.indexOf(handle) === index
  );
  sharedPostgresCheckpointer = undefined;
  interruptDurabilityProbe = undefined;
  await Promise.all(handles.map((handle) => handle.saver.end()));
}

export async function setupXiaozeCheckpointerTables(options: {
  mode: "memory" | "postgres";
  connectionString?: string;
}): Promise<{ status: "skipped" | "ensured" }> {
  if (options.mode !== "postgres" || !options.connectionString?.trim()) {
    return { status: "skipped" };
  }

  const handle = createPostgresCheckpointerSaver({ connectionString: options.connectionString.trim() });
  try {
    await handle.ensureSetup();
    return { status: "ensured" };
  } finally {
    await handle.saver.end();
  }
}
