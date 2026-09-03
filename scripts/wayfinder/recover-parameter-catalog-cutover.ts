import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { assertAllowedPhase } from "../../server/modules/catalog-cutover/checkpoints";
import { recoverCutover } from "../../server/modules/catalog-cutover/orchestrator";
import { assertRecordedAction } from "../../server/modules/catalog-cutover/recovery";

export type RecoverCliArgs = {
  readonly databaseUrl: string | null;
  readonly runId: string;
  readonly recordedAction: string;
  readonly runBoundToken: string;
  readonly phase: string | null;
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
};

export const parseRecoverCliArgs = (argv: readonly string[]): RecoverCliArgs => ({
  databaseUrl: readOption(argv, "--database-url") ?? process.env.DATABASE_URL ?? null,
  runId: readOption(argv, "--run-id") ?? "",
  recordedAction: readOption(argv, "--action") ?? "",
  runBoundToken: readOption(argv, "--run-bound-token") ?? "",
  phase: readOption(argv, "--phase") ?? null,
});

export const runRecoverCutoverCli = async (argv: readonly string[]) => {
  const args = parseRecoverCliArgs(argv);
  if (args.phase) {
    const allowed = assertAllowedPhase(args.phase);
    if (!allowed.ok) return allowed;
  }
  const action = assertRecordedAction(args.recordedAction || "missing");
  if (!action.ok) return action;
  if (!args.databaseUrl || !args.runId || !args.runBoundToken) {
    return {
      ok: false as const,
      error: {
        code: "PCAT-ORC-INVALID-TOKEN",
        detail: "recover requires --database-url, --run-id, --action, and --run-bound-token",
      },
    };
  }
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 2 });
  try {
    return await recoverCutover({
      pool,
      runId: args.runId,
      recordedAction: args.recordedAction,
      runBoundToken: args.runBoundToken,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runRecoverCutoverCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
