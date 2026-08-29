import "dotenv/config";

import { loadServerEnv } from "../server/config/env";
import {
  reconcileDriverParameterDefinitions,
  type DefinitionReconciliationMode,
} from "../server/modules/parameter-specs/definitionReconciliation";
import { verifyEffectiveDriverParameterDefinitions } from "../server/modules/parameter-specs/definitionVerification";
import { createPostgresDatabase } from "../server/shared/database/client";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveMode(args: string[]): DefinitionReconciliationMode {
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dryRun && apply) throw new Error("Use exactly one of --dry-run or --apply.");
  return apply ? "apply" : "dry-run";
}

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const catalogOnly = args.includes("--catalog-only");
if (verify && (args.includes("--dry-run") || args.includes("--apply"))) {
  throw new Error("--verify cannot be combined with --dry-run or --apply.");
}
if (catalogOnly && !verify) {
  throw new Error("--catalog-only requires --verify.");
}
const env = loadServerEnv(process.env);
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for definition reconciliation.");

const db = createPostgresDatabase(env.DATABASE_URL);
try {
  const organizationId = readOption(args, "--organization-id")?.trim() || undefined;
  if (verify) {
    const report = await verifyEffectiveDriverParameterDefinitions(db, {
      organizationId,
      catalogOnly,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "blocked") process.exitCode = 2;
  } else {
    const report = await reconcileDriverParameterDefinitions(db, {
      mode: resolveMode(args),
      organizationId,
      runId: readOption(args, "--run-id")?.trim() || undefined,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.blocked > 0) process.exitCode = 2;
  }
} finally {
  await db.close();
}
