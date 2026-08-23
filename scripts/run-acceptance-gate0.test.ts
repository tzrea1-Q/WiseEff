import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { provisionOwnedLocalAcceptanceRuntime } from "./owned-local-acceptance-runtime";

import {
  GATE0_OWNER_TIMEOUT_MS,
  GATE0_FINALIZATION_RESERVE_MS,
  assertGate0DtsToolchainReady,
  buildGate0Commands,
  createGate0OwnerDeadline,
  evaluateGate0Outcome,
  gate0PhaseArtifactSources,
  finalizeGate0ArtifactSafety,
  finalizeGate0Failure,
  prepareGate0OwnedRuntime,
  runGate0Cli,
  runGate0PhaseCommand,
} from "./run-acceptance-gate0";

describe("acceptance Gate 0 runner", () => {
  it("runs the pinned required DTS check through the public command", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    await assertGate0DtsToolchainReady("/repo", (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 0, error: undefined };
    });

    expect(calls).toEqual([
      {
        command: "npm",
        args: ["run", "dts:toolchain:check", "--", "--required"],
        cwd: "/repo",
      },
    ]);
  });

  it("fails missing DTS tooling before provisioning any owned resource", async () => {
    let provisionCalls = 0;

    await expect(
      prepareGate0OwnedRuntime(
        {
          baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
          worktreeRoot: "/repo",
        },
        {
          assertDtsToolchainReady: async () => {
            throw new Error("DTS toolchain required but incomplete");
          },
          provisionOwnedRuntime: async () => {
            provisionCalls += 1;
            throw new Error("must not provision");
          },
        },
      ),
    ).rejects.toThrow("DTS toolchain required but incomplete");
    expect(provisionCalls).toBe(0);
  });

  it("starts the owner deadline before prerequisites and never provisions after it expires", async () => {
    const owner = createGate0OwnerDeadline(25);
    let provisionCalls = 0;

    await expect(
      prepareGate0OwnedRuntime(
        {
          baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
          worktreeRoot: "/repo",
        },
        {
          assertDtsToolchainReady: async (_root, signal) => {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
          provisionOwnedRuntime: async () => {
            provisionCalls += 1;
            throw new Error("must not provision");
          },
        },
        owner,
      ),
    ).rejects.toThrow(/deadline/i);
    expect(provisionCalls).toBe(0);
    owner.dispose();
  });

  it("propagates the same deadline into provisioning and leaves no orphaned child", async () => {
    const owner = createGate0OwnerDeadline(100);
    let childPid = 0;
    await expect(
      prepareGate0OwnedRuntime(
        {
          baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
          worktreeRoot: "/repo",
        },
        {
          assertDtsToolchainReady: async () => undefined,
          provisionOwnedRuntime: (async (options) => {
            const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
              detached: process.platform !== "win32",
              stdio: "ignore",
            });
            childPid = child.pid!;
            const signal = options.ownerDeadline!.signal;
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                if (process.platform === "win32") child.kill("SIGTERM");
                else process.kill(-child.pid!, "SIGTERM");
                reject(signal.reason);
              }, { once: true });
            });
            throw new Error("unreachable");
          }) as typeof provisionOwnedLocalAcceptanceRuntime,
        },
        owner,
      ),
    ).rejects.toThrow(/deadline/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(() => process.kill(childPid, 0)).toThrow();
    owner.dispose();
  });

  it("owns a hard 60 minute deadline so timeout cleanup runs before the CI job is killed", () => {
    expect(GATE0_OWNER_TIMEOUT_MS).toBe(60 * 60 * 1_000);
    expect(GATE0_FINALIZATION_RESERVE_MS).toBe(5 * 60 * 1_000);
  });

  it("keeps the hard finalization budget available after an external cancellation", () => {
    const owner = createGate0OwnerDeadline(10_000);
    owner.abort(new Error("Gate0 owner received SIGTERM."));

    expect(() => owner.remainingMs("new phase")).toThrow(/SIGTERM/);
    expect(owner.finalizationRemainingMs("failure cleanup")).toBeGreaterThan(0);
    expect(owner.finalizationSignal.aborted).toBe(false);
    owner.dispose();
  });

  it("reserves the final hard-deadline window across the real prerequisite and provision pipeline", async () => {
    const owner = createGate0OwnerDeadline(300, 100);
    const operationAbort = new Promise<void>((resolve) => {
      owner.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    await operationAbort;

    expect(owner.signal.aborted).toBe(true);
    expect(owner.finalizationSignal.aborted).toBe(false);
    expect(owner.finalizationRemainingMs("failure finalization")).toBeGreaterThan(0);
    owner.dispose();
  });

  it("settles the public CLI at the 60ms hard deadline even when finalization ignores cancellation", async () => {
    const startedAt = Date.now();

    await expect(runGate0Cli({
      timeoutMs: 60,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 220));
      },
    })).rejects.toThrow(/hard owner deadline/i);

    expect(Date.now() - startedAt).toBeLessThan(180);
  });

  it("terminates the exact phase process when the owner deadline elapses", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-timeout-"));
    const pidFile = path.join(root, "pid");
    const result = await runGate0PhaseCommand(
      {
        phase: "visual",
        command: process.execPath,
        args: [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`,
        ],
        env: {},
      },
      {},
      path.join(root, "phase.log"),
      500,
      50,
    );
    const pid = Number(readFileSync(pidFile, "utf8"));

    expect(result).toMatchObject({ timedOut: true });
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("launches a Gate0 phase without inherited host credentials", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-phase-env-"));
    const logPath = path.join(root, "phase.log");
    vi.stubEnv("PGPASSWORD", "host-postgres-secret");
    vi.stubEnv("DOCKER_AUTH_CONFIG", "host-docker-secret");
    vi.stubEnv("CI_JOB_JWT", "host-ci-token");

    try {
      const result = await runGate0PhaseCommand(
        {
          phase: "visual",
          command: process.execPath,
          args: ["-e", "console.log(JSON.stringify({PGPASSWORD:process.env.PGPASSWORD,DOCKER_AUTH_CONFIG:process.env.DOCKER_AUTH_CONFIG,CI_JOB_JWT:process.env.CI_JOB_JWT,DATABASE_URL:process.env.DATABASE_URL}))"],
          env: {},
        },
        { DATABASE_URL: "postgres://owned:owned@127.0.0.1:5432/owned" },
        logPath,
        5_000,
      );

      expect(result).toMatchObject({ status: 0, timedOut: false });
      expect(JSON.parse(readFileSync(logPath, "utf8").trim())).toEqual({
        DATABASE_URL: "postgres://owned:owned@127.0.0.1:5432/owned",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.skipIf(process.platform === "win32")(
    "traps a real SIGTERM, waits for owned child finalization, and exits with signal semantics",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-signal-"));
      const scriptPath = path.join(root, "signal-owner.mjs");
      const workerPidPath = path.join(root, "worker.pid");
      const finalizedPath = path.join(root, "finalized");
      const runnerUrl = pathToFileURL(path.resolve("scripts/run-acceptance-gate0.ts")).href;
      const processGroupUrl = pathToFileURL(path.resolve("scripts/owned-process-group.ts")).href;
      writeFileSync(scriptPath, `
        import { spawn } from "node:child_process";
        import { writeFileSync } from "node:fs";
        import { runGate0Cli } from ${JSON.stringify(runnerUrl)};
        import { stopOwnedProcessGroup } from ${JSON.stringify(processGroupUrl)};
        await runGate0Cli({
          timeoutMs: 10_000,
          execute: async (owner) => {
            const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              detached: true,
              stdio: "ignore",
            });
            await new Promise((resolve, reject) => {
              child.once("spawn", resolve);
              child.once("error", reject);
            });
            writeFileSync(${JSON.stringify(workerPidPath)}, String(child.pid));
            await new Promise((resolve) => owner.signal.addEventListener("abort", resolve, { once: true }));
            await stopOwnedProcessGroup(child, { terminateGraceMs: 25, verifyGraceMs: 250 });
            writeFileSync(${JSON.stringify(finalizedPath)}, "complete");
            throw owner.signal.reason;
          },
        });
      `);
      const cli = spawn(process.execPath, ["--import", "tsx", scriptPath], {
        cwd: process.cwd(),
        stdio: "ignore",
      });
      for (let attempt = 0; attempt < 100 && !existsSync(workerPidPath); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(existsSync(workerPidPath)).toBe(true);
      const workerPid = Number(readFileSync(workerPidPath, "utf8"));

      cli.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        cli.once("close", resolve);
        cli.once("error", reject);
      });

      expect(exitCode).toBe(143);
      expect(readFileSync(finalizedPath, "utf8")).toBe("complete");
      expect(() => process.kill(workerPid, 0)).toThrow();
    },
  );

  it("authorizes the visual fixture for the exact owned database without widening browser access", () => {
    const commands = buildGate0Commands(
      "/tmp/owned-full/runtime.json",
      "wiseeff_acceptance_full_20260823_gate0",
    );

    expect(commands).toEqual([
      expect.objectContaining({
        phase: "visual",
        args: ["run", "acceptance:visual"],
        env: expect.objectContaining({
          WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned-full/runtime.json",
          WISEEFF_ACCEPTANCE_OWNED_RUNTIME: "true",
          WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
          WISEEFF_QUALITY_SKIP_SEED: "true",
          WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE: "true",
          WISEEFF_QUALITY_FIXTURE_DATABASE_NAME: "wiseeff_acceptance_full_20260823_gate0",
          WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR: "/tmp/owned-full/artifacts/visual/test-results",
          WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR: "/tmp/owned-full/artifacts/visual/playwright-report",
          WISEEFF_QUALITY_SNAPSHOT_ROOT: "/tmp/owned-full/artifacts/visual/snapshots",
        }),
      }),
      expect.objectContaining({
        phase: "browser",
        args: [
          "run",
          "acceptance:browser",
          "--",
          "--mode",
          "local-non-hdc",
          "--runtime-descriptor",
          "/tmp/owned-full/runtime.json",
        ],
        env: expect.objectContaining({
          WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned-full/runtime.json",
          WISEEFF_ACCEPTANCE_OWNED_RUNTIME: "true",
          WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
          WISEEFF_QUALITY_SKIP_SEED: "true",
          WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR: "/tmp/owned-full/artifacts/browser/test-results",
          WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR: "/tmp/owned-full/artifacts/browser/playwright-report",
        }),
      }),
    ]);
    expect(commands[1]?.env).not.toHaveProperty("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE");
    expect(commands[1]?.env).not.toHaveProperty("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME");
  });

  it("archives browser preflight outside the Playwright-cleaned output directory", () => {
    expect(gate0PhaseArtifactSources("browser", "/tmp/owned-full")).toMatchObject({
      resultsRoot: "/tmp/owned-full/artifacts/browser/test-results",
      preflight: "/tmp/owned-full/artifacts/browser/preflight",
    });
  });

  it("allows exact cleanup only after both phases and the inventory pass", () => {
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: true, failureCount: 0 })).toBe("success");
    expect(evaluateGate0Outcome({ visualPassed: false, browserPassed: true, failureCount: 1 })).toBe("failure");
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: false, failureCount: 1 })).toBe("failure");
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: true, failureCount: 1 })).toBe("failure");
  });

  it("sanitizes and fail-closed scans the run tree before it can be uploaded", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-finalize-"));
    writeFileSync(path.join(runRoot, "phase.log"), "authorization=Bearer gate0-finalizer-secret\n");

    const report = await finalizeGate0ArtifactSafety(runRoot);

    expect(report.scan.violations).toEqual([]);
    expect(report.sanitization.replacements).toBe(1);
    expect(readFileSync(path.join(runRoot, "phase.log"), "utf8")).toContain("Bearer [REDACTED]");
    expect(readFileSync(path.join(runRoot, "artifact-safety.json"), "utf8")).not.toContain(
      "gate0-finalizer-secret",
    );
  });

  it("combines the primary phase error with failure-cleanup errors in an explicit safe artifact", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-failure-"));
    const caught = await finalizeGate0Failure({
      runRoot,
      failures: [new Error("phase failed for Bearer primary-secret-token")],
      finish: async () => { throw new Error("PID cleanup failed for Bearer cleanup-secret-token"); },
      artifactSafety: async () => undefined,
    }).catch((error) => error as AggregateError);

    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toHaveLength(2);
    const artifact = readFileSync(path.join(runRoot, "gate0-failure.json"), "utf8");
    expect(artifact).toContain("phase failed");
    expect(artifact).toContain("PID cleanup failed");
    expect(artifact).toContain("Bearer [REDACTED]");
    expect(artifact).not.toContain("primary-secret-token");
    expect(artifact).not.toContain("cleanup-secret-token");
  });
});
import { spawn } from "node:child_process";
