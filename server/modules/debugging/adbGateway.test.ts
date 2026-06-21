import { describe, expect, it, vi } from "vitest";
import { createAdbDebugDeviceGateway, type AdbCommandRunner } from "./adbGateway";

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
    const value = "5; rm -rf / quoted";
    const nodePath = "/sys/node with spaces";
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
          "sh",
          "-c",
          "printf '%s' \"$1\" > \"$2\"",
          "wiseeff-write-node",
          value,
          nodePath
        ],
        timeoutMs: 1500
      }
    ]);
  });

  it("constructs argv-safe ADB read commands", async () => {
    const nodePath = "/sys/node with spaces";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "42\n", stderr: "", durationMs: 5 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.readNode({ targetRef: "emulator-5554", nodePath });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "adb",
        args: ["-s", "emulator-5554", "shell", "sh", "-c", "cat \"$1\"", "wiseeff-read-node", nodePath],
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
