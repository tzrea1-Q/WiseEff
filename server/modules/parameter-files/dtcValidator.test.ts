import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStubDtcValidator,
  createSubprocessDtcValidator,
  readDtsValidationMode
} from "./dtcValidator";

type FakeChild = ChildProcess & {
  stdoutEmitter: EventEmitter;
  stderrEmitter: EventEmitter;
};

function createFakeChild(): FakeChild {
  const proc = new EventEmitter() as unknown as FakeChild;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  proc.stdoutEmitter = stdoutEmitter;
  proc.stderrEmitter = stderrEmitter;
  (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
  (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;
  (proc as unknown as { kill: (signal?: string) => void }).kill = vi.fn(() => {
    proc.emit("close", null);
  });
  return proc;
}

function fakeSpawnThatSucceeds(stderr = "", exitCode = 0): typeof nodeSpawn {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const spawnFn = ((command: string, args: readonly string[] = [], options?: unknown) => {
    calls.push({ command, args: [...args], options });
    const proc = createFakeChild();
    setImmediate(() => {
      if (stderr) {
        proc.stderrEmitter.emit("data", Buffer.from(stderr));
      }
      proc.emit("close", exitCode);
    });
    return proc;
  }) as unknown as typeof nodeSpawn;
  (spawnFn as unknown as { calls: typeof calls }).calls = calls;
  return spawnFn;
}

function fakeSpawnThatErrors(code = "ENOENT"): typeof nodeSpawn {
  return ((_command: string, _args: readonly string[] = [], _options?: unknown) => {
    const proc = createFakeChild();
    setImmediate(() => {
      const err = new Error(`spawn dtc ${code}`) as NodeJS.ErrnoException;
      err.code = code;
      proc.emit("error", err);
    });
    return proc;
  }) as unknown as typeof nodeSpawn;
}

function fakeSpawnThatHangs(): typeof nodeSpawn {
  return ((_command: string, _args: readonly string[] = [], _options?: unknown) => {
    return createFakeChild();
  }) as unknown as typeof nodeSpawn;
}

const tmpDirsCreated: string[] = [];
function trackingTmpDirFactory(): string {
  const dir = mkdtempSync(join(tmpdir(), "dtc-validate-test-"));
  tmpDirsCreated.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirsCreated.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("readDtsValidationMode", () => {
  it("defaults to block when the env var is unset", () => {
    expect(readDtsValidationMode({})).toBe("block");
  });

  it("reads warn and off from DTS_VALIDATION_MODE", () => {
    expect(readDtsValidationMode({ DTS_VALIDATION_MODE: "warn" })).toBe("warn");
    expect(readDtsValidationMode({ DTS_VALIDATION_MODE: "off" })).toBe("off");
    expect(readDtsValidationMode({ DTS_VALIDATION_MODE: "block" })).toBe("block");
  });

  it("falls back to block for an unrecognized value", () => {
    expect(readDtsValidationMode({ DTS_VALIDATION_MODE: "nonsense" })).toBe("block");
  });
});

describe("createStubDtcValidator", () => {
  it("delegates to the injected handler and returns its result", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics: [{ file: "a.dts", line: 3, severity: "error", message: "boom" }]
    }));

    const result = await validator.validate([{ name: "a.dts", content: "/dts-v1/; / { };" }]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([{ file: "a.dts", line: 3, severity: "error", message: "boom" }]);
  });

  it("supports an async handler", async () => {
    const validator = createStubDtcValidator(async () => ({
      ok: true,
      mode: "warn",
      compiler: "unavailable",
      diagnostics: []
    }));

    const result = await validator.validate([]);
    expect(result).toEqual({ ok: true, mode: "warn", compiler: "unavailable", diagnostics: [] });
  });
});

