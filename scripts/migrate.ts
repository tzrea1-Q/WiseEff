import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { createDatabase, createPostgresDatabase, getRootPostgresPool, type Database } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";
import { setupXiaozeCheckpointerTables, verifyPostgresCheckpointerTablesOnClient } from "../server/modules/agent/xiaoze/durableCheckpointer";
import { inspectFrozenSourceSnapshotProgress, SourceSnapshotError, verifyFrozenSourceSnapshot, type FrozenSourceSnapshot } from "../server/modules/catalog-cutover/sourceSnapshot";
import { readBindingDatabaseIdentity } from "../server/modules/parameter-bindings/cutoverImport/sourceBoundary";
import { canonicalJson, sha256Prefixed } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
type MigrationFailureCode = "database-url-required" | "checkpoint-mode-invalid"
  | "database-open-failed" | "migration-failed" | "checkpoint-setup-failed" | "database-close-failed" | "migration-arguments-invalid";

export class ManagementMigrationError extends Error {
  cleanupFailed = false;
  constructor(readonly code: MigrationFailureCode) {
    super(code);
    this.name = "ManagementMigrationError";
  }
}

/** Management configuration only. Runtime auth, S3, device and provider settings
 * are not migration prerequisites. Keep the shared env schema's memory default;
 * production checkpoint preparation requires an explicit postgres selection. */
export function parseMigrationEnvironment(raw: NodeJS.ProcessEnv): {
  connectionString: string;
  mode: "memory" | "postgres";
} {
  const connectionString = raw.DATABASE_URL?.trim();
  if (!connectionString) throw new ManagementMigrationError("database-url-required");
  const mode = raw.XIAOZE_CHECKPOINTER ?? "memory";
  if (mode !== "memory" && mode !== "postgres") throw new ManagementMigrationError("checkpoint-mode-invalid");
  return { connectionString, mode };
}

type ManagementDatabase = Database & { close(): Promise<void> };
type MigrationPorts = {
  open(connectionString: string): ManagementDatabase;
  apply: typeof applyMigrations;
  prepareCheckpoints: typeof setupXiaozeCheckpointerTables;
};
const migrationPorts: MigrationPorts = {
  open: createPostgresDatabase,
  apply: applyMigrations,
  prepareCheckpoints: setupXiaozeCheckpointerTables,
};

export async function runManagementMigrations(raw: NodeJS.ProcessEnv, ports: MigrationPorts = migrationPorts) {
  const configuration = parseMigrationEnvironment(raw);
  let db: ManagementDatabase | undefined;
  let phase: MigrationFailureCode = "database-open-failed";
  let failure: ManagementMigrationError | undefined;
  try {
    db = ports.open(configuration.connectionString);
    phase = "migration-failed";
    const applied = await ports.apply(db, path.join(root, "server", "migrations"));
    phase = "checkpoint-setup-failed";
    const checkpoint = await ports.prepareCheckpoints(configuration);
    return { applied, checkpoint };
  } catch {
    // Driver/setup exceptions can contain credentials, connection URLs or SQL.
    // A phase failure does not imply that earlier migration files rolled back.
    failure = new ManagementMigrationError(phase);
    throw failure;
  } finally {
    try { await db?.close(); }
    catch {
      if (failure) failure.cleanupFailed = true;
      else throw new ManagementMigrationError("database-close-failed");
    }
  }
}

export type ManagementMigrationIntent = {
  readonly version: "pcat-management-migration-intent-v1";
  readonly runId: string;
  /** Fixed outer preparation/handoff plan; the S7 plan does not exist yet. */
  readonly preparationPlanDigest: string;
  readonly target: FrozenSourceSnapshot["target"];
  readonly sourceSnapshotDigest: string;
  readonly candidateInventoryDigest: string;
  readonly writeFenceReceiptDigest: string;
  readonly recoveryManifestDigest: string;
  readonly checkpointMode: "memory" | "postgres";
};
export class ControlledManagementMigrationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ControlledManagementMigrationError"; }
}
export type ManagementMigrationReceipt = {
  readonly version: "pcat-management-migration-receipt-v1";
  readonly intentDigest: string;
  readonly sourceSnapshotDigest: string;
  readonly candidateInventoryDigest: string;
  readonly verifiedRelations: number;
  readonly verifiedRows: number;
  readonly appliedSuffix: number;
  readonly checkpoint: { readonly mode: "memory" | "postgres"; readonly status: "skipped" | "verified" };
};
export type ManagementMigrationAttempt = { readonly attemptId: string };
/** The root supplies the adapter over the existing target-scoped upgrade journal.
 * It must reject pending/unknown attempts across runs, including after restart. */
