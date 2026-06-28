import { describe, expect, it, vi } from "vitest";
import { createHdcDebugDeviceGateway, type HdcCommandRunner } from "./hdcGateway";
import { compareDebugValues, resolveDebugValueMetadata } from "./valueCodec";
import { DEBUG_NORMALIZATION_MODE_JSON_CANONICAL, DEBUG_VALUE_FORMAT_JSON, DEBUG_VALUE_KIND_COMPLEX } from "./types";

function makeRunner(results: Awaited<ReturnType<HdcCommandRunner>>[]) {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const runCommand: HdcCommandRunner = vi.fn(async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs });
    const result = results.shift();
    if (!result) {
      throw new Error("Unexpected HDC command");
    }
    return result;
  });

  return { calls, runCommand };
}

describe("HDC debug device gateway", () => {
  it("normalizes non-empty HDC target output lines into gateway targets", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "\nAURORA-001\n  lab target 2  \n\n",
        stderr: "",
        durationMs: 14
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.detectTargets({ projectId: "aurora", deviceId: "device-db-id" });

    expect(result).toEqual({
      ok: true,
      targets: [
        {
          id: "AURORA-001",
          deviceId: "device-db-id",
          targetRef: "AURORA-001",
          label: "HDC target AURORA-001",
          online: true
        },
        {
          id: "lab target 2",
          deviceId: "device-db-id",
          targetRef: "lab target 2",
          label: "HDC target lab target 2",
          online: true
        }
      ]
    });
  });

  it("preserves the requested deviceId when normalizing HDC target output", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "AURORA-001\n",
        stderr: "",
        durationMs: 14
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.detectTargets({ projectId: "aurora", deviceId: "device-db-id" });

    expect(result).toEqual({
      ok: true,
      targets: [
        {
          id: "AURORA-001",
          deviceId: "device-db-id",
          targetRef: "AURORA-001",
          label: "HDC target AURORA-001",
          online: true
        }
      ]
    });
  });

  it("rejects HDC target detection without a requested deviceId to avoid misleading persistence", async () => {
    const { runCommand } = makeRunner([]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.detectTargets({ projectId: "aurora" });

    expect(result).toEqual({
      ok: false,
      targets: [],
      error: "HDC target detection requires deviceId so detected targets can be persisted against a known debugging device."
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns normalized device-unavailable style read errors for stderr and nonzero exit codes", async () => {
    const { runCommand } = makeRunner([
      {
        code: 1,
        stdout: "",
        stderr: "device offline",
        durationMs: 12
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.readNode({ targetRef: "AURORA-001", nodePath: "/sys/node" });

    expect(result).toEqual({
      ok: false,
      stdout: "",
      stderr: "device offline",
      error: "HDC command failed: device offline",
      durationMs: 12
    });
  });

  it("treats remote shell cat diagnostics on stdout as HDC read failures", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "/bin/sh: cat: /sys/missing-node: No such file or directory\n",
        stderr: "",
        durationMs: 12
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.readNode({ targetRef: "AURORA-001", nodePath: "/sys/missing-node" });

    expect(result).toEqual({
      ok: false,
      stdout: "/bin/sh: cat: /sys/missing-node: No such file or directory\n",
      stderr: "",
      error: "HDC command failed: /bin/sh: cat: /sys/missing-node: No such file or directory",
      durationMs: 12
    });
  });

  it("treats HDC [Fail] diagnostics on stdout as read failures even when exit code is zero", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "[Fail] [E001005] Device not found or connected\n",
        stderr: "",
        durationMs: 12
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.readNode({ targetRef: "3DC0124226000194", nodePath: "/sys/node" });

    expect(result).toEqual({
      ok: false,
      stdout: "[Fail] [E001005] Device not found or connected\n",
      stderr: "",
      error: "HDC command failed: [Fail] [E001005] Device not found or connected",
      durationMs: 12
    });
  });

  it("reports read-back mismatch after a successful HDC write", async () => {
    const { runCommand } = makeRunner([
      {
        code: 0,
        stdout: "",
        stderr: "",
        durationMs: 8
      },
      {
        code: 0,
        stdout: "old-value\n",
        stderr: "",
        durationMs: 9
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.writeNode({
      targetRef: "AURORA-001",
      nodePath: "/sys/node",
      value: "new-value",
      readBack: true
    });

    expect(result).toEqual({
      ok: false,
      value: "new-value",
      verified: false,
      error: "Read-back mismatch after HDC write.",
      writeResult: {
        ok: true,
        value: "new-value",
        stdout: "",
        stderr: "",
        durationMs: 8
      },
      readResult: {
        ok: true,
        value: "old-value",
        stdout: "old-value\n",
        stderr: "",
        durationMs: 9
      }
    });
  });

  it("returns timeout failures with configured timeout and measured duration", async () => {
    const { runCommand } = makeRunner([
      {
        code: null,
        stdout: "",
        stderr: "",
        timedOut: true,
        durationMs: 1007
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    const result = await gateway.readNode({ targetRef: "AURORA-001", nodePath: "/sys/node" });

    expect(result).toEqual({
      ok: false,
      stdout: "",
      stderr: "",
      error: "HDC command timed out after 1000ms.",
      durationMs: 1007
    });
  });

  it("constructs HDC commands with argv arrays for target, node, and value", async () => {
    const value = "5; rm -rf / quoted ' value";
    const nodePath = "/sys/node with spaces ' path";
    const { calls, runCommand } = makeRunner([
      {
        code: 0,
        stdout: "",
        stderr: "",
        durationMs: 6
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.writeNode({
      targetRef: "AURORA 001",
      nodePath,
      value,
      readBack: false
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "hdc",
        args: [
          "-t",
          "AURORA 001",
          "shell",
          "printf %s '5; rm -rf / quoted '\\'' value' > '/sys/node with spaces '\\'' path'"
        ],
        timeoutMs: 1500
      }
    ]);
  });

  it("uses base64 decode write path for multiline HDC values", async () => {
    const value = "line1\nline2\n";
    const nodePath = "/sys/multiline";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 6 }]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.writeNode({
      targetRef: "AURORA-001",
      nodePath,
      value,
      readBack: false
    });

    expect(result.ok).toBe(true);
    expect(calls[0].args[3]).toContain("base64 -d");
    expect(calls[0].args[3]).toContain(nodePath);
  });

  it("writes JSON payloads with quotes through the printf path when single-line", async () => {
    const value = '{"enabled":true,"name":"test"}';
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 6 }]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await gateway.writeNode({ targetRef: "AURORA-001", nodePath: "/sys/json", value, readBack: false });

    expect(calls[0].args[3]).toContain("printf %s");
    expect(calls[0].args[3]).toContain(value);
  });

  it("writes DTS-like payloads containing angle brackets and semicolons", async () => {
    const value = "node {\n\tcompatible = \"vendor,chip\";\n};";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 6 }]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    await gateway.writeNode({ targetRef: "AURORA-001", nodePath: "/sys/dts", value, readBack: false });

    expect(calls[0].args[3]).toContain("base64 -d");
  });

  it("preserves exact read values when preserveExactRead is true", async () => {
    const { runCommand } = makeRunner([{ code: 0, stdout: "value\n", stderr: "", durationMs: 6 }]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.readNode({ targetRef: "AURORA-001", nodePath: "/sys/exact", preserveExactRead: true });

    expect(result).toMatchObject({ ok: true, value: "value\n", stdout: "value\n" });
  });

  it("uses compareReadback when verifying HDC writes", async () => {
    const { runCommand } = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 8 },
      { code: 0, stdout: '{"b":2,"a":1}', stderr: "", durationMs: 9 }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1000 });
    const value = '{"a":1,"b":2}';
    const metadata = resolveDebugValueMetadata({
      valueKind: DEBUG_VALUE_KIND_COMPLEX,
      valueFormat: DEBUG_VALUE_FORMAT_JSON,
      normalizationMode: DEBUG_NORMALIZATION_MODE_JSON_CANONICAL
    });

    const matched = await gateway.writeNode({
      targetRef: "AURORA-001",
      nodePath: "/sys/json",
      value,
      readBack: true,
      compareReadback: (written, read) => compareDebugValues(written, read, metadata)
    });

    expect(matched.verified).toBe(true);
  });

  it("constructs HDC read commands without shell positional parameters", async () => {
    const nodePath = "/sys/node with spaces ' path";
    const { calls, runCommand } = makeRunner([
      {
        code: 0,
        stdout: "123\n",
        stderr: "",
        durationMs: 6
      }
    ]);
    const gateway = createHdcDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.readNode({ targetRef: "AURORA 001", nodePath });

    expect(result).toMatchObject({ ok: true, value: "123" });
    expect(calls).toEqual([
      {
        command: "hdc",
        args: ["-t", "AURORA 001", "shell", "cat '/sys/node with spaces '\\'' path'"],
        timeoutMs: 1500
      }
    ]);
  });
});
