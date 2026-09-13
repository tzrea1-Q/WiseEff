import { existsSync, fstatSync, mkdtempSync, openSync, constants as fsConstants, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

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
  const directory = mkdtempSync(path.join(implementationRoot, "work", "verification-runs", "eff04-test-"));
  fixtureDirectories.push(directory);
  writeFileSync(path.join(directory, "stdout.log"), "", { mode: 0o600 });
  writeFileSync(path.join(directory, "stderr.log"), "", { mode: 0o600 });
  return directory;
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

class DelayedFinalWritable extends Writable {
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  override _final(callback: (error?: Error | null) => void): void { setTimeout(() => callback(new Error("delayed final failure")), 80); }
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
  });

  it("waits for an exited leader's held pipes and keeps timeout failure sticky", async () => {
    const directory = fixtureDirectory();
    const started = Date.now();
    const survivor = await runNative(nativeOptions(directory, "const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setTimeout(()=>{},120)'],{stdio:['ignore','inherit','inherit']}); process.stdout.write('leader');"));
    expect(survivor.error).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);

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
