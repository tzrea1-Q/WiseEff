import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { publishLatestFullEvidenceRun, resolveEvidenceRunContext } from "../e2e/acceptance/helpers/evidenceRun";
import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
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

type RuntimeEnv = Record<string, string | undefined>;
type Gate0Phase = "visual" | "browser";

type Gate0PrerequisiteCommandResult = {
  status: number | null;
  error?: Error;
};

export type Gate0PrerequisiteCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" },
) => Gate0PrerequisiteCommandResult;

export type Gate0Command = {
  phase: Gate0Phase;
  command: string;
  args: string[];
  env: RuntimeEnv;
};

export const GATE0_OWNER_TIMEOUT_MS = 60 * 60 * 1_000;

export function assertGate0DtsToolchainReady(
  worktreeRoot: string,
  runCommand: Gate0PrerequisiteCommandRunner = (command, args, options) => {
    const result = spawnSync(command, args, options);
    return { status: result.status, error: result.error };
  },
) {
  const args = ["run", "dts:toolchain:check", "--", "--required"];
  const result = runCommand("npm", args, {
    cwd: worktreeRoot,
    env: process.env,
    stdio: "inherit",
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
    assertDtsToolchainReady?: (worktreeRoot: string) => void;
    provisionOwnedRuntime?: typeof provisionOwnedLocalAcceptanceRuntime;
  } = {},
) {
  const worktreeRoot = options.worktreeRoot ?? process.cwd();
  (dependencies.assertDtsToolchainReady ?? assertGate0DtsToolchainReady)(worktreeRoot);
  return (dependencies.provisionOwnedRuntime ?? provisionOwnedLocalAcceptanceRuntime)({
    ...options,
    worktreeRoot,
  });
}

export function buildGate0Commands(descriptorPath: string): Gate0Command[] {
  const sharedEnv = {
    [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: descriptorPath,
    WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
    WISEEFF_QUALITY_SKIP_SEED: "true",
  };
  return [
    {
      phase: "visual",
      command: "npm",
      args: ["run", "acceptance:visual"],
      env: { ...sharedEnv },
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

async function main() {
  const ownerDeadline = Date.now() + GATE0_OWNER_TIMEOUT_MS;
  const baseDatabaseUrl =
    process.env.WISEEFF_ACCEPTANCE_ADMIN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!baseDatabaseUrl) {
    throw new Error("DATABASE_URL or WISEEFF_ACCEPTANCE_ADMIN_DATABASE_URL is required for acceptance:gate0.");
  }

  const runtime = await prepareGate0OwnedRuntime({
    baseDatabaseUrl,
    worktreeRoot: process.cwd(),
  });
  const phaseResults = new Map<Gate0Phase, boolean>();
  let timedOutPhase: Gate0Phase | undefined;
  let sourceOutputs: Gate0SourceOutputSnapshot | undefined;
  let sourceOutputsRestored = false;

  try {
    sourceOutputs = captureGate0SourceOutputs({
      worktreeRoot: process.cwd(),
      runRoot: runtime.descriptor.artifacts.runRoot,
    });
    preparePhaseOutputRoots(process.cwd());
    for (const command of buildGate0Commands(runtime.descriptorPath)) {
      const startedAt = new Date().toISOString();
      runtime.updatePhase(command.phase, { status: "running", startedAt });
      const phaseLog = path.join(runtime.descriptor.artifacts.runRoot, `${command.phase}.log`);
      const result = await runGate0PhaseCommand(
        command,
        runtime.env,
        phaseLog,
        Math.max(0, ownerDeadline - Date.now()),
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
        readFailureInventoryReport("visual", path.resolve("test-results/quality/results.json")),
        readFailureInventoryReport("browser", path.resolve("test-results/acceptance/results.json")),
      ],
    });
    writeAcceptanceFailureInventory(runtime.descriptor.artifacts.failureInventory, inventory);
    restoreAndArchiveGate0SourceOutputs(sourceOutputs);
    sourceOutputsRestored = true;
    assertGate0SourceWorktreeRestored(process.cwd());
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

    await runtime.finish(outcome);
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
    if (sourceOutputs && !sourceOutputsRestored) {
      try {
        restoreAndArchiveGate0SourceOutputs(sourceOutputs);
        sourceOutputsRestored = true;
        assertGate0SourceWorktreeRestored(process.cwd());
      } catch (restoreError) {
        console.error(
          `[acceptance:gate0] source-worktree restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      }
    }
    await runtime.finish("failure").catch(() => undefined);
    console.error(
      `[acceptance:gate0] infrastructure failure; owned forensic state retained at ${runtime.descriptor.artifacts.runRoot}.`,
    );
    throw error;
  }
}

function assertGate0SourceWorktreeRestored(worktreeRoot: string) {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: worktreeRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Gate0 could not verify source-worktree restoration: ${result.stderr.trim()}`);
  }
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

  const child = spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...runtimeEnv, ...command.env },
    stdio: ["ignore", fd, fd],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });

  return new Promise<{ status: number | null; error?: Error; timedOut: boolean }>((resolve) => {
    let spawnError: Error | undefined;
    let timedOut = false;
    let closedStatus: number | null = null;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      closeSync(fd);
      resolve({ status: closedStatus, error: spawnError, timedOut });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      spawnError ??= signalPhaseProcessTree(child, "SIGTERM");
      setTimeout(() => {
        spawnError ??= signalPhaseProcessTree(child, "SIGKILL");
        setTimeout(() => {
          if (phaseProcessTreeExists(child)) {
            spawnError ??= new Error(`Gate0 could not stop timed-out phase process group ${child.pid}.`);
          }
          settle();
        }, 50);
      }, terminateGraceMs);
    }, timeoutMs);

    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) => {
      closedStatus = status;
      if (!timedOut) {
        clearTimeout(timeout);
        settle();
      }
    });
  });
}

function signalPhaseProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return new Error("Gate0 phase process did not expose a PID.");
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
}

function phaseProcessTreeExists(child: ChildProcess) {
  if (!child.pid) return false;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function preparePhaseOutputRoots(worktreeRoot: string) {
  for (const relative of [
    "test-results/quality",
    "test-results/acceptance",
    "test-results/acceptance-preflight",
    "playwright-report/quality",
    "playwright-report/acceptance",
  ]) {
    const target = path.resolve(worktreeRoot, relative);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

function archivePhaseArtifacts(phase: Gate0Phase, runRoot: string) {
  const sources = gate0PhaseArtifactSources(phase);
  const phaseRoot = path.join(runRoot, "artifacts", phase);
  mkdirSync(phaseRoot, { recursive: true });
  const resultsTarget = path.join(phaseRoot, "test-results");
  const reportTarget = path.join(phaseRoot, "playwright-report");
  const preflightTarget = path.join(phaseRoot, "preflight");
  if (existsSync(sources.resultsRoot)) cpSync(sources.resultsRoot, resultsTarget, { recursive: true });
  if (existsSync(sources.report)) cpSync(sources.report, reportTarget, { recursive: true });
  if (sources.preflight && existsSync(sources.preflight)) {
    cpSync(sources.preflight, preflightTarget, { recursive: true });
  }
  return {
    resultJson: existsSync(sources.resultJson) ? path.join(resultsTarget, "results.json") : undefined,
    report: existsSync(path.join(sources.report, "index.html")) ? path.join(reportTarget, "index.html") : undefined,
    preflightEvidence: sources.preflight && existsSync(path.join(sources.preflight, "evidence.md"))
      ? path.join(preflightTarget, "evidence.md")
      : undefined,
  };
}

export function gate0PhaseArtifactSources(phase: Gate0Phase) {
  const visual = phase === "visual";
  return {
    resultJson: path.resolve(visual ? "test-results/quality/results.json" : "test-results/acceptance/results.json"),
    resultsRoot: path.resolve(visual ? "test-results/quality" : "test-results/acceptance"),
    report: path.resolve(visual ? "playwright-report/quality" : "playwright-report/acceptance"),
    preflight: visual ? undefined : path.resolve("test-results/acceptance-preflight"),
  };
}

function writeGate0Result(runRoot: string, result: Record<string, unknown>) {
  writeFileSync(
    path.join(runRoot, "gate0-result.json"),
    `${JSON.stringify({ kind: "wiseeff-acceptance-gate0-result", ...result, recordedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