export type ManagementMigrationJournal = {
  begin(intent: ManagementMigrationIntent): Promise<ManagementMigrationAttempt>;
  finish(attempt: ManagementMigrationAttempt, receipt: ManagementMigrationReceipt): Promise<void>;
  unknown(attempt: ManagementMigrationAttempt): Promise<void>;
};
export const managementMigrationIntentDigest = (intent: ManagementMigrationIntent): string => sha256Prefixed(canonicalJson(intent));
type ControlledMigrationInput = {
  readonly intent: ManagementMigrationIntent;
  readonly descriptor: FrozenSourceSnapshot;
  readonly expectedDescriptorDigest: string;
  readonly candidateMigrationsDirectory: string;
  readonly operationLock: { assertHeld(): Promise<void> };
  readonly boundary: { verify(intent: ManagementMigrationIntent): Promise<void> };
  readonly journal: ManagementMigrationJournal;
};
export type ControlledManagementVerificationInput = Omit<ControlledMigrationInput, "journal">;
function requireControlledPins(input: Pick<ControlledMigrationInput, "intent" | "descriptor" | "expectedDescriptorDigest">): void {
  const { intent, descriptor } = input;
  if (!intent || intent.version !== "pcat-management-migration-intent-v1" || !/^[A-Za-z0-9_-]+$/.test(intent.runId) ||
      !["memory", "postgres"].includes(intent.checkpointMode) ||
      [intent.preparationPlanDigest, intent.sourceSnapshotDigest, intent.candidateInventoryDigest, intent.writeFenceReceiptDigest, intent.recoveryManifestDigest].some(pin => !/^sha256:[a-f0-9]{64}$/.test(pin)) ||
      !descriptor || intent.sourceSnapshotDigest !== input.expectedDescriptorDigest || descriptor.digest !== input.expectedDescriptorDigest ||
      intent.candidateInventoryDigest !== descriptor.candidateInventoryDigest || canonicalJson(intent.target) !== canonicalJson(descriptor.target)) {
    throw new ControlledManagementMigrationError("management-migration-pins-invalid");
  }
}

/** P4 can recompute this result read-only and compare it with the existing
 * journal receipt. A matching result alone is not an approval or pending-attempt
 * reconciliation; those remain controller responsibilities. */
export async function verifyManagementMigrationReceipt(input: Pick<ControlledMigrationInput, "intent" | "descriptor" | "expectedDescriptorDigest" | "candidateMigrationsDirectory"> & { pool: pg.Pool }): Promise<ManagementMigrationReceipt> {
  input = { ...input, intent: structuredClone(input.intent), descriptor: structuredClone(input.descriptor) };
  requireControlledPins(input);
  const verified = await verifyFrozenSourceSnapshot(input);
  if (input.intent.checkpointMode === "postgres") {
    const client = await input.pool.connect();
    try {
      if (canonicalJson(await readBindingDatabaseIdentity(client)) !== canonicalJson(input.intent.target)) throw new ControlledManagementMigrationError("management-migration-target-mismatch");
      await verifyPostgresCheckpointerTablesOnClient(client);
    } finally { client.release(); }
  }
  return { version: "pcat-management-migration-receipt-v1", intentDigest: managementMigrationIntentDigest(input.intent), ...verified,
    checkpoint: { mode: input.intent.checkpointMode, status: input.intent.checkpointMode === "postgres" ? "verified" : "skipped" } };
}

