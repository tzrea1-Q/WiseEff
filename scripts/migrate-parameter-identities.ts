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

function resolveMode(args: string[]): "dry-run" | "stage-review" | "finalize" | "apply" {
  const stageReview = hasFlag(args, "--stage-review");
  const finalize = hasFlag(args, "--finalize");
  const apply = hasFlag(args, "--apply");
  const selected = [
    stageReview ? "stage-review" : null,
    finalize ? "finalize" : null,
    apply ? "apply" : null
  ].filter(Boolean);

  if (selected.length > 1) {
    throw new Error(
      "Mutually exclusive modes: use exactly one of --dry-run (default), --stage-review, --finalize, or --apply"
    );
  }
  if (finalize) return "finalize";
  if (stageReview) return "stage-review";
  if (apply) return "apply";
  return "dry-run";
}

async function main() {
  const args = process.argv.slice(2);
  const mode = resolveMode(args);
  const maintenanceToken = readOption(args, "--maintenance-token");
  const migrationRunId = readOption(args, "--migration-run-id");
  const dbSnapshotId = readOption(args, "--db-snapshot-id");
  const objectSnapshotId = readOption(args, "--object-snapshot-id");
  const writeLockConfirmed = hasFlag(args, "--write-lock-confirmed");

  if (mode === "finalize" && !migrationRunId?.trim()) {
    throw new Error("finalize requires --migration-run-id from a prior stage-review run");
  }

  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for parameter identity migration.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const report = await migrateParameterIdentities(db, {
    mode,
    migrationRunId: migrationRunId?.trim(),
    maintenanceToken,
    dbSnapshotId,
    objectSnapshotId,
    writeLockConfirmed,
    expectedMaintenanceToken:
      process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN?.trim() || undefined
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.blockers.length > 0 && mode !== "stage-review") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
