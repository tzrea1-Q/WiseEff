import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { publishLatestFullEvidenceRun, resolveEvidenceRunContext } from "../e2e/acceptance/helpers/evidenceRun";
import {
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  buildOwnedRuntimeArtifactEnv,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  buildAcceptanceFailureInventory,
  readFailureInventoryReport,
  writeAcceptanceFailureInventory,
} from "./acceptance-failure-inventory";
import { provisionOwnedLocalAcceptanceRuntime } from "./owned-local-acceptance-runtime";
import {
  captureGate0SourceOutputs,
  restoreAndArchiveGate0SourceOutputs,
  type Gate0SourceOutputSnapshot,
} from "./gate0-source-outputs";
import {
  sanitizeGate0DiagnosticText,
  sanitizeGate0ArtifactTree,
  scanGate0ArtifactTree,
} from "./gate0-artifact-sanitizer";
import { waitForOwnedProcessGroupExit } from "./owned-process-group";
import {
  VISUAL_REVIEW_FIXTURE_ALLOW_ENV,
  VISUAL_REVIEW_FIXTURE_DATABASE_ENV,
} from "./quality-visual-review-authorization";

type RuntimeEnv = Record<string, string | undefined>;
const execFileAsync = promisify(execFile);
type Gate0Phase = "visual" | "browser";

type Gate0PrerequisiteCommandResult = {
  status: number | null;
  error?: Error;
};

export type Gate0PrerequisiteCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit"; signal?: AbortSignal },
) => Gate0PrerequisiteCommandResult | Promise<Gate0PrerequisiteCommandResult>;

export type Gate0OwnerDeadline = {
  signal: AbortSignal;
  deadlineAt: number;
  remainingMs(stage: string): number;
  dispose(): void;
};

export type Gate0Command = {
  phase: Gate0Phase;
  command: string;
  args: string[];
  env: RuntimeEnv;
};

export const GATE0_OWNER_TIMEOUT_MS = 60 * 60 * 1_000;
export const GATE0_FINALIZATION_RESERVE_MS = 5 * 60 * 1_000;

export async function assertGate0DtsToolchainReady(
  worktreeRoot: string,
  runCommand: Gate0PrerequisiteCommandRunner = runGate0PrerequisiteCommand,
  signal?: AbortSignal,
) {
  const args = ["run", "dts:toolchain:check", "--", "--required"];
  const result = await runCommand("npm", args, {
    cwd: worktreeRoot,
    env: process.env,
    stdio: "inherit",
    signal,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ??
        `Gate0 prerequisite failed before runtime provisioning: npm ${args.join(" ")} exited ${result.status ?? "unknown"}. Run npm run dts:toolchain:bootstrap, then retry.`,
    );
  }
}

export async function prepareGate0OwnedRuntime(
  options: Parameters<typeof provisionOwnedLocalAcceptanceRuntime>[0],
  dependencies: {
    assertDtsToolchainReady?: (worktreeRoot: string, signal: AbortSignal) => void | Promise<void>;
    provisionOwnedRuntime?: typeof provisionOwnedLocalAcceptanceRuntime;
  } = {},
  owner = createGate0OwnerDeadline(GATE0_OWNER_TIMEOUT_MS),
) {
  const worktreeRoot = options.worktreeRoot ?? process.cwd();
  owner.remainingMs("DTS prerequisite");
  if (dependencies.assertDtsToolchainReady) {
    await dependencies.assertDtsToolchainReady(worktreeRoot, owner.signal);
  } else {
    await assertGate0DtsToolchainReady(worktreeRoot, undefined, owner.signal);
  }
  owner.remainingMs("runtime provisioning");
  return (dependencies.provisionOwnedRuntime ?? provisionOwnedLocalAcceptanceRuntime)({
    ...options,
    worktreeRoot,
    ownerDeadline: owner,
  });
}

export function createGate0OwnerDeadline(timeoutMs: number): Gate0OwnerDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Gate0 owner timeout must be positive.");
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => {
    controller.abort(new Error("Gate0 owner deadline elapsed."));
  }, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    deadlineAt,
    remainingMs(stage) {
      const remaining = deadlineAt - Date.now();
      if (controller.signal.aborted || remaining <= 0) {
        throw new Error(`Gate0 owner deadline elapsed before ${stage}.`);
      }
      return remaining;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

function runGate0PrerequisiteCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit"; signal?: AbortSignal },
) {
  return runGate0ChildCommand({
    command,
    args,
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    signal: options.signal,
    terminateGraceMs: 5_000,
  });
}

