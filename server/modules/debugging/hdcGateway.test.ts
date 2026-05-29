import { describe, expect, it, vi } from "vitest";
import { createHdcDebugDeviceGateway, type HdcCommandRunner } from "./hdcGateway";

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
    const value = '5; rm -rf / "quoted"';
    const nodePath = "/sys/node with spaces";
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
        args: ["-t", "AURORA 001", "shell", "sh", "-c", "printf '%s' \"$1\" > \"$2\"", "wiseeff-write-node", value, nodePath],
        timeoutMs: 1500
      }
    ]);
  });
});
