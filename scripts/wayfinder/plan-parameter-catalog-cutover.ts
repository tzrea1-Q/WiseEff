import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import type { FrozenP0Graph } from "../../server/modules/catalog-cutover/classifier";
import {
  UNAVAILABLE_PHASES,
  type PlanCutoverInput,
} from "../../server/modules/catalog-cutover/interface";
import { planCutover } from "../../server/modules/catalog-cutover/orchestrator";
import { assertAllowedPhase } from "../../server/modules/catalog-cutover/checkpoints";

export type PlanCliArgs = {
  readonly databaseUrl: string | null;
  readonly graphPath: string;
  readonly releaseJsonPath: string | null;
  readonly targetArtifactSha: string;
  readonly targetCatalogReleaseDigest: string | null;
  readonly phase: string | null;
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
};

export const parsePlanCliArgs = (argv: readonly string[]): PlanCliArgs => ({
  databaseUrl: readOption(argv, "--database-url") ?? process.env.DATABASE_URL ?? null,
  graphPath: readOption(argv, "--graph") ?? "",
  releaseJsonPath: readOption(argv, "--release-json") ?? null,
  targetArtifactSha: readOption(argv, "--target-artifact-sha") ?? "",
  targetCatalogReleaseDigest: readOption(argv, "--target-catalog-release-digest") ?? null,
  phase: readOption(argv, "--phase") ?? null,
});

export const runPlanCutoverCli = async (argv: readonly string[]) => {
  const args = parsePlanCliArgs(argv);
  if (args.phase) {
    const allowed = assertAllowedPhase(args.phase);
    if (!allowed.ok) return allowed;
  }
  if ((UNAVAILABLE_PHASES as readonly string[]).includes(args.phase ?? "")) {
    return {
      ok: false,
      error: {
        code: "PCAT-ORC-ACTIVATION-UNAVAILABLE",
        detail: `Activation phase ${args.phase} is unavailable`,
      },
    };
  }
  if (!args.graphPath || !args.targetArtifactSha) {
    return {
      ok: false,
      error: {
        code: "PCAT-ORC-INVALID-PLAN",
        detail: "Usage: --graph <json> --target-artifact-sha <40-hex> [--release-json <json>]",
      },
    };
  }
  const graph = JSON.parse(await readFile(args.graphPath, "utf8")) as FrozenP0Graph;
  const bundle = args.releaseJsonPath
    ? JSON.parse(await readFile(args.releaseJsonPath, "utf8"))
    : null;
  const input: PlanCutoverInput = {
    graph,
    targetArtifactSha: args.targetArtifactSha,
    targetCatalogReleaseDigest: args.targetCatalogReleaseDigest ?? "",
    catalogReleaseSource: bundle ? jsonCatalogReleaseSource(bundle) : undefined,
  };
  return planCutover(input);
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runPlanCutoverCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
