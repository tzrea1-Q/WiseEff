import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

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
    interruptDurabilityProbe = createPostgresCheckpointerSaver({ connectionString });
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
};

let sharedPostgresCheckpointer: PostgresCheckpointerHandle | undefined;
let interruptDurabilityProbe: PostgresCheckpointerHandle | undefined;

export function createPostgresCheckpointerSaver(options: {
  connectionString: string;
  setupMode?: "migrate" | "verify-only";
}): PostgresCheckpointerHandle {
  const saver = PostgresSaver.fromConnString(options.connectionString);
  let hasSetup = false;
  let setupPromise: Promise<void> | undefined;

  return {
    saver,
    async ensureSetup() {
      if (hasSetup) {
        return;
      }
      if (!setupPromise) {
        const mode = options.setupMode ?? (process.env.NODE_ENV === "production" ? "verify-only" : "migrate");
        setupPromise = (mode === "verify-only" ? verifyPostgresCheckpointerTables(options.connectionString) : saver.setup()).then(() => {
          hasSetup = true;
        });
      }
      await setupPromise;
    }
  };
}

/** Read-only compatibility check for the locked checkpoint-postgres schema. */
export async function verifyPostgresCheckpointerTables(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("begin read only");
    await verifyPostgresCheckpointerTablesOnClient(client);
  } catch {
    throw new Error("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Shared physical verifier for an already identity-checked management session.
 * The caller owns the connection and transaction lifetime. */
export async function verifyPostgresCheckpointerTablesOnClient(client: Pick<pg.PoolClient, "query">): Promise<void> {
  try {
    const ledger = await client.query<{ v: number }>("select v from public.checkpoint_migrations order by v");
    // checkpoint-postgres 1.0.4 has exactly five schema migrations (0..4).
    if (JSON.stringify(ledger.rows.map((row) => row.v)) !== "[0,1,2,3,4]") {
      throw new Error("checkpoint schema mismatch");
    }
    const expectedColumns: Record<string, readonly string[]> = {
      checkpoint_migrations: ["v:integer:true"],
      checkpoints: ["thread_id:text:true", "checkpoint_ns:text:true", "checkpoint_id:text:true", "parent_checkpoint_id:text:false", "type:text:false", "checkpoint:jsonb:true", "metadata:jsonb:true"],
      checkpoint_blobs: ["thread_id:text:true", "checkpoint_ns:text:true", "channel:text:true", "version:text:true", "type:text:true", "blob:bytea:false"],
      checkpoint_writes: ["thread_id:text:true", "checkpoint_ns:text:true", "checkpoint_id:text:true", "task_id:text:true", "idx:integer:true", "channel:text:true", "type:text:false", "blob:bytea:true"],
    };
    const expectedKeys: Record<string, readonly string[]> = {
      checkpoint_migrations: ["v"], checkpoints: ["thread_id", "checkpoint_ns", "checkpoint_id"],
      checkpoint_blobs: ["thread_id", "checkpoint_ns", "channel", "version"],
      checkpoint_writes: ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx"],
    };
    const columns = await client.query<{ relation: string; column_signature: string }>(`
      select c.relname as relation, a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text as column_signature
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.oid
      where n.nspname='public' and c.relkind='r' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
      order by c.relname,a.attnum`, [Object.keys(expectedColumns)]);
    const keys = await client.query<{ relation: string; columns: string[] }>(`
      select c.relname as relation, array_agg(a.attname::text order by k.ordinality) as columns
      from pg_catalog.pg_constraint p join pg_catalog.pg_class c on c.oid=p.conrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      cross join lateral unnest(p.conkey) with ordinality k(attnum,ordinality)
      join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
      where n.nspname='public' and p.contype='p' and c.relname=any($1::text[]) group by c.relname`, [Object.keys(expectedKeys)]);
    for (const [relation, expected] of Object.entries(expectedColumns)) {
      if (JSON.stringify(columns.rows.filter((row) => row.relation === relation).map((row) => row.column_signature)) !== JSON.stringify(expected) ||
          JSON.stringify(keys.rows.find((row) => row.relation === relation)?.columns) !== JSON.stringify(expectedKeys[relation])) {
        throw new Error("checkpoint physical schema mismatch");
      }
    }
    await client.query("select thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata from public.checkpoints limit 0");
    await client.query("select thread_id, checkpoint_ns, channel, version, type, blob from public.checkpoint_blobs limit 0");
    await client.query("select thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob from public.checkpoint_writes limit 0");
  } catch {
    throw new Error("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
  }
}

export function getSharedPostgresCheckpointerSaver(connectionString: string): PostgresCheckpointerHandle {
  if (!sharedPostgresCheckpointer) {
    sharedPostgresCheckpointer = createPostgresCheckpointerSaver({ connectionString });
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
  /** Controlled management only. Caller retains the checked pool lifetime. */
  pool?: pg.Pool;
  /** Management entry validates the real setup connection and its live fences
   * before each library SQL statement. Never supplied by runtime startup. */
  beforeWrite?: (client: pg.PoolClient) => Promise<void>;
}): Promise<{ status: "skipped" | "ensured" }> {
  if (options.mode !== "postgres" || (!options.pool && !options.connectionString?.trim())) {
    return { status: "skipped" };
  }

  if (options.pool) {
    // The locked library's setup() uses await pool.connect(), query(), release().
    // Keep its real connections and schema writer; wrap only to enforce the
    // management boundary before each statement, including later migrations.
    const checkedPool = options.beforeWrite ? new Proxy(options.pool, {
      get(pool, key) {
        if (key !== "connect") return Reflect.get(pool, key);
        return async () => {
          const client = await pool.connect();
          return new Proxy(client, {
            get(connection, property) {
              if (property === "query") return async (sql: string, values?: unknown[]) => {
                await options.beforeWrite!(connection);
                return connection.query(sql, values);
              };
              const value = Reflect.get(connection, property);
              return typeof value === "function" ? value.bind(connection) : value;
            },
          });
        };
      },
    }) : options.pool;
    await new PostgresSaver(checkedPool).setup();
    return { status: "ensured" };
  }

  // Explicit management runner owns setup; never reuse a runtime verify-only handle.
  const handle = createPostgresCheckpointerSaver({ connectionString: options.connectionString!.trim(), setupMode: "migrate" });
  try { await handle.ensureSetup(); }
  finally { await handle.saver.end(); }
  return { status: "ensured" };
}
