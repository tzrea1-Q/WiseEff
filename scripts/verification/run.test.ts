import { appendFileSync, chmodSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, constants as fsConstants, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

import {
  buildFreshArgv,
  buildFreshChildEnvironment,
  disposeOwnedLock,
  ensurePathAncestors,
  implementationRoot,
  parseDiscovery,
  parseRunArgs,
  renderTerminal,
  runNative,
  taskSpec,
  TASK_IDS,
  writeAtomicRecord,
  type TerminalResult,
} from "./run";

const fixtureDirectories: string[] = [];

function fixtureDirectory(): string {
  const parent = testRunsDirectory();
  const directory = mkdtempSync(path.join(parent, "eff04-test-"));
  fixtureDirectories.push(directory);
  writeFileSync(path.join(directory, "stdout.log"), "", { mode: 0o600 });
  writeFileSync(path.join(directory, "stderr.log"), "", { mode: 0o600 });
  return directory;
}

function testRunsDirectory(): string {
  const parent = path.join(implementationRoot, "work", "verification-runs");
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o755 });
  const stat = lstatSync(parent);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== 0o755) throw new Error("UNSAFE_TEST_RUN_DIRECTORY");
  return parent;
}

const fixtureSourcePaths = [
  "vite.config.ts", "vitest.scripts.config.ts", "scripts/verify.ts", "scripts/check-workspace-links.ts",
  "scripts/run-vitest.ts", "scripts/owned-process-group.ts", "scripts/process-start-identity.ts", "scripts/ci-required-results.ts",
  "scripts/verification/plan.ts", "scripts/verification/selection.ts", "scripts/verification/registry.json",
  "scripts/verification/run.ts", "scripts/verification/run.test.ts", "scripts/verification/report.ts", "scripts/verification/report.test.ts",
] as const;

type MatrixScenario = {
  name: string;
  discovery?: "valid" | "zero";
  report?: "valid" | "zero" | "allskip" | "stale" | "empty" | "missing" | "malformed";
  exitCode?: number;
  drift?: "metadata" | "entry";
  signalPhase?: "discovery" | "execution";
  signal?: "SIGINT" | "SIGTERM";
};

type FixtureRun = {
  scenario: string;
  status: number | null;
  stdout: string;
  stderr: string;
  runId: string | null;
  record: Record<string, any> | null;
  fixture: string;
  markerObserved?: boolean;
  markerPid?: number;
  markerSettled?: boolean;
};