export function buildGate0Commands(
  descriptorPath: string,
  ownedDatabaseName: string,
): Gate0Command[] {
  const runRoot = path.dirname(descriptorPath);
  const sharedEnv = {
    [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: descriptorPath,
    WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
    WISEEFF_QUALITY_SKIP_SEED: "true",
    ...buildOwnedRuntimeArtifactEnv(runRoot),
  };
  return [
    {
      phase: "visual",
      command: "npm",
      args: ["run", "acceptance:visual"],
      env: {
        ...sharedEnv,
        [VISUAL_REVIEW_FIXTURE_ALLOW_ENV]: "true",
        [VISUAL_REVIEW_FIXTURE_DATABASE_ENV]: ownedDatabaseName,
      },
    },
    {
      phase: "browser",
      command: "npm",
      args: [
        "run",
        "acceptance:browser",
        "--",
        "--mode",
        "local-non-hdc",
        "--runtime-descriptor",
        descriptorPath,
      ],
      env: { ...sharedEnv },
    },
  ];
}

export function evaluateGate0Outcome(input: {
  visualPassed: boolean;
  browserPassed: boolean;
  failureCount: number;
}) {
  return input.visualPassed && input.browserPassed && input.failureCount === 0 ? "success" : "failure";
}

export async function runAcceptanceGate0(owner: Gate0OwnerDeadline) {
  const baseDatabaseUrl =
    process.env.WISEEFF_ACCEPTANCE_ADMIN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!baseDatabaseUrl) {
    throw new Error("DATABASE_URL or WISEEFF_ACCEPTANCE_ADMIN_DATABASE_URL is required for acceptance:gate0.");
  }

  const runtime = await prepareGate0OwnedRuntime({
    baseDatabaseUrl,
    worktreeRoot: process.cwd(),
  }, {}, owner);
  const phaseResults = new Map<Gate0Phase, boolean>();
  let timedOutPhase: Gate0Phase | undefined;
  let sourceOutputs: Gate0SourceOutputSnapshot | undefined;
  let sourceOutputsRestored = false;
  let finishAttempted = false;

  try {
    sourceOutputs = captureGate0SourceOutputs({
      worktreeRoot: process.cwd(),
      runRoot: runtime.descriptor.artifacts.runRoot,
    });
    for (const command of buildGate0Commands(
      runtime.descriptorPath,
      runtime.descriptor.database.name,
    )) {
      const startedAt = new Date().toISOString();
      runtime.updatePhase(command.phase, { status: "running", startedAt });
      const phaseLog = path.join(runtime.descriptor.artifacts.runRoot, `${command.phase}.log`);
      const result = await runGate0PhaseCommand(
        command,
        runtime.env,
        phaseLog,
        owner.remainingMs(`${command.phase} phase`) - GATE0_FINALIZATION_RESERVE_MS,
      );
      const passed = !result.error && result.status === 0;
      phaseResults.set(command.phase, passed);
      const archived = archivePhaseArtifacts(command.phase, runtime.descriptor.artifacts.runRoot);
      runtime.updatePhase(command.phase, {
        status: passed ? "passed" : "failed",
        completedAt: new Date().toISOString(),
        resultJson: archived.resultJson,
        report: archived.report,
        preflightEvidence: archived.preflightEvidence,
        ...(command.phase === "browser" ? { evidenceRunId: runtime.descriptor.run.id } : {}),
      });
      console.log(
        `[acceptance:gate0] ${command.phase}: ${result.timedOut ? "owner timeout" : passed ? "passed" : "failed"}; log ${phaseLog}`,
      );
      if (result.timedOut) {
        timedOutPhase = command.phase;
        break;
      }
    }

    const inventory = buildAcceptanceFailureInventory({
      runId: runtime.descriptor.run.id,
      sourceCommit: runtime.descriptor.run.sourceCommit,
      reports: [
        readFailureInventoryReport("visual", gate0PhaseArtifactSources("visual", runtime.descriptor.artifacts.runRoot).resultJson),
        readFailureInventoryReport("browser", gate0PhaseArtifactSources("browser", runtime.descriptor.artifacts.runRoot).resultJson),
      ],
    });
    writeAcceptanceFailureInventory(runtime.descriptor.artifacts.failureInventory, inventory);
    owner.remainingMs("source-output restoration");
    restoreAndArchiveGate0SourceOutputs(sourceOutputs);
    sourceOutputsRestored = true;
    await assertGate0SourceWorktreeRestored(process.cwd(), owner.signal);
    const outcome = evaluateGate0Outcome({
      visualPassed: phaseResults.get("visual") === true,
      browserPassed: phaseResults.get("browser") === true,
      failureCount: inventory.failureCount,
    });
    writeGate0Result(runtime.descriptor.artifacts.runRoot, {
      runId: runtime.descriptor.run.id,
      sourceCommit: runtime.descriptor.run.sourceCommit,
      outcome,
      visualPassed: phaseResults.get("visual") === true,
      browserPassed: phaseResults.get("browser") === true,
      failureCount: inventory.failureCount,
      ownerTimeoutMs: GATE0_OWNER_TIMEOUT_MS,
      timedOutPhase,
      descriptor: runtime.descriptorPath,
    });

    finishAttempted = true;
    await runtime.finish(outcome, () => finalizeGate0ArtifactSafety(runtime.descriptor.artifacts.runRoot, owner.signal).then(() => undefined));
    if (outcome === "success") {
      publishLatestFullEvidenceRun(resolveEvidenceRunContext(runtime.env));
      console.log(`[acceptance:gate0] passed; exact runtime cleanup completed for ${runtime.descriptor.run.id}.`);
      return;
    }

    console.error(
      `[acceptance:gate0] failed with ${inventory.failureCount} inventoried failures; database, object store, descriptor, and artifacts retained at ${runtime.descriptor.artifacts.runRoot}.`,
    );
    process.exitCode = 1;
  } catch (error) {
    const failures = [asGate0Error(error)];
    if (sourceOutputs && !sourceOutputsRestored) {
      try {
        restoreAndArchiveGate0SourceOutputs(sourceOutputs);
        sourceOutputsRestored = true;
        await assertGate0SourceWorktreeRestored(process.cwd(), owner.signal);
      } catch (restoreError) {
        failures.push(asGate0Error(restoreError));
      }
    }
    console.error(
      `[acceptance:gate0] infrastructure failure; owned forensic state retained at ${runtime.descriptor.artifacts.runRoot}.`,
    );
    await finalizeGate0Failure({
      runRoot: runtime.descriptor.artifacts.runRoot,
      failures,
      finish: finishAttempted
        ? undefined
        : () => runtime.finish("failure", () => finalizeGate0ArtifactSafety(runtime.descriptor.artifacts.runRoot, owner.signal).then(() => undefined)),
    });
  }
}

