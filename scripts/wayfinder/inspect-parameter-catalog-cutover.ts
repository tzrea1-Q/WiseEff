import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { assertAllowedPhase } from "../../server/modules/catalog-cutover/checkpoints";
import { inspectCutover } from "../../server/modules/catalog-cutover/orchestrator";

export type InspectCliArgs = {
  readonly databaseUrl: string | null;
  readonly runId: string | null;
  readonly planDigest: string | null;
  readonly phase: string | null;
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
};

export const parseInspectCliArgs = (argv: readonly string[]): InspectCliArgs => ({
  databaseUrl: readOption(argv, "--database-url") ?? process.env.DATABASE_URL ?? null,
  runId: readOption(argv, "--run-id") ?? null,
  planDigest: readOption(argv, "--plan-digest") ?? null,
  phase: readOption(argv, "--phase") ?? null,
});

export const runInspectCutoverCli = async (argv: readonly string[]) => {
  const args = parseInspectCliArgs(argv);
  if (args.phase) {
    const allowed = assertAllowedPhase(args.phase);
    if (!allowed.ok) return allowed;
  }
  if (!args.databaseUrl || (!args.runId && !args.planDigest)) {
    return {
      ok: false as const,
      error: {
        code: "PCAT-ORC-NOT-FOUND",
        detail: "inspect requires --database-url and --run-id or --plan-digest",
      },
    };
  }
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 2 });
  try {
    return await inspectCutover({
      pool,
      runId: args.runId ?? undefined,
      planDigest: args.planDigest ?? undefined,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runInspectCutoverCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
