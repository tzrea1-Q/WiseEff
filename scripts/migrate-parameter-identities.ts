import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { migrateParameterIdentities } from "../server/modules/parameter-topology/migration";
import { createPostgresDatabase } from "../server/shared/database/client";

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = hasFlag(args, "--apply");
  const maintenanceToken = readOption(args, "--maintenance-token");
  const dbSnapshotId = readOption(args, "--db-snapshot-id");
  const objectSnapshotId = readOption(args, "--object-snapshot-id");
  const writeLockConfirmed = hasFlag(args, "--write-lock-confirmed");

  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for parameter identity migration.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const report = await migrateParameterIdentities(db, {
    mode: apply ? "apply" : "dry-run",
    maintenanceToken,
    dbSnapshotId,
    objectSnapshotId,
    writeLockConfirmed,
    expectedMaintenanceToken:
      process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN?.trim() || undefined
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.blockers.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