async function assertGate0SourceWorktreeRestored(worktreeRoot: string, signal?: AbortSignal) {
  const result = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: worktreeRoot,
    encoding: "utf8",
    signal,
  });
  if (result.stdout.trim()) {
    throw new Error(`Gate0 source worktree differs from its clean pre-run state:\n${result.stdout.trim()}`);
  }
}

export function runGate0PhaseCommand(
  command: Gate0Command,
  runtimeEnv: RuntimeEnv,
  logPath: string,
  timeoutMs: number,
  terminateGraceMs = 5_000,
) {
  const fd = openSync(logPath, "a");
  if (timeoutMs <= 0) {
    closeSync(fd);
    return Promise.resolve({
      status: null,
      error: new Error("Gate0 owner deadline elapsed before the phase started."),
      timedOut: true,
    });
  }

  return runGate0ChildCommand({
    command: command.command,
    args: command.args,
    cwd: process.cwd(),
    env: { ...process.env, ...runtimeEnv, ...command.env },
    stdio: ["ignore", fd, fd],
    timeoutMs,
    terminateGraceMs,
  }).finally(() => closeSync(fd));
}

function runGate0ChildCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: "inherit" | ["ignore", number, number];
  signal?: AbortSignal;
  timeoutMs?: number;
  terminateGraceMs: number;
}) {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: input.stdio,
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    timedOut = true;
    controller.abort(
      input.signal?.reason instanceof Error
        ? input.signal.reason
        : new Error("Gate0 owner deadline elapsed."),
    );
  };
  const timeout = input.timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Gate0 owner deadline elapsed during command execution."));
      }, input.timeoutMs);
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener("abort", abort, { once: true });

  return waitForOwnedProcessGroupExit(child, {
    signal: controller.signal,
    terminateGraceMs: input.terminateGraceMs,
  }).then(
    (status) => ({ status, error: undefined, timedOut }),
    (error) => ({ status: child.exitCode, error: asGate0Error(error), timedOut }),
  ).finally(() => {
    if (timeout) clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  });
}