describe("createSubprocessDtcValidator - diagnostic mapping", () => {
  it("maps dtc stderr error lines to diagnostics with file/line/severity/message", async () => {
    const stderr = "board.dts:12: error: unexpected token\n";
    const spawnFn = fakeSpawnThatSucceeds(stderr, 1);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "board.dts", content: "/dts-v1/; / { };" }], { mode: "block" });

    expect(result.compiler).toBe("dtc");
    expect(result.diagnostics).toEqual([{ file: "board.dts", line: 12, severity: "error", message: "unexpected token" }]);
    expect(result.ok).toBe(false);
  });

  it("maps dtc stderr warning lines (including real dtc check-name format) to warning diagnostics", async () => {
    const stderr = "board.dts:5.10-15: Warning (unit_address_vs_reg): node has a unit name, but no reg property\n";
    const spawnFn = fakeSpawnThatSucceeds(stderr, 0);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "board.dts", content: "/dts-v1/; / { };" }], { mode: "block" });

    expect(result.diagnostics).toEqual([
      {
        file: "board.dts",
        line: 5,
        severity: "warning",
        message: "node has a unit name, but no reg property"
      }
    ]);
    expect(result.ok).toBe(true);
  });

  it("mode=block fails when any diagnostic is an error", async () => {
    const stderr = "a.dts:1: error: bad token\nb.dts:2: warning: minor issue\n";
    const spawnFn = fakeSpawnThatSucceeds(stderr, 1);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "block" });
    expect(result.ok).toBe(false);
  });

  it("mode=warn passes even when dtc reports errors", async () => {
    const stderr = "a.dts:1: error: bad token\n";
    const spawnFn = fakeSpawnThatSucceeds(stderr, 1);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "warn" });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("createSubprocessDtcValidator - compiler unavailable degrade", () => {
  it("mode=block + unavailable compiler -> ok:false (needs human confirmation)", async () => {
    const validator = createSubprocessDtcValidator({
      spawnFn: fakeSpawnThatErrors(),
      whichDtc: async () => null,
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "block" });

    expect(result.ok).toBe(false);
    expect(result.compiler).toBe("unavailable");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("mode=warn + unavailable compiler -> ok:true, marked unvalidated", async () => {
    const validator = createSubprocessDtcValidator({
      spawnFn: fakeSpawnThatErrors(),
      whichDtc: async () => null,
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "warn" });

    expect(result.ok).toBe(true);
    expect(result.compiler).toBe("unavailable");
    expect(result.diagnostics.some((d) => /unavailable/i.test(d.message))).toBe(true);
  });

  it("mode=off -> ok:true and passes directly regardless of compiler availability", async () => {
    const whichDtc = vi.fn(async () => "dtc");
    const spawnFn = fakeSpawnThatSucceeds("a.dts:1: error: should not run", 1);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc,
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "off" });

    expect(result.ok).toBe(true);
    expect(result.compiler).toBe("unavailable");
    expect(whichDtc).not.toHaveBeenCalled();
    expect((spawnFn as unknown as { calls?: unknown[] }).calls ?? []).toHaveLength(0);
  });

  it("uses DTS_VALIDATION_MODE from the environment when opts.mode is not provided", async () => {
    const validator = createSubprocessDtcValidator({
      spawnFn: fakeSpawnThatErrors(),
      whichDtc: async () => null,
      tmpDirFactory: trackingTmpDirFactory
    });

    vi.stubEnv("DTS_VALIDATION_MODE", "warn");
    const result = await validator.validate([{ name: "a.dts", content: "x" }]);

    expect(result.mode).toBe("warn");
    expect(result.ok).toBe(true);
  });
});

describe("createSubprocessDtcValidator - restricted subprocess execution", () => {
  it("writes files into an isolated tmp dir and cleans it up afterwards", async () => {
    let capturedTmpDir = "";
    const spawnFn = ((command: string, args: readonly string[] = [], options?: { cwd?: string }) => {
      capturedTmpDir = options?.cwd ?? "";
      expect(existsSync(join(capturedTmpDir, "board.dts"))).toBe(true);
      expect(readFileSync(join(capturedTmpDir, "board.dts"), "utf8")).toBe("/dts-v1/; / { };");
      const proc = createFakeChild();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    }) as unknown as typeof nodeSpawn;

    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    await validator.validate([{ name: "board.dts", content: "/dts-v1/; / { };" }], { mode: "block" });

    expect(capturedTmpDir).not.toBe("");
    expect(existsSync(capturedTmpDir)).toBe(false);
  });

  it("passes a minimal env (PATH only) to the child process, stripping other vars", async () => {
    vi.stubEnv("SUPER_SECRET_TOKEN", "leak-me-not");
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const spawnFn = ((command: string, args: readonly string[] = [], options?: { env?: NodeJS.ProcessEnv }) => {
      capturedEnv = options?.env;
      const proc = createFakeChild();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    }) as unknown as typeof nodeSpawn;

    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    await validator.validate([{ name: "a.dts", content: "x" }], { mode: "block" });

    expect(capturedEnv).toBeDefined();
    expect(capturedEnv?.SUPER_SECRET_TOKEN).toBeUndefined();
  });

  it("kills the child process and reports an error diagnostic when it exceeds the timeout", async () => {
    const spawnFn = fakeSpawnThatHangs();
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "block", timeoutMs: 20 });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => /timed out/i.test(d.message))).toBe(true);
  });

  it("cleans up the tmp dir even when the child process errors", async () => {
    const validator = createSubprocessDtcValidator({
      spawnFn: fakeSpawnThatErrors("EACCES"),
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    const result = await validator.validate([{ name: "a.dts", content: "x" }], { mode: "block" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const dir of tmpDirsCreated) {
      expect(existsSync(dir)).toBe(false);
    }
  });
});

describe("createSubprocessDtcValidator - overlay detection", () => {
  it("passes -@ when the file name ends with .dtso", async () => {
    const spawnFn = fakeSpawnThatSucceeds("", 0);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    await validator.validate([{ name: "overlay.dtso", content: "/dts-v1/; / { };" }], { mode: "block" });

    const calls = (spawnFn as unknown as { calls: Array<{ args: string[] }> }).calls;
    expect(calls[0].args).toContain("-@");
  });

  it("passes -@ when the file content declares /plugin/", async () => {
    const spawnFn = fakeSpawnThatSucceeds("", 0);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    await validator.validate([{ name: "overlay.dts", content: "/dts-v1/;\n/plugin/;\n/ { };" }], { mode: "block" });

    const calls = (spawnFn as unknown as { calls: Array<{ args: string[] }> }).calls;
    expect(calls[0].args).toContain("-@");
  });

  it("does not pass -@ for a plain base dts file", async () => {
    const spawnFn = fakeSpawnThatSucceeds("", 0);
    const validator = createSubprocessDtcValidator({
      spawnFn,
      whichDtc: async () => "dtc",
      tmpDirFactory: trackingTmpDirFactory
    });

    await validator.validate([{ name: "board.dts", content: "/dts-v1/; / { };" }], { mode: "block" });

    const calls = (spawnFn as unknown as { calls: Array<{ args: string[] }> }).calls;
    expect(calls[0].args).not.toContain("-@");
  });
});
