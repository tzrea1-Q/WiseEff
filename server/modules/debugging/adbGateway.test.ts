import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAdbCommandRunner } from "@wiseeff/device-command-core/adbRunner";
import { createAdbDebugDeviceGateway, type AdbCommandRunner } from "./adbGateway";
import { compareDebugValues, resolveDebugValueMetadata } from "./valueCodec";
import { DEBUG_NORMALIZATION_MODE_JSON_CANONICAL, DEBUG_VALUE_FORMAT_JSON, DEBUG_VALUE_KIND_COMPLEX } from "./types";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn()
  };
});

function makeRunner(results: Awaited<ReturnType<AdbCommandRunner>>[]) {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const runCommand: AdbCommandRunner = vi.fn(async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs });
    const result = results.shift();
    if (!result) {
      throw new Error("Unexpected ADB command");
    }
    return result;
  });

  return { calls, runCommand };
}

describe("ADB debug device gateway", () => {
  it("starts adb commands without an open stdin pipe so shell reads can exit on hardware", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(child as never);

    const runnerPromise = createAdbCommandRunner({ spawnImpl: spawn })(["devices"], { timeoutMs: 1000 });
    child.stdout.emit("data", "List of devices attached\n");
    child.emit("close", 0);

    await expect(runnerPromise).resolves.toMatchObject({ code: 0 });
    expect(spawn).toHaveBeenCalledWith("adb", ["devices"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  it("rejects ADB target detection without a requested deviceId", async () => {
    const { runCommand } = makeRunner([]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.detectTargets({ projectId: "aurora" })).resolves.toEqual({
      ok: false,
      targets: [],
      error: "ADB target detection requires deviceId so detected targets can be persisted against a known debugging device."
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("parses adb devices output into gateway targets", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "List of devices attached\nemulator-5554\tdevice\nunauth\tunauthorized\n\n",
        stderr: "",
        durationMs: 10
      }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.detectTargets({ projectId: "aurora", deviceId: "device-1" })).resolves.toEqual({
      ok: true,
      targets: [
        {
          id: "adb:emulator-5554",
          deviceId: "device-1",
          targetRef: "emulator-5554",
          label: "ADB target emulator-5554",
          online: true,
          protocol: "adb"
        }
      ]
    });
  });

  it("normalizes ADB target detection failures", async () => {
    const { runCommand } = makeRunner([{ code: 1, stdout: "", stderr: "adb server unavailable", durationMs: 11 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.detectTargets({ projectId: "aurora", deviceId: "device-1" })).resolves.toEqual({
      ok: false,
      targets: [],
      error: "ADB command failed: adb server unavailable"
    });
  });

  it("constructs argv-safe ADB write commands", async () => {
    const value = "5; rm -rf / quoted ' value";
    const nodePath = "/sys/node with spaces ' path";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 7 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.writeNode({ targetRef: "emulator-5554", nodePath, value, readBack: false });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "adb",
        args: [
          "-s",
          "emulator-5554",
          "shell",
          "printf %s '5; rm -rf / quoted '\\'' value' > '/sys/node with spaces '\\'' path'"
        ],
        timeoutMs: 1500
      }
    ]);
  });

  it("uses base64 decode write path for multiline ADB values", async () => {
    const value = "line1\nline2\n";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 7 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/multiline", value, readBack: false });

    expect(calls[0].args[3]).toContain("base64 -d");
  });

  it("writes JSON payloads with quotes through the printf path when single-line", async () => {
    const value = '{"enabled":true,"name":"test"}';
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 7 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/json", value, readBack: false });

    expect(calls[0].args[3]).toContain("printf %s");
    expect(calls[0].args[3]).toContain(value);
  });

  it("writes DTS-like payloads containing angle brackets and semicolons", async () => {
    const value = "node {\n\tcompatible = \"vendor,chip\";\n};";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 7 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/dts", value, readBack: false });

    expect(calls[0].args[3]).toContain("base64 -d");
  });

  it("preserves exact read values when preserveExactRead is true", async () => {
    const { runCommand } = makeRunner([{ code: 0, stdout: "value\n", stderr: "", durationMs: 5 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.readNode({ targetRef: "emulator-5554", nodePath: "/sys/exact", preserveExactRead: true });

    expect(result).toMatchObject({ ok: true, value: "value\n", stdout: "value\n" });
  });

  it("uses compareReadback when verifying ADB writes", async () => {
    const { runCommand } = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 8 },
      { code: 0, stdout: '{"b":2,"a":1}', stderr: "", durationMs: 9 }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });
    const value = '{"a":1,"b":2}';
    const metadata = resolveDebugValueMetadata({
      valueKind: DEBUG_VALUE_KIND_COMPLEX,
      valueFormat: DEBUG_VALUE_FORMAT_JSON,
      normalizationMode: DEBUG_NORMALIZATION_MODE_JSON_CANONICAL
    });

    const matched = await gateway.writeNode({
      targetRef: "emulator-5554",
      nodePath: "/sys/json",
      value,
      readBack: true,
      compareReadback: (written, read) => compareDebugValues(written, read, metadata)
    });

    expect(matched.verified).toBe(true);
  });

  it("treats remote shell cat diagnostics on stdout as ADB read failures", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "/bin/sh: cat: /sys/missing-node: No such file or directory\n",
        stderr: "",
        durationMs: 5
      }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await expect(gateway.readNode({ targetRef: "emulator-5554", nodePath: "/sys/missing-node" })).resolves.toMatchObject({
      ok: false,
      stdout: "/bin/sh: cat: /sys/missing-node: No such file or directory\n",
      error: "ADB command failed: /bin/sh: cat: /sys/missing-node: No such file or directory"
    });
  });

  it("constructs argv-safe ADB read commands", async () => {
    const nodePath = "/sys/node with spaces ' path";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "42\n", stderr: "", durationMs: 5 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.readNode({ targetRef: "emulator-5554", nodePath });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "adb",
        args: ["-s", "emulator-5554", "shell", "cat '/sys/node with spaces '\\'' path'"],
        timeoutMs: 1500
      }
    ]);
  });

  it("reports readback mismatch after a successful ADB write", async () => {
    const { runCommand } = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 8 },
      { code: 0, stdout: "old\n", stderr: "", durationMs: 9 }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/node", value: "new", readBack: true })).resolves.toMatchObject({
      ok: false,
      value: "new",
      verified: false,
      error: "Read-back mismatch after ADB write."
    });
  });

  it("returns verified write results after successful ADB readback", async () => {
    const { runCommand } = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 8 },
      { code: 0, stdout: "new\n", stderr: "", durationMs: 9 }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/node", value: "new", readBack: true })).resolves.toEqual({
      ok: true,
      value: "new",
      verified: true,
      writeResult: {
        ok: true,
        value: "new",
        stdout: "",
        stderr: "",
        durationMs: 8
      },
      readResult: {
        ok: true,
        value: "new",
        stdout: "new\n",
        stderr: "",
        durationMs: 9
      }
    });
  });

  it("normalizes ADB timeout failures", async () => {
    const { runCommand } = makeRunner([{ code: null, stdout: "", stderr: "", timedOut: true, durationMs: 1007 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.readNode({ targetRef: "emulator-5554", nodePath: "/sys/node" })).resolves.toMatchObject({
      ok: false,
      error: "ADB command timed out after 1000ms.",
      durationMs: 1007
    });
  });

  it("normalizes ADB runner errors as command failures", async () => {
    const runCommand: AdbCommandRunner = vi.fn(async () => {
      throw new Error("adb missing");
    });
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.readNode({ targetRef: "emulator-5554", nodePath: "/sys/node" })).resolves.toMatchObject({
      ok: false,
      stderr: "adb missing",
      error: "ADB command failed: adb missing"
    });
  });
});
