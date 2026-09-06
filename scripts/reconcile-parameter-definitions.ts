import "dotenv/config";

import { loadServerEnv } from "../server/config/env";
import {
  reconcileDriverParameterDefinitions,
  type DefinitionReconciliationMode,
} from "../server/modules/parameter-specs/definitionReconciliation";
import { verifyEffectiveDriverParameterDefinitions } from "../server/modules/parameter-specs/definitionVerification";
import { createPostgresDatabase } from "../server/shared/database/client";
import {
  catalogLegacyGoneResult,
  LEGACY_WRITE_GONE_MESSAGE,
} from "../server/modules/parameter-catalog-api/legacy";
import {
  readTypedCutoverInspection,
  readTypedLegacyOperatorOutcome,
  readTypedVerificationReport,
} from "../server/modules/operations/parameterCatalogComparisonContribution";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
export async function runReconcileParameterDefinitions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ readonly exitCode: number; readonly body: unknown }> {
  const command = parseReconcileCliCommand(argv);
  if (command.kind === "release-gate-unavailable") {
    return {
      exitCode: 2,
      body: {
        kind: "blocked",
        code: "PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE",
        reason: "approved-current-target-context-unavailable",
        message: "Report lookup cannot authorize an upgrade. The controlled runtime/public-release integration is unavailable; keep the candidate isolated.",
      },
    };
  }
  if (command.kind === "apply-gone") {
    return {
      exitCode: 2,
      body: catalogLegacyGoneResult("ops-reconcile-apply", LEGACY_WRITE_GONE_MESSAGE),
    };
  }
  const loaded = loadServerEnv(env);
  if (!loaded.DATABASE_URL) throw new Error("DATABASE_URL is required for definition reconciliation.");
  const db = createPostgresDatabase(loaded.DATABASE_URL);
  try {
    if (command.kind === "verify") {
    const report = await verifyEffectiveDriverParameterDefinitions && await readTypedVerificationReport({
      database: db,
      reportIdOrDigest: command.reportIdOrDigest,
    });
      const observation = report as Awaited<ReturnType<typeof readTypedVerificationReport>>;
      return {
        exitCode: observation.status === "query-failure" ? 1 : 0,
        body: observation.status === "query-failure"
          ? { status: observation.status, code: observation.code, detail: "verification-report-query-failed" }
          : observation,
      };
    }
    if (command.kind === "legacy") {
      const observation = await readTypedLegacyOperatorOutcome({
        database: db,
        legacyType: command.legacyType,
        legacyId: command.legacyId,
        organizationId: command.organizationId,
      });
      return {
        exitCode: observation.status === "query-failure" ? 1 : 0,
        body: observation,
      };
    }
    const observation = await readTypedCutoverInspection({
      databaseUrl: loaded.DATABASE_URL,
      runId: command.runId,
      planDigest: command.planDigest,
      phase: command.phase,
    });
    return {
      exitCode: observation.status === "query-failure" ? 1 : 0,
      body: observation,
    };
  } finally {
    await db.close();
  }
}

export type ReconcileCliCommand =
  | { readonly kind: "release-gate-unavailable" }
  | { readonly kind: "inspect"; readonly runId?: string; readonly planDigest?: string; readonly phase?: string }
  | { readonly kind: "verify"; readonly reportIdOrDigest: string }
  | {
      readonly kind: "legacy";
      readonly legacyType: string;
      readonly legacyId: string;
      readonly organizationId?: string;
    }
  | { readonly kind: "apply-gone" };

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseReconcileCliCommand(args: readonly string[]): ReconcileCliCommand {
  const flags = new Set(["--verify", "--catalog-only", "--diagnostic", "--dry-run", "--apply"]);
  const options = new Set(["--report-id", "--run-id", "--plan-digest", "--phase", "--legacy-type", "--legacy-id", "--organization-id"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((!flags.has(arg) && !options.has(arg)) || seen.has(arg)) {
      throw new Error("PCAT-UPG-INVALID-ARGUMENT: unknown or duplicate option.");
    }
    seen.add(arg);
    if (options.has(arg)) {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--")) {
        throw new Error("PCAT-UPG-INVALID-ARGUMENT: option requires a value.");
      }
    }
  }
  const verify = args.includes("--verify");
  const catalogOnly = args.includes("--catalog-only");
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (verify && (dryRun || apply)) {
    throw new Error("--verify cannot be combined with --dry-run or --apply.");
  }
  if (catalogOnly && !verify) {
    throw new Error("--catalog-only requires --verify.");
  }
  if (args.includes("--diagnostic") && (!verify || catalogOnly)) {
    throw new Error("PCAT-UPG-INVALID-ARGUMENT: --diagnostic requires --verify and cannot authorize --catalog-only.");
  }
  // Old controllers use --verify --catalog-only without a trustworthy target
  // context. Never infer one from a report or from caller-supplied assertions.
  if (verify && !args.includes("--diagnostic")) {
    return { kind: "release-gate-unavailable" };
  }
  if (apply) {
    return { kind: "apply-gone" };
  }
  const legacyType = readOption(args, "--legacy-type")?.trim();
  const legacyId = readOption(args, "--legacy-id")?.trim();
  if (legacyType || legacyId) {
    if (!legacyType || !legacyId) {
      throw new Error("Legacy operator lookup requires both --legacy-type and --legacy-id.");
    }
    return {
      kind: "legacy",
      legacyType,
      legacyId,
      organizationId: readOption(args, "--organization-id")?.trim() || undefined,
    };
  }
  if (verify) {
    const reportIdOrDigest =
      readOption(args, "--report-id")?.trim() || readOption(args, "--run-id")?.trim();
    if (!reportIdOrDigest || (args.includes("--report-id") && args.includes("--run-id"))) {
      throw new Error("PCAT-UPG-INVALID-ARGUMENT: diagnostic lookup requires one report identifier.");
    }
    return { kind: "verify", reportIdOrDigest };
  }
  return {
    kind: "inspect",
    runId: readOption(args, "--run-id")?.trim() || undefined,
    planDigest: readOption(args, "--plan-digest")?.trim() || undefined,
    phase: readOption(args, "--phase")?.trim() || undefined,
  };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runReconcileParameterDefinitions(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
      process.exitCode = result.exitCode;
    })
    .catch(() => {
      process.stderr.write(`${JSON.stringify({ kind: "blocked", code: "PCAT-UPG-CLI-FAILED", reason: "invalid-input-or-query-failure" })}\n`);
      process.exitCode = 1;
    });
}
