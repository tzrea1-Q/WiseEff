import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";
import { setupXiaozeCheckpointerTables } from "../server/modules/agent/xiaoze/durableCheckpointer";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
type MigrationFailureCode = "database-url-required" | "checkpoint-mode-invalid"
  | "database-open-failed" | "migration-failed" | "checkpoint-setup-failed" | "database-close-failed";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { applied, checkpoint } = await runManagementMigrations(process.env);
    console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "none"}`);
    console.log(checkpoint.status === "ensured"
      ? "Ensured Xiaoze LangGraph checkpoint tables."
      : "Skipped Xiaoze LangGraph checkpoint setup (XIAOZE_CHECKPOINTER is not postgres).");
  } catch (error) {
    const failure = error instanceof ManagementMigrationError ? error : new ManagementMigrationError("migration-failed");
    console.error(`Management migration failed: ${failure.code}${failure.cleanupFailed ? " (database-close-failed)" : ""}`);
    process.exitCode = failure.code === "database-url-required" || failure.code === "checkpoint-mode-invalid" ? 2 : 1;
  }
}
