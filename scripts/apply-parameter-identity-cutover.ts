import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { applyParameterIdentityCutover } from "../server/modules/parameter-topology/migration";
import { createPostgresDatabase } from "../server/shared/database/client";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const migrationRunId = readOption(args, "--migration-run-id");
  if (!migrationRunId?.trim()) {
    throw new Error("Usage: tsx scripts/apply-parameter-identity-cutover.ts --migration-run-id <id>");
  }

  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for parameter identity cutover apply.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  await applyParameterIdentityCutover(db, { migrationRunId: migrationRunId.trim() });
  console.log(JSON.stringify({ ok: true, migrationRunId: migrationRunId.trim() }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