/** Read-only P4 recomputation under the caller's real fixed-target boundary.
 * It neither starts an attempt nor repairs tables. The controller must compare
 * the returned receipt with its committed journal entry before consuming it. */
export async function verifyControlledManagementMigrations(raw: NodeJS.ProcessEnv, supplied: ControlledManagementVerificationInput): Promise<ManagementMigrationReceipt> {
  if (!supplied?.operationLock?.assertHeld || !supplied.boundary?.verify) throw new ControlledManagementMigrationError("management-migration-context-required");
  const input = { ...supplied, intent: structuredClone(supplied.intent), descriptor: structuredClone(supplied.descriptor) };
  requireControlledPins(input);
  const configuration = parseMigrationEnvironment(raw);
  if (configuration.mode !== input.intent.checkpointMode) throw new ControlledManagementMigrationError("management-migration-checkpoint-mode-mismatch");
  const assertBoundary = async () => { await input.operationLock.assertHeld(); await input.boundary.verify(structuredClone(input.intent)); };
  await assertBoundary();
  const db = createPostgresDatabase(configuration.connectionString);
  try {
    const receipt = await verifyManagementMigrationReceipt({ ...input, pool: getRootPostgresPool(db)! });
    await assertBoundary();
    return receipt;
  } catch (error) {
    if (error instanceof ControlledManagementMigrationError || error instanceof SourceSnapshotError) throw error;
    throw new ControlledManagementMigrationError("management-migration-verification-unavailable");
  } finally {
    try { await db.close(); } catch { throw new ControlledManagementMigrationError("management-migration-close-unknown"); }
  }
}

/** Actual fixed-entry management call. Private credentials are consumed here,
 * never returned in the plan, journal receipt or diagnostics. */