function fixtureGit(cwd: string, args: string[]): string {
  return execFileSync("/usr/bin/git", ["--no-pager", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function fixtureEntry(scenarioPath: string): string {
  return `import { appendFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const scenario = JSON.parse(readFileSync(${JSON.stringify(scenarioPath)}, "utf8"));
const file = path.join(root, "scripts/ci-changed-paths.test.ts");
const marker = path.join(root, "phase-marker.log");
const phase = process.argv.includes("list") ? "discovery" : "execution";
appendFileSync(marker, phase + ":pid:" + process.pid + "\\n");
const wait = () => { setTimeout(() => process.exit(0), 1500); };
if (phase === "discovery") {
  if (scenario.discovery === "zero") process.stdout.write("[]");
  else process.stdout.write(JSON.stringify([{ file }]));
  if (scenario.signalPhase === phase) wait();
  else process.exit(0);
} else {
  if (scenario.drift === "metadata") appendFileSync(${JSON.stringify(path.join(path.dirname(scenarioPath), "node_modules/vitest/package.json"))}, "\\n");
  if (scenario.drift === "entry") appendFileSync(${JSON.stringify(path.join(path.dirname(scenarioPath), "node_modules/vitest/vitest.mjs"))}, "\\n");
  const output = process.argv.find(value => value.startsWith("--outputFile="))?.slice("--outputFile=".length);
  if (scenario.report === "missing" && output) { try { unlinkSync(output); } catch {} }
  else if (scenario.report !== "empty" && output) {
    const assertion = scenario.report === "allskip" ? { status: "skipped", failureMessages: [] } : { status: "passed", failureMessages: [] };
    const report = scenario.report === "zero" ? { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, numTodoTests: 0, numTotalTestSuites: 0, numPassedTestSuites: 0, numTotalTests: 0, numPassedTests: 0, numPendingTests: 0, startTime: Date.now(), testResults: [] }
      : scenario.report === "malformed" ? "{"
      : { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, numTodoTests: 0, numTotalTestSuites: 1, numPassedTestSuites: 1, numTotalTests: 1, numPassedTests: scenario.report === "allskip" ? 0 : 1, numPendingTests: scenario.report === "allskip" ? 1 : 0, startTime: scenario.report === "stale" ? 0 : Date.now(), testResults: [{ name: file, status: "passed", message: "", assertionResults: [assertion] }] };
    appendFileSync(output, typeof report === "string" ? report : JSON.stringify(report));
  }
  if (scenario.signalPhase === phase) wait();
  else { if (scenario.exitCode !== undefined) process.exitCode = scenario.exitCode; process.exit(); }
}`;
}

function createMatrixFixture(): { root: string; sourceHashes: Record<string, string> } {
  const parent = testRunsDirectory();
  const root = mkdtempSync(path.join(parent, "eff04-matrix-fixture-"));
  chmodSync(root, 0o755);
  for (const relative of fixtureSourcePaths) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    copyFileSync(path.join(implementationRoot, relative), target);
    chmodSync(target, 0o644);
  }
  mkdirSync(path.join(root, "scripts"), { recursive: true, mode: 0o755 });
  writeFileSync(path.join(root, "scripts/ci-changed-paths.test.ts"), "export {};\n", { mode: 0o644 });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "eff04-fixture", version: "0.1.0", type: "module" }) + "\n", { mode: 0o644 });
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "eff04-fixture", version: "0.1.0", lockfileVersion: 3, requires: true, packages: { "": { name: "eff04-fixture", version: "0.1.0" } } }) + "\n", { mode: 0o644 });
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\nwork/\neff04-scenario.json\nphase-marker.log\n", { mode: 0o644 });
  mkdirSync(path.join(root, "node_modules/vitest"), { recursive: true, mode: 0o755 });
  const scenarioPath = path.join(root, "eff04-scenario.json");
  writeFileSync(path.join(root, "node_modules/vitest/package.json"), JSON.stringify({ name: "vitest", version: "4.1.5" }) + "\n", { mode: 0o644 });
  writeFileSync(path.join(root, "node_modules/vitest/vitest.mjs"), fixtureEntry(scenarioPath), { mode: 0o644 });
  writeFileSync(scenarioPath, "{}\n", { mode: 0o600 });
  fixtureGit(root, ["init", "--initial-branch=main"]);
  fixtureGit(root, ["config", "user.name", "EFF04 fixture"]);
  fixtureGit(root, ["config", "user.email", "eff04-fixture@example.invalid"]);
  fixtureGit(root, ["add", "."]);
  fixtureGit(root, ["commit", "-m", "fixture baseline"]);
  const sourceHashes = Object.fromEntries(fixtureSourcePaths.map(relative => [relative, createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex")]));
  return { root, sourceHashes };
}

function copyFixtureEvidence(result: FixtureRun, sourceHashes: Record<string, string>, invocationRoot: string): void {
  const evidenceRoot = path.join(invocationRoot, result.scenario);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(evidenceRoot, "process.json"), JSON.stringify({ scenario: result.scenario, status: result.status, runId: result.runId, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), markerObserved: result.markerObserved, markerPid: result.markerPid, markerSettled: result.markerSettled, fixture: result.fixture, record: result.record && { complete: result.record.complete, claimedStatus: result.record.claimedStatus, error: result.record.error, wallMs: result.record.wallMs, exitCode: result.record.exitCode, signal: result.record.signal } }) + "\n", { mode: 0o600 });
  writeFileSync(path.join(evidenceRoot, "terminal.json"), result.stdout, { mode: 0o600 });
  writeFileSync(path.join(evidenceRoot, "cli.stdout.log"), result.stdout, { mode: 0o600 });
  writeFileSync(path.join(evidenceRoot, "process.stderr.log"), result.stderr, { mode: 0o600 });
  writeFileSync(path.join(evidenceRoot, "source-hashes.json"), JSON.stringify(sourceHashes, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(path.join(evidenceRoot, "fixture-git.json"), JSON.stringify({ head: fixtureGit(result.fixture, ["rev-parse", "HEAD"]), tree: fixtureGit(result.fixture, ["rev-parse", "HEAD^{tree}"]), status: fixtureGit(result.fixture, ["status", "--porcelain=v1", "--untracked-files=all"]) }) + "\n", { mode: 0o600 });
  if (!result.runId) return;
  const runRoot = path.join(result.fixture, "work", "verification-runs", result.runId);
  if (!existsSync(runRoot)) writeFileSync(path.join(evidenceRoot, "fixture-run-directory-missing.txt"), `${readdirSync(path.join(result.fixture, "work", "verification-runs"), { withFileTypes: true }).map(entry => entry.name).join("\n")}\n`, { mode: 0o600 });
  for (const name of ["record.json", "stdout.log", "stderr.log", "native-report.json"]) {
    if (existsSync(path.join(runRoot, name))) copyFileSync(path.join(runRoot, name), path.join(evidenceRoot, name));
  }
}

function parseFixtureRun(scenario: string, fixture: string, status: number | null, stdout: string, stderr: string, markerObserved = true, markerPid?: number, markerSettled = true): FixtureRun {
  let terminal: { runId?: string } = {};
  try { terminal = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1) ?? "{}"); } catch { /* evidence keeps raw output */ }
  const runId = typeof terminal.runId === "string" ? terminal.runId : null;
  let record: Record<string, any> | null = null;
  if (runId) {
    try { record = JSON.parse(readFileSync(path.join(fixture, "work/verification-runs", runId, "record.json"), "utf8")); } catch { /* preserve unavailable record as evidence */ }
  }
  return { scenario, status, stdout, stderr, runId, record, fixture, markerObserved, markerPid, markerSettled };
}

function invokeFixture(fixture: string, scenario: MatrixScenario): FixtureRun {
  resetFixtureRuntimeFiles(fixture);
  writeFileSync(path.join(fixture, "eff04-scenario.json"), JSON.stringify(scenario) + "\n", { mode: 0o600 });
  const tsx = path.join(implementationRoot, "node_modules/.bin/tsx");
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, VITE_WISEEFF_RUNTIME_MODE: "mock" };
  delete env.NODE_OPTIONS;
  const result = spawnSync(tsx, [path.join(fixture, "scripts/verification/run.ts"), "--base", fixtureGit(fixture, ["rev-parse", "HEAD"]), "--task", "ci-changed-paths"], { cwd: fixture, env, encoding: "utf8", timeout: 20_000 });
  return parseFixtureRun(scenario.name, fixture, result.status, result.stdout ?? "", result.stderr ?? "");
}

