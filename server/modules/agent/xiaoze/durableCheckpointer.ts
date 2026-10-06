import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createRequire } from "node:module";
import pg from "pg";

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
};

let sharedPostgresCheckpointer: PostgresCheckpointerHandle | undefined;
let interruptDurabilityProbe: PostgresCheckpointerHandle | undefined;

export function createPostgresCheckpointerSaver(options: {
  connectionString: string;
  initialization?: "bootstrap" | "runtime";
}): PostgresCheckpointerHandle {
  const pool = options.initialization === "runtime" ? new pg.Pool({ connectionString: options.connectionString }) : undefined;
  const saver = pool ? new PostgresSaver(pool) : PostgresSaver.fromConnString(options.connectionString);
  let hasSetup = false;
  let setupPromise: Promise<void> | undefined;

  return {
    saver,
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