export async function runControlledManagementMigrations(raw: NodeJS.ProcessEnv, supplied: ControlledMigrationInput): Promise<ManagementMigrationReceipt> {
  if (!supplied?.operationLock?.assertHeld || !supplied.boundary?.verify || !supplied.journal?.begin || !supplied.journal.finish || !supplied.journal.unknown) throw new ControlledManagementMigrationError("management-migration-context-required");
  const input = { ...supplied, intent: structuredClone(supplied.intent), descriptor: structuredClone(supplied.descriptor) };
  requireControlledPins(input);
  const configuration = parseMigrationEnvironment(raw);
  if (configuration.mode !== input.intent.checkpointMode) throw new ControlledManagementMigrationError("management-migration-checkpoint-mode-mismatch");
  await input.operationLock.assertHeld();
  await input.boundary.verify(structuredClone(input.intent));
  const db = createPostgresDatabase(configuration.connectionString);
  const pool = getRootPostgresPool(db)!;
  let lock: pg.PoolClient | undefined;
  let held = false;
  let attempt: ManagementMigrationAttempt | undefined;
  let failed = false;
  try {
    lock = await pool.connect();
    if (canonicalJson(await readBindingDatabaseIdentity(lock)) !== canonicalJson(input.intent.target)) throw new ControlledManagementMigrationError("management-migration-target-mismatch");
    const acquired = await lock.query<{ held: boolean }>("select pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held");
    if (acquired.rows[0]?.held !== true) throw new ControlledManagementMigrationError("management-migration-target-locked");
    held = true;
    const assertEffectAllowed = async () => {
      await input.operationLock.assertHeld();
      await input.boundary.verify(structuredClone(input.intent));
      const checked = await lock!.query<{ held: boolean }>(`select exists(select 1 from pg_catalog.pg_locks where pid=pg_backend_pid()
        and locktype='advisory' and granted and mode='ExclusiveLock' and objsubid=2
        and classid=hashtext('s7-orc-cutover-target')::oid and objid=hashtext(current_database())::oid) as held`);
      if (checked.rows[0]?.held !== true) throw new ControlledManagementMigrationError("management-migration-lock-lost");
      // The host-holder probe is last: a slow boundary/database check must not
      // leave an earlier probe authorizing a later statement after holder exit.
      await input.operationLock.assertHeld();
    };
    await assertEffectAllowed();
    const progress = await inspectFrozenSourceSnapshotProgress({ ...input, pool });
    if (progress.appliedSuffix !== 0) throw new ControlledManagementMigrationError("migration-already-started");
    attempt = await input.journal.begin(structuredClone(input.intent));
    if (!attempt?.attemptId) throw new ControlledManagementMigrationError("management-migration-attempt-invalid");
    // Every schema transaction uses the already identity-checked lock session.
    // Pool routing cannot silently send one migration to another database.
    const sessionDatabase = createDatabase({ query: async <Row>(sql: string, values?: unknown[]) => {
      const result = await lock!.query(sql, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    } });
    await runManagementMigrations({ DATABASE_URL: configuration.connectionString, XIAOZE_CHECKPOINTER: configuration.mode }, {
      // The outer scope keeps this real, identity-checked pool and lock alive
      // through receipt verification. The ordinary runner still owns sequencing.
      open: () => ({ ...sessionDatabase, close: async () => undefined }),
      apply: async database => applyMigrations(database, input.candidateMigrationsDirectory, {
        expectedInventory: [...input.descriptor.sourceMigrations, ...input.descriptor.migrationSuffix], beforeWrite: assertEffectAllowed,
      }),
      prepareCheckpoints: async () => {
        await assertEffectAllowed();
        return setupXiaozeCheckpointerTables({ mode: configuration.mode, pool, beforeWrite: async client => {
          if (canonicalJson(await readBindingDatabaseIdentity(client)) !== canonicalJson(input.intent.target)) throw new ControlledManagementMigrationError("management-migration-target-mismatch");
          await assertEffectAllowed();
        } });
      },
    });
    await assertEffectAllowed();
    const receipt = await verifyManagementMigrationReceipt({ ...input, pool });
    await assertEffectAllowed();
    await input.journal.finish(attempt, receipt);
    return receipt;
  } catch (error) {
    failed = true;
    // Per-file commits and filesystem acknowledgement failures can be uncertain.
    // Never turn an execution error into a known rollback or a fresh attempt.
    if (attempt) { try { await input.journal.unknown(attempt); } catch { /* Existing pending intent remains authoritative. */ } }
    if (error instanceof ControlledManagementMigrationError || error instanceof ManagementMigrationError || error instanceof SourceSnapshotError) throw error;
    throw new ControlledManagementMigrationError("management-migration-controlled-failed");
  } finally {
    let cleanupFailed = false;
    if (lock) {
      try {
        // On an uncertain transaction/rollback the session is destroyed; never
        // recycle it on the assumption that rollback succeeded.
        if (failed) { lock.release(true); lock = undefined; }
        if (lock && held) {
          const released = await lock.query<{ released: boolean }>("select pg_advisory_unlock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as released");
          if (released.rows[0]?.released !== true) throw new Error("lock release unverified");
        }
        lock?.release();
      } catch { cleanupFailed = true; lock?.release(true); }
    }
    try { await db.close(); } catch { cleanupFailed = true; }
    if (cleanupFailed && !failed) throw new ControlledManagementMigrationError("management-migration-close-unknown");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Controlled migration capabilities come only from the fixed composition
    // root. Arbitrary CLI flags cannot manufacture a lock, boundary or journal.
    if (process.argv.length !== 2) throw new ManagementMigrationError("migration-arguments-invalid");
    const { applied, checkpoint } = await runManagementMigrations(process.env);
    console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "none"}`);
    console.log(checkpoint.status === "ensured"
      ? "Ensured Xiaoze LangGraph checkpoint tables."
      : "Skipped Xiaoze LangGraph checkpoint setup (XIAOZE_CHECKPOINTER is not postgres).");
  } catch (error) {
    const failure = error instanceof ManagementMigrationError ? error : new ManagementMigrationError("migration-failed");
    console.error(`Management migration failed: ${failure.code}${failure.cleanupFailed ? " (database-close-failed)" : ""}`);
    process.exitCode = ["database-url-required", "checkpoint-mode-invalid", "migration-arguments-invalid"].includes(failure.code) ? 2 : 1;
  }
}