function resetFixtureRuntimeFiles(fixture: string): void {
  const scenarioPath = path.join(fixture, "eff04-scenario.json");
  writeFileSync(path.join(fixture, "node_modules/vitest/package.json"), JSON.stringify({ name: "vitest", version: "4.1.5" }) + "\n", { mode: 0o644 });
  writeFileSync(path.join(fixture, "node_modules/vitest/vitest.mjs"), fixtureEntry(scenarioPath), { mode: 0o644 });
  writeFileSync(path.join(fixture, "phase-marker.log"), "", { mode: 0o600 });
}

async function invokeSignalledFixture(fixture: string, scenario: MatrixScenario): Promise<FixtureRun> {
  resetFixtureRuntimeFiles(fixture);
  writeFileSync(path.join(fixture, "eff04-scenario.json"), JSON.stringify(scenario) + "\n", { mode: 0o600 });
  const tsx = path.join(implementationRoot, "node_modules/.bin/tsx");
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, VITE_WISEEFF_RUNTIME_MODE: "mock" };
  delete env.NODE_OPTIONS;
  const child = spawn(tsx, [path.join(fixture, "scripts/verification/run.ts"), "--base", fixtureGit(fixture, ["rev-parse", "HEAD"]), "--task", "ci-changed-paths"], { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  let closed = false;
  const closure = new Promise<number | null>(resolve => child.once("close", code => { closed = true; resolve(code); }));
  child.once("error", error => { stderr += `${error.name}: ${error.message}\n`; });
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", chunk => { stdout += chunk; }); child.stderr?.on("data", chunk => { stderr += chunk; });
  const marker = path.join(fixture, "phase-marker.log");
  const deadline = Date.now() + 10_000;
  let markerPid: number | undefined;
  while (!closed && Date.now() < deadline) {
    if (existsSync(marker)) {
      const line = readFileSync(marker, "utf8").split(/\r?\n/u).find(value => value.startsWith(`${scenario.signalPhase}:`));
      const match = line?.match(/:pid:(\d+)$/u);
      if (match) { markerPid = Number(match[1]); break; }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const markerObserved = markerPid !== undefined;
  let ownedChildAlive = false;
  if (markerObserved && markerPid !== undefined) {
    try { process.kill(markerPid, 0); ownedChildAlive = true; } catch { /* do not signal after the owned child has exited or is uncertain */ }
  }
  if (markerObserved && ownedChildAlive && child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill(scenario.signal);
  const status = await closure;
  let markerSettled = true;
  if (markerPid !== undefined) {
    markerSettled = false;
    const expiry = Date.now() + 2_000;
    while (Date.now() < expiry) {
      try { process.kill(markerPid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { markerSettled = true; break; } }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return parseFixtureRun(scenario.name, fixture, status, stdout, stderr, markerObserved, markerPid, markerSettled);
}

function nativeOptions(directory: string, script: string, overrides: Partial<Parameters<typeof runNative>[0]> = {}) {
  return {
    argv: ["-e", script],
    env: { PATH: path.dirname(process.execPath), TMPDIR: directory, TMP: directory, TEMP: directory, VITE_WISEEFF_RUNTIME_MODE: "mock" },
    cwd: implementationRoot,
    stdoutPath: path.join(directory, "stdout.log"),
    stderrPath: path.join(directory, "stderr.log"),
    stdoutLimit: 16 * 1024 * 1024,
    deadlineAt: Date.now() + 2_000,
    ...overrides,
  };
}

class DelayedCloseWritable extends Writable {
  constructor(private readonly closeError: Error | undefined = undefined) {
    super({ autoDestroy: true });
  }
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  override _destroy(_error: Error | null, callback: (error?: Error | null) => void): void {
    setTimeout(() => callback(this.closeError), 80);
  }
}

class VeryDelayedCloseWritable extends Writable {
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  override _destroy(_error: Error | null, callback: (error?: Error | null) => void): void {
    setTimeout(() => callback(), 7_500);
  }
}

class DelayedFinalWritable extends Writable {
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  override _final(callback: (error?: Error | null) => void): void { setTimeout(() => callback(new Error("delayed final failure")), 80); }
}

class DelayedWriteWritable extends Writable {
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    setTimeout(() => callback(new Error("delayed write failure")), 80);
  }
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("fresh local verification runner", () => {
  it("accepts exactly one fixed task and a full base SHA", () => {
    expect(parseRunArgs(["--base", "a".repeat(40), "--task", TASK_IDS[0]])).toEqual({
      base: "a".repeat(40),
      task: "ci-changed-paths",
      force: false,
    });
    expect(() => parseRunArgs(["--base", "a".repeat(40), "--task", "unknown"])).toThrow("INVALID_ARGUMENTS");
    expect(() => parseRunArgs(["--base", "a".repeat(40), "--task", TASK_IDS[0], "--reuse"])).toThrow("INVALID_ARGUMENTS");
    expect(parseRunArgs(["--base", "a".repeat(40), "--task", TASK_IDS[0], "--force"]).force).toBe(true);
    expect(() => parseRunArgs(["--base", "a".repeat(40), "--base", "a".repeat(40), "--task", TASK_IDS[0]])).toThrow("DUPLICATE_ARGUMENT");
  });

  it("builds a clean child environment and preserves frontend heap argv", () => {
    const spec = taskSpec("feedback-frontend-client");
    const temp = path.join(implementationRoot, "work", "verification-runs", "temporary");
    expect(() => buildFreshChildEnvironment(spec, temp, { NODE_OPTIONS: "--require=marker" })).toThrow("HOST_STARTUP_INJECTION");
    const { env, mode } = buildFreshChildEnvironment(spec, temp, {
      PATH: "/tmp/fake-npm",
      VITE_WISEEFF_RUNTIME_MODE: " api ",
      NODE_V8_COVERAGE: "/tmp/coverage",
      npm_execpath: "/tmp/fake-npm",
      HOME: "/tmp/home",
    });
    expect(mode).toBe("api");
    expect(env.PATH).toBe(path.dirname(process.execPath) + ":/usr/bin:/bin:/usr/sbin:/sbin");
    expect(env.TMPDIR).toBe(temp);
    expect(env.NODE_V8_COVERAGE).toBeUndefined();
    expect(env.npm_execpath).toBeUndefined();
    const argv = buildFreshArgv(spec, "execution", ["/repo/a.test.ts"], "/repo/node_modules/vitest/vitest.mjs", "/repo/native-report.json");
    expect(argv.slice(0, 2)).toEqual(["--max-old-space-size=768", "/repo/node_modules/vitest/vitest.mjs"]);
  });

  it("refuses a foreign-root CLI before touching a fixed-entry marker", () => {
    const foreign = mkdtempSync(path.join(implementationRoot, "work", "verification-runs", "eff04-foreign-"));
    const marker = path.join(foreign, "marker");
    writeFileSync(marker, "untouched", { mode: 0o600 });
    const cli = path.join(implementationRoot, "node_modules/.bin/tsx");
    const result = spawnSync(cli, [path.join(implementationRoot, "scripts/verification/run.ts"), "--base", "a".repeat(40), "--task", TASK_IDS[0]], {
      cwd: foreign,
      env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: foreign },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("NON_ROOT_CWD");
    expect(readFileSync(marker, "utf8")).toBe("untouched");
    rmSync(foreign, { recursive: true, force: true });
  });

  it("keeps both bounded native phase logs and settles cancellation", async () => {
    const directory = fixtureDirectory();
    const first = await runNative(nativeOptions(directory, "process.stdout.write('discovery\\n')"));
    const second = await runNative(nativeOptions(directory, "process.stdout.write('execution\\n')", {
      stdoutExistingBytes: readFileSync(path.join(directory, "stdout.log")).byteLength,
      stderrExistingBytes: readFileSync(path.join(directory, "stderr.log")).byteLength,
    }));
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(readFileSync(path.join(directory, "stdout.log"), "utf8")).toBe("discovery\nexecution\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("cancelled by test")), 30);
    const cancelled = await runNative(nativeOptions(directory, "setInterval(() => {}, 1000)", { cancelSignal: controller.signal }));
    clearTimeout(timer);
    expect(cancelled.error).toBe("CHILD_FAILED");
    expect(cancelled.phase.lifecycleSettled).toBe(true);
  });

  it("bounds output and does not signal an owner whose identity is unavailable", async () => {
    const directory = fixtureDirectory();
    const noisy = await runNative(nativeOptions(directory, "process.stdout.write('x'.repeat(1024 * 1024))", { stdoutLimit: 128 }));
    expect(noisy.error).not.toBeNull();
    expect(readFileSync(path.join(directory, "stdout.log")).byteLength).toBeLessThanOrEqual(128);
    const unknown = await runNative(nativeOptions(directory, "setTimeout(() => process.exit(0), 50)", {
      readProcessIdentity: () => undefined,
    }));
    expect(unknown.error).toBe("CHILD_IDENTITY_UNAVAILABLE");
    expect(unknown.phase.lifecycleSettled).toBe(false);
  });

  it("passes only the rebuilt environment to an actual child and rejects unknown mode", async () => {
    const directory = fixtureDirectory();
    const spec = taskSpec("feedback-frontend-client");
    const { env } = buildFreshChildEnvironment(spec, directory, {
      PATH: "/foreign/bin",
      npm_execpath: "/foreign/npm",
      VITE_WISEEFF_RUNTIME_MODE: "mock",
      NODE_V8_COVERAGE: "/foreign/coverage",
    });
    expect(() => buildFreshChildEnvironment(spec, directory, { VITE_WISEEFF_RUNTIME_MODE: "unknown" })).toThrow("UNKNOWN_RUNTIME_MODE");
    const marker = path.join(directory, "env-marker.json");
    const child = await runNative(nativeOptions(directory, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({path: process.env.PATH, npm: process.env.npm_execpath, coverage: process.env.NODE_V8_COVERAGE, mode: process.env.VITE_WISEEFF_RUNTIME_MODE}))`, { env }));
    expect(child.error).toBeNull();
    expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({ path: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, mode: "mock" });
  });

  it("turns native log write and close errors into a failed phase", async () => {
    const directory = fixtureDirectory();
    const writeFailure = await runNative(nativeOptions(directory, "process.stdout.write('write')", {
      openLog: () => new Writable({ write: (_chunk, _encoding, callback) => callback(new Error("log write failed")) }),
    }));
    expect(writeFailure.error).not.toBeNull();

    const closeFailure = await runNative(nativeOptions(directory, "process.stdout.write('close')", {
      openLog: () => new Writable({ write: (_chunk, _encoding, callback) => callback(), final: (callback) => callback(new Error("log close failed")) }),
    }));
    expect(closeFailure.error).not.toBeNull();

    const delayedFinal = await runNative(nativeOptions(directory, "process.stdout.write('final')", {
      openLog: () => new DelayedFinalWritable(),
    }));
    expect(delayedFinal.error).not.toBeNull();

    const delayedWrite = await runNative(nativeOptions(directory, "process.stdout.write('async')", {
      openLog: () => new DelayedWriteWritable(),
    }));
    expect(delayedWrite.error).not.toBeNull();
  });

  it("uses the real TERM handler during owned cleanup", async () => {
    const directory = fixtureDirectory();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("cancelled by test")), 30);
    const result = await runNative(nativeOptions(directory, "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 40)); setInterval(() => {}, 1000)", { cancelSignal: controller.signal }));
    clearTimeout(timer);
    expect(result.error).toBe("CHILD_FAILED");
    expect(result.lifecycleSettled).toBe(true);
  });

  it("kills a finite TERM-ignoring child and proves the owned group is absent", async () => {
    const directory = fixtureDirectory();
    const signals: NodeJS.Signals[] = [];
    const originalKill = process.kill.bind(process);
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid < 0 && signal !== undefined && signal !== 0) signals.push(signal as NodeJS.Signals);
      return originalKill(pid, signal as number | NodeJS.Signals | undefined);
    }) as typeof process.kill);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("cancelled by test")), 30);
    try {
      const result = await runNative(nativeOptions(directory, "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 4000); setInterval(() => {}, 1000)", { cancelSignal: controller.signal }));
      clearTimeout(timer);
      expect(result.error).toBe("CHILD_FAILED");
      expect(result.lifecycleSettled).toBe(true);
      expect(signals).toContain("SIGTERM");
      expect(signals).toContain("SIGKILL");
    } finally {
      clearTimeout(timer);
      kill.mockRestore();
    }
  });

  it("settles an asynchronous spawn error and observes the finite child close", async () => {
    const directory = fixtureDirectory();
    const spawnMock = childProcess.spawn as unknown as { getMockImplementation: () => typeof spawn; mockImplementation: (implementation: typeof spawn) => void };
    const originalSpawn = spawnMock.getMockImplementation()!;
    const fake = new EventEmitter() as EventEmitter & { pid?: number; stdout?: undefined; stderr?: undefined; exitCode: number | null; signalCode: NodeJS.Signals | null; unref: () => void };
    fake.exitCode = null;
    fake.signalCode = null;
    fake.unref = () => undefined;
    spawnMock.mockImplementation((() => {
      process.nextTick(() => { fake.emit("error", new Error("async spawn failure")); fake.emit("close", null, null); });
      return fake;
    }) as typeof spawn);
    try {
      const result = await runNative(nativeOptions(directory, "process.exit(0)"));
      expect(result.error).not.toBeNull();
      expect(result.lifecycleSettled).toBe(true);
    } finally { spawnMock.mockImplementation(originalSpawn); }
  });

  it("keeps EPERM and unknown ownership incomplete without signaling", async () => {
    const directory = fixtureDirectory();
    let ownedPid: number | undefined;
    const calls: Array<{ pid: number; signal: number | NodeJS.Signals | undefined }> = [];
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      calls.push({ pid, signal });
      if (ownedPid !== undefined && pid === -ownedPid && signal === 0) {
        const error = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        throw error;
      }
      return true;
    }) as typeof process.kill);
    try {
      const eperm = await runNative(nativeOptions(directory, "setTimeout(() => process.exit(0), 50)", {
        readProcessIdentity: pid => { ownedPid ??= pid; return { startToken: "owned", commandSha256: "owned" }; },
      }));
      expect(eperm.lifecycleSettled).toBe(false);
      expect(calls.filter(call => call.pid === -ownedPid && call.signal !== 0)).toHaveLength(0);
    } finally { kill.mockRestore(); }

    const unknownCalls: Array<{ pid: number; signal: number | NodeJS.Signals | undefined }> = [];
    const unknownKill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      unknownCalls.push({ pid, signal });
      return true;
    }) as typeof process.kill);
    try {
      const unknown = await runNative(nativeOptions(directory, "setTimeout(() => process.exit(0), 50)", { readProcessIdentity: () => undefined }));
      expect(unknown.error).toBe("CHILD_IDENTITY_UNAVAILABLE");
      expect(unknownCalls.filter(call => call.signal !== 0)).toHaveLength(0);
    } finally { unknownKill.mockRestore(); }
  });

  it("waits for an exited leader's held pipes and keeps timeout failure sticky", async () => {
    const directory = fixtureDirectory();
    const leaderGone = path.join(directory, "leader-gone");
    const started = Date.now();
    const survivor = await runNative(nativeOptions(directory, `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(leaderGone)}, 'gone'),120)`) }],{stdio:['ignore','inherit','inherit']}); process.stdout.write('leader');`));
    expect(survivor.error).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
    expect(readFileSync(leaderGone, "utf8")).toBe("gone");

    const timedOut = await runNative(nativeOptions(directory, "setInterval(() => {}, 1000)", {
      deadlineAt: Date.now() + 30,
      stdoutExistingBytes: readFileSync(path.join(directory, "stdout.log")).byteLength,
      stderrExistingBytes: readFileSync(path.join(directory, "stderr.log")).byteLength,
      openLog: () => new DelayedCloseWritable(),
    }));
    expect(timedOut.error).toContain("NATIVE_TIMEOUT");
    expect(timedOut.phase.lifecycleSettled).toBe(true);
  });

  it("does not signal a child after its ownership identity changes", async () => {
    const directory = fixtureDirectory();
    let identityReads = 0;
    const marker = path.join(directory, "natural-completion");
    const changed = await runNative(nativeOptions(directory, `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 120)`, {
      cancelSignal: (() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("changed owner")), 20);
        return controller.signal;
      })(),
      readProcessIdentity: () => identityReads++ === 0 ? { startToken: "initial", commandSha256: "initial" } : undefined,
    }));
    expect(changed.error).toContain("CHILD_FAILED");
    expect(existsSync(marker)).toBe(true);
  });

  it("parses actual discovery output, rejects duplicate or missing files, and preserves nonzero exit", async () => {
    const directory = fixtureDirectory();
    const file = path.join(implementationRoot, "scripts/ci-changed-paths.test.ts");
    const output = await runNative(nativeOptions(directory, `process.stdout.write(${JSON.stringify(JSON.stringify([{ file }]))})`));
    expect(output.error).toBeNull();
    expect(parseDiscovery(output.stdout, [file])).toEqual([file]);
    expect(() => parseDiscovery(JSON.stringify([{ file }, { file }]), [file])).toThrow("DISCOVERY_FILES");
    expect(() => parseDiscovery(JSON.stringify([]), [file])).toThrow("DISCOVERY_EMPTY");
    const failed = await runNative(nativeOptions(directory, "process.stdout.write('{\"testResults\":[]}'); process.exit(7)", {
      stdoutExistingBytes: readFileSync(path.join(directory, "stdout.log")).byteLength,
      stderrExistingBytes: readFileSync(path.join(directory, "stderr.log")).byteLength,
    }));
    expect(failed.phase.exitCode).toBe(7);
    expect(failed.phase.lifecycleSettled).toBe(true);
  });

  it("waits for actual destination close and retains late stderr failure", async () => {
    const directory = fixtureDirectory();
    const started = Date.now();
    const clean = await runNative(nativeOptions(directory, "process.stdout.write('delayed close')", {
      openLog: () => new DelayedCloseWritable(),
    }));
    expect(clean.error).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);

    const lateFailure = await runNative(nativeOptions(directory, "process.stdout.write('stdout done')", {
      openLog: (file) => file.endsWith("stderr.log") ? new DelayedCloseWritable(new Error("late stderr close")) : new DelayedCloseWritable(),
      stdoutExistingBytes: readFileSync(path.join(directory, "stdout.log")).byteLength,
      stderrExistingBytes: readFileSync(path.join(directory, "stderr.log")).byteLength,
    }));
    expect(lateFailure.error).not.toBeNull();
  });

  it("refuses unsafe ancestors and preserves a replacement lock", () => {
    const directory = fixtureDirectory();
    const link = path.join(directory, "link");
    symlinkSync(directory, link);
    expect(() => ensurePathAncestors(implementationRoot, path.join(link, "stdout.log"))).toThrow("SYMLINK_PATH");

    const lockPath = path.join(directory, "lock");
    const lockFd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    const original = fstatSync(lockFd);
    unlinkSync(lockPath);
    writeFileSync(lockPath, "replacement", { mode: 0o600 });
    expect(disposeOwnedLock(lockPath, lockFd, original, "")).toBe(false);
    expect(readFileSync(lockPath, "utf8")).toBe("replacement");
  });

  it("never overwrites an existing final record during publication", () => {
    const directory = fixtureDirectory();
    const finalPath = path.join(directory, "record.json");
    writeFileSync(finalPath, "foreign-record", { mode: 0o600 });
    expect(() => writeAtomicRecord(directory, { marker: "candidate" })).toThrow();
    expect(readFileSync(finalPath, "utf8")).toBe("foreign-record");
  });

  it("publishes an ordinary first record with one final link", () => {
    const directory = fixtureDirectory();
    writeAtomicRecord(directory, { marker: "candidate" } as never);
    const finalPath = path.join(directory, "record.json");
    expect(JSON.parse(readFileSync(finalPath, "utf8"))).toEqual({ marker: "candidate" });
    expect(lstatSync(finalPath).nlink).toBe(1);
    expect(existsSync(path.join(directory, `record.json.${process.pid}.tmp`))).toBe(false);
  });

  it("preserves foreign bytes when the temporary record is replaced before linking", () => {
    const directory = fixtureDirectory();
    const temporary = path.join(directory, `record.json.${process.pid}.tmp`);
    const moved = `${temporary}.original`;
    const final = path.join(directory, "record.json");
    const lstatMock = fs.lstatSync as unknown as { getMockImplementation: () => typeof fs.lstatSync; mockImplementation: (implementation: typeof fs.lstatSync) => void };
    const originalLstat = lstatMock.getMockImplementation()!;
    let replaced = false;
    lstatMock.mockImplementation(((file: string) => {
      const stat = originalLstat(file);
      if (!replaced && file === temporary && stat.nlink === 1) {
        replaced = true;
        renameSync(temporary, moved);
        writeFileSync(temporary, "foreign-before-link\n", { mode: 0o600 });
      }
      return stat;
    }) as typeof fs.lstatSync);
    try {
      expect(() => writeAtomicRecord(directory, { marker: "candidate" } as never)).toThrow("RECORD_PUBLICATION");
      expect(readFileSync(temporary, "utf8")).toBe("foreign-before-link\n");
      expect(readFileSync(final, "utf8")).toBe("foreign-before-link\n");
    } finally {
      lstatMock.mockImplementation(originalLstat);
      rmSync(moved, { force: true });
      rmSync(temporary, { force: true });
      rmSync(final, { force: true });
    }
  });

  it("preserves a temporary replacement immediately before publication disposal", () => {
    const directory = fixtureDirectory();
    const temporary = path.join(directory, `record.json.${process.pid}.tmp`);
    const moved = `${temporary}.original`;
    let replaced = false;
    const lstatMock = fs.lstatSync as unknown as { getMockImplementation: () => typeof fs.lstatSync; mockImplementation: (implementation: typeof fs.lstatSync) => void };
    const originalLstat = lstatMock.getMockImplementation()!;
    lstatMock.mockImplementation(((file: string) => {
      const stat = originalLstat(file);
      if (!replaced && file === temporary && stat.nlink === 2) {
        replaced = true;
        renameSync(temporary, moved);
        writeFileSync(temporary, "foreign-before-unlink\n", { mode: 0o600 });
      }
      return stat;
    }) as typeof fs.lstatSync);
    try {
      expect(() => writeAtomicRecord(directory, { marker: "candidate" } as never)).toThrow("RECORD_PUBLICATION");
      expect(readFileSync(temporary, "utf8")).toBe("foreign-before-unlink\n");
    } finally {
      lstatMock.mockImplementation(originalLstat);
      rmSync(moved, { force: true });
      rmSync(temporary, { force: true });
      rmSync(path.join(directory, "record.json"), { force: true });
    }
  });

  it("settles the first destination after the second open fails", async () => {
    const directory = fixtureDirectory();
    const destination = new DelayedCloseWritable(new Error("late setup close"));
    destination.on("error", () => undefined); // Keep the finite rejected-baseline callback observed.
    let opens = 0;
    const result = await runNative(nativeOptions(directory, "process.exit(0)", {
      openLog: () => { if (opens++ === 0) return destination; throw new Error("second open failed"); },
    })).catch(error => ({ error }));
    // Await the finite callback even on the rejected baseline before reporting Red.
    const closedAtReturn = destination.closed;
    await new Promise<void>(resolve => destination.closed ? resolve() : destination.once("close", resolve));
    expect(closedAtReturn).toBe(true);
    expect(result.error).not.toBeNull();
  });

  it("keeps the shared activity deadline through a healthy slow close", async () => {
    const directory = fixtureDirectory();
    const result = await runNative(nativeOptions(directory, "process.stdout.write('healthy')", {
      deadlineAt: Date.now() + 5_000,
      openLog: () => new Writable({
        write: (_chunk, _encoding, callback) => callback(),
        destroy: (_error, callback) => setTimeout(() => callback(), 1_300),
      }),
    }));
    expect(result.error).toBeNull();
    expect(result.lifecycleSettled).toBe(true);
  });

  it("uses one cleanup window and observes a finite late close", async () => {
    const directory = fixtureDirectory();
    const destinations: VeryDelayedCloseWritable[] = [];
    const started = Date.now();
    const result = await runNative(nativeOptions(directory, "setInterval(() => {}, 1000)", {
      deadlineAt: Date.now() + 30,
      openLog: () => { const stream = new VeryDelayedCloseWritable(); destinations.push(stream); return stream; },
    }));
    const returnedAt = Date.now();
    await Promise.all(destinations.map(stream => stream.closed ? Promise.resolve() : new Promise<void>(resolve => stream.once("close", resolve))));
    expect(result.error).toContain("NATIVE_TIMEOUT");
    expect(result.lifecycleSettled).toBe(false);
    expect(returnedAt - started).toBeGreaterThanOrEqual(5_500);
    expect(returnedAt - started).toBeLessThan(7_000);
    expect(destinations.every(stream => stream.closed)).toBe(true);
  }, 20_000);

  it("runs the composed finite matrix in one private module-relative Git fixture", async () => {
    const fixture = createMatrixFixture();
    fixtureDirectories.push(fixture.root);
    const evidenceParent = path.join(testRunsDirectory(), "eff04-parent-correction");
    if (!existsSync(evidenceParent)) mkdirSync(evidenceParent, { mode: 0o700 });
    const evidenceStat = lstatSync(evidenceParent);
    const evidenceUid = process.getuid?.();
    if (!evidenceStat.isDirectory() || evidenceStat.isSymbolicLink() || (evidenceUid !== undefined && evidenceStat.uid !== evidenceUid)
      || ![0o700, 0o755].includes(evidenceStat.mode & 0o777)) throw new Error("UNSAFE_TEST_EVIDENCE_DIRECTORY");
    const invocationRoot = mkdtempSync(path.join(evidenceParent, "matrix-invocation-"));
    chmodSync(invocationRoot, 0o700);
    const scenarios: Array<MatrixScenario & { complete: boolean; error?: string }> = [
      { name: "happy-control", report: "valid", complete: true },
      { name: "discovery-zero", discovery: "zero", complete: false, error: "DISCOVERY_EMPTY" },
      { name: "native-zero", report: "zero", complete: true, error: "CHILD_FAILED" },
      { name: "all-skipped", report: "allskip", complete: true, error: "CHILD_FAILED" },
      { name: "stale-report", report: "stale", complete: true, error: "CHILD_FAILED" },
      { name: "empty-report", report: "empty", complete: false, error: "NATIVE_REPORT_UNAVAILABLE" },
      { name: "missing-report", report: "missing", complete: false, error: "NATIVE_REPORT_UNAVAILABLE" },
      { name: "nonzero-plausible-green", report: "valid", exitCode: 7, complete: true, error: "NATIVE_CHILD_FAILED" },
      { name: "malformed-nonzero", report: "malformed", exitCode: 7, complete: true, error: "NATIVE_CHILD_FAILED" },
      { name: "success-metadata-drift", report: "valid", drift: "metadata", complete: false, error: "SOURCE_DRIFT" },
      { name: "success-entry-drift", report: "valid", drift: "entry", complete: false, error: "SOURCE_DRIFT" },
      { name: "failure-metadata-drift", report: "valid", exitCode: 7, drift: "metadata", complete: false, error: "NATIVE_CHILD_FAILED" },
      { name: "failure-entry-drift", report: "valid", exitCode: 7, drift: "entry", complete: false, error: "NATIVE_CHILD_FAILED" },
      { name: "sigint-discovery", report: "valid", signalPhase: "discovery", signal: "SIGINT", complete: false, error: "OWNER_CANCELLED" },
      { name: "sigterm-discovery", report: "valid", signalPhase: "discovery", signal: "SIGTERM", complete: false, error: "OWNER_CANCELLED" },
      { name: "sigint-execution", report: "valid", signalPhase: "execution", signal: "SIGINT", complete: false, error: "OWNER_CANCELLED" },
      { name: "sigterm-execution", report: "valid", signalPhase: "execution", signal: "SIGTERM", complete: false, error: "OWNER_CANCELLED" },
    ];
    const failures: string[] = [];
    try {
      for (const scenario of scenarios) {
        const result = scenario.signalPhase ? await invokeSignalledFixture(fixture.root, scenario) : invokeFixture(fixture.root, scenario);
        copyFixtureEvidence(result, fixture.sourceHashes, invocationRoot);
        const record = result.record;
        if (!record) { failures.push(`${scenario.name}:missing-record`); continue; }
        if (record.complete !== scenario.complete) failures.push(`${scenario.name}:complete=${String(record.complete)}`);
        if (scenario.error && record.error !== scenario.error) failures.push(`${scenario.name}:error=${String(record.error)}`);
        if (record.root !== fixture.root) failures.push(`${scenario.name}:root`);
        if (scenario.name === "happy-control" && (record.claimedStatus !== "passed" || record.native.passed !== 1)) failures.push(`${scenario.name}:native`);
        if (["native-zero", "all-skipped", "stale-report"].includes(scenario.name)
          && (record.claimedStatus !== "failed" || result.status !== 1 || record.native.passed !== 0)) failures.push(`${scenario.name}:stable-failure-status`);
        if (scenario.name === "nonzero-plausible-green" && (record.execution?.exitCode !== 7 || record.native.reportSha256 === null)) failures.push(`${scenario.name}:failure-dominance`);
        if (scenario.name === "malformed-nonzero" && (record.execution?.exitCode !== 7 || record.native.reportSha256 === null)) failures.push(`${scenario.name}:malformed-dominance`);
        if (scenario.signalPhase && (!result.markerObserved || result.markerPid === undefined || result.markerSettled !== true)) failures.push(`${scenario.name}:handshake-lifecycle`);
        const lock = path.join(fixture.root, "work/verification-runs/ci-changed-paths.lock");
        if (existsSync(lock)) failures.push(`${scenario.name}:lock-retained`);
      }
    } finally {
      fixtureDirectories.splice(fixtureDirectories.indexOf(fixture.root), 1);
      rmSync(fixture.root, { recursive: true, force: true });
    }
    expect(failures).toEqual([]);
  }, 90_000);

  it("renders only bounded registered terminal fields", () => {
    const result: TerminalResult = {
      version: 1,
      scope: "fresh-local-feedback",
      runId: "00000000-0000-4000-8000-000000000000",
      taskId: "ci-changed-paths",
      status: "passed",
      error: null,
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      nativeFiles: 1,
      nativePassed: 8,
      nativeSkipped: 0,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      wallMs: 1,
      exitCode: 0,
      signal: null,
      memo: "disabled",
      acceptancePending: true,
      tokenUsage: null,
    };
    const output = JSON.parse(renderTerminal(result));
    expect(output).toEqual(result);
    expect(output).not.toHaveProperty("stdout");
    expect(Buffer.byteLength(renderTerminal(result))).toBeLessThanOrEqual(4 * 1024);
  });
});
