import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { createLocalArchiveObjectStore } from "../../server/modules/catalog-cutover/archive";
import type { FrozenP0Graph } from "../../server/modules/catalog-cutover/classifier";
import { assertAllowedPhase } from "../../server/modules/catalog-cutover/checkpoints";
import type { CutoverPlan, PreActivationPhase } from "../../server/modules/catalog-cutover/interface";
import { executeCutover, planCutover } from "../../server/modules/catalog-cutover/orchestrator";
import { writeSanitizedCutoverOutput } from "./cutoverDiagnostic";

export type ExecuteCliArgs = {
  readonly databaseUrl: string | null;
  readonly graphPath: string;
  readonly releaseJsonPath: string;
  readonly targetArtifactSha: string;
  readonly targetCatalogReleaseDigest: string;
  readonly archiveRoot: string;
  readonly archiveKeyHex: string;
  readonly operatorAuditRef: string;
  readonly phase: string | null;
  readonly failBeforePhase: string | null;
  readonly quiescenceJsonPath: string | null;
  readonly recoveryJsonPath: string | null;
  readonly identityJsonPath: string | null;
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
};

export const parseExecuteCliArgs = (argv: readonly string[]): ExecuteCliArgs => ({
  databaseUrl: readOption(argv, "--database-url") ?? process.env.DATABASE_URL ?? null,
  graphPath: readOption(argv, "--graph") ?? "",
  releaseJsonPath: readOption(argv, "--release-json") ?? "",
  targetArtifactSha: readOption(argv, "--target-artifact-sha") ?? "",
  targetCatalogReleaseDigest: readOption(argv, "--target-catalog-release-digest") ?? "",
  archiveRoot: readOption(argv, "--archive-root") ?? "",
  archiveKeyHex: readOption(argv, "--archive-key-hex") ?? "",
  operatorAuditRef: readOption(argv, "--operator-audit-ref") ?? "audit-s7orc-operator",
  phase: readOption(argv, "--phase") ?? null,
  failBeforePhase: readOption(argv, "--fail-before-phase") ?? null,
  quiescenceJsonPath: readOption(argv, "--quiescence-json") ?? process.env.WISEEFF_CATALOG_QUIESCENCE_JSON ?? null,
  recoveryJsonPath: readOption(argv, "--recovery-json") ?? process.env.WISEEFF_CATALOG_RECOVERY_JSON ?? null,
  identityJsonPath: readOption(argv, "--identity-json") ?? process.env.WISEEFF_CATALOG_IDENTITY_JSON ?? null,
});

export const runExecuteCutoverCli = async (argv: readonly string[]) => {
  const args = parseExecuteCliArgs(argv);
  if (args.phase) {
    const allowed = assertAllowedPhase(args.phase);
    if (!allowed.ok) return allowed;
  }
  if (args.failBeforePhase) {
    const allowed = assertAllowedPhase(args.failBeforePhase);
    if (!allowed.ok) return allowed;
  }
  if (!args.databaseUrl || !args.graphPath || !args.releaseJsonPath) {
    return {
      ok: false as const,
      error: {
        code: "PCAT-ORC-INVALID-PLAN",
        detail: "execute requires --database-url, --graph, and --release-json",
      },
    };
  }
  const graph = JSON.parse(await readFile(args.graphPath, "utf8")) as FrozenP0Graph;
  const bundle = JSON.parse(await readFile(args.releaseJsonPath, "utf8"));
  const source = jsonCatalogReleaseSource(bundle);
  const identities = args.identityJsonPath
    ? JSON.parse(await readFile(args.identityJsonPath, "utf8"))
    : undefined;
  const planned = await planCutover({
    graph,
    targetArtifactSha: args.targetArtifactSha,
    targetCatalogReleaseDigest: args.targetCatalogReleaseDigest,
    identities: identities as never,
    catalogReleaseSource: source,
  });
  if (!planned.ok) return planned;
  const plan: CutoverPlan = planned.value;
  let quiescence: unknown;
  if (args.quiescenceJsonPath) {
    quiescence = JSON.parse(await readFile(args.quiescenceJsonPath, "utf8")) as unknown;
  }
  let recoveryPoint: unknown;
  if (args.recoveryJsonPath) {
    recoveryPoint = JSON.parse(await readFile(args.recoveryJsonPath, "utf8")) as unknown;
  }
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 4 });
  try {
    return await executeCutover({
      pool,
      plan,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: createLocalArchiveObjectStore(args.archiveRoot || "/tmp/s7orc-archive"),
      archiveEncryptionKey: Buffer.from(
        args.archiveKeyHex || "11".repeat(32),
        "hex",
      ),
      operatorAuditRef: args.operatorAuditRef,
      failBeforePhase: (args.failBeforePhase as PreActivationPhase | null) ?? undefined,
      quiescence,
      recoveryPoint,
      observedIdentities: identities,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runExecuteCutoverCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(writeSanitizedCutoverOutput(result));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