function archivePhaseArtifacts(phase: Gate0Phase, runRoot: string) {
  const sources = gate0PhaseArtifactSources(phase, runRoot);
  return {
    resultJson: existsSync(sources.resultJson) ? sources.resultJson : undefined,
    report: existsSync(path.join(sources.report, "index.html")) ? path.join(sources.report, "index.html") : undefined,
    preflightEvidence: sources.preflight && existsSync(path.join(sources.preflight, "evidence.md"))
      ? path.join(sources.preflight, "evidence.md")
      : undefined,
  };
}

export function gate0PhaseArtifactSources(phase: Gate0Phase, runRoot: string) {
  const visual = phase === "visual";
  const phaseRoot = path.join(runRoot, "artifacts", phase);
  return {
    resultJson: path.join(phaseRoot, "test-results", "results.json"),
    resultsRoot: path.join(phaseRoot, "test-results"),
    report: path.join(phaseRoot, "playwright-report"),
    preflight: visual ? undefined : path.join(phaseRoot, "preflight"),
  };
}

function writeGate0Result(runRoot: string, result: Record<string, unknown>) {
  writeFileSync(
    path.join(runRoot, "gate0-result.json"),
    `${JSON.stringify({ kind: "wiseeff-acceptance-gate0-result", ...result, recordedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function writeGate0Failure(runRoot: string, failures: Error[]) {
  writeFileSync(
    path.join(runRoot, "gate0-failure.json"),
    `${JSON.stringify({
      kind: "wiseeff-acceptance-gate0-failure",
      failures: failures.map((failure, index) => ({
        stage: index === 0 ? "primary" : "finalization",
        message: sanitizeGate0DiagnosticText(failure.message).value,
      })),
      recordedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

export async function finalizeGate0Failure(input: {
  runRoot: string;
  failures: Error[];
  finish?: () => Promise<void>;
  artifactSafety?: (runRoot: string) => Promise<unknown>;
}): Promise<never> {
  const failures = [...input.failures];
  if (input.finish) {
    try {
      await input.finish();
    } catch (finishError) {
      failures.push(asGate0Error(finishError));
    }
  }
  writeGate0Failure(input.runRoot, failures);
  try {
    await (input.artifactSafety ?? finalizeGate0ArtifactSafety)(input.runRoot);
  } catch (safetyError) {
    failures.push(asGate0Error(safetyError));
    writeGate0Failure(input.runRoot, failures);
  }
  throw new AggregateError(failures, "Gate0 failed and retained its exact forensic runtime.");
}

function asGate0Error(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function finalizeGate0ArtifactSafety(runRoot: string, signal?: AbortSignal) {
  const sanitization = await sanitizeGate0ArtifactTree(runRoot, signal);
  const scan = await scanGate0ArtifactTree(runRoot, signal);
  if (scan.violations.length > 0) {
    throw new Error(
      `Gate0 artifact safety scan found ${scan.violations.length} credential-bearing path(s); upload is forbidden.`,
    );
  }
  const report = { sanitization, scan, recordedAt: new Date().toISOString() };
  writeFileSync(
    path.join(runRoot, "artifact-safety.json"),
    `${JSON.stringify({ kind: "wiseeff-gate0-artifact-safety", ...report }, null, 2)}\n`,
    "utf8",
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const owner = createGate0OwnerDeadline(GATE0_OWNER_TIMEOUT_MS);
  try {
    await runAcceptanceGate0(owner);
  } finally {
    owner.dispose();
  }
}
