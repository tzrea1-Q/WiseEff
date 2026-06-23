import { describe, expect, it, vi } from "vitest";

import type { AdbCommandRunner } from "@wiseeff/device-command-core/adbRunner";
import type { HdcCommandRunner } from "@wiseeff/device-command-core/hdcRunner";

import { createRpcHandlers, RpcRequestError } from "./rpcHandlers";

function makeRunner(
  results: Array<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut?: boolean }>
) {
  const calls: string[][] = [];
  const runner = vi.fn(async (args: string[]) => {
    calls.push(args);
    const result = results.shift();
    if (!result) {
      throw new Error("Unexpected command");
    }
    return result;
  });
  return { runner: runner as AdbCommandRunner & HdcCommandRunner, calls };
}

describe("device bridge rpc handlers", () => {
  it("reports adb and hdc availability from version probes", async () => {
    const adb = makeRunner([
      { code: 0, stdout: "Android Debug Bridge version 1.0.41\n", stderr: "", durationMs: 5 },
      { code: 0, stdout: "List of devices attached\n", stderr: "", durationMs: 5 }
    ]);
    const hdc = makeRunner([
      { code: 0, stdout: "hdc version 2.0.0\n", stderr: "", durationMs: 6 },
      { code: 0, stdout: "AURORA-001\n", stderr: "", durationMs: 6 }
    ]);
    const rpc = createRpcHandlers({ adbRunner: adb.runner, hdcRunner: hdc.runner });

    const capabilities = await rpc.handle("bridge.getCapabilities", {});
    expect(capabilities.protocols).toEqual({
      adb: { available: true, version: "Android Debug Bridge version 1.0.41" },
      hdc: { available: true, version: "hdc version 2.0.0" }
    });
    expect(adb.calls).toEqual([["version"]]);
    expect(hdc.calls).toEqual([["version"]]);
  });

  it("reports unavailable protocols when version probe fails", async () => {
    const adb = makeRunner([{ code: 0, stdout: "Android Debug Bridge version 1.0.41\n", stderr: "", durationMs: 5 }]);
    const hdc = makeRunner([{ code: 1, stdout: "", stderr: "hdc not found", durationMs: 4 }]);
    const rpc = createRpcHandlers({ adbRunner: adb.runner, hdcRunner: hdc.runner });

    const capabilities = await rpc.handle("bridge.getCapabilities", {});
    expect(capabilities.protocols).toEqual({
      adb: { available: true, version: "Android Debug Bridge version 1.0.41" },
      hdc: { available: false, reason: "hdc not found" }
    });
  });

  it("detects adb targets via adb devices", async () => {
    const adb = makeRunner([
      { code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "", durationMs: 12 }
    ]);
    const hdc = makeRunner([]);
    const rpc = createRpcHandlers({ adbRunner: adb.runner, hdcRunner: hdc.runner });

    const result = await rpc.handle("debug.detectTargets", { protocol: "adb" });
    expect(result).toEqual({
      ok: true,
      targets: [{ targetRef: "emulator-5554", label: "emulator-5554", online: true }],
      durationMs: 12
    });
    expect(adb.calls).toEqual([["devices"]]);
  });

  it("detects hdc targets via hdc list targets", async () => {
    const adb = makeRunner([]);
    const hdc = makeRunner([
      { code: 0, stdout: "\nAURORA-001\n  lab target 2  \n\n", stderr: "", durationMs: 14 }
    ]);
    const rpc = createRpcHandlers({ adbRunner: adb.runner, hdcRunner: hdc.runner });

    const result = await rpc.handle("debug.detectTargets", { protocol: "hdc" });
    expect(result).toEqual({
      ok: true,
      targets: [
        { targetRef: "AURORA-001", label: "AURORA-001", online: true },
        { targetRef: "lab target 2", label: "lab target 2", online: true }
      ],
      durationMs: 14
    });
    expect(hdc.calls).toEqual([["list", "targets"]]);
  });

  it("reads nodes over adb and hdc with gateway argv patterns", async () => {
    const adb = makeRunner([
      { code: 0, stdout: "42\n", stderr: "", durationMs: 8 }
    ]);
    const hdc = makeRunner([
      { code: 0, stdout: "hello\n", stderr: "", durationMs: 9 }
    ]);
    const rpc = createRpcHandlers({ adbRunner: adb.runner, hdcRunner: hdc.runner });

    const adbRead = await rpc.handle("debug.readNode", {
      protocol: "adb",
      targetRef: "emulator-5554",
      nodePath: "/sys/node"
    });
    const hdcRead = await rpc.handle("debug.readNode", {
      protocol: "hdc",
      targetRef: "AURORA-001",
      nodePath: "/sys/node"
    });

    expect(adbRead).toMatchObject({ ok: true, value: "42" });
    expect(hdcRead).toMatchObject({ ok: true, value: "hello" });
    expect(adb.calls).toEqual([["-s", "emulator-5554", "shell", "cat", "/sys/node"]]);
    expect(hdc.calls).toEqual([["-t", "AURORA-001", "shell", "cat '/sys/node'"]]);
  });

  it("writes nodes with optional readback for hdc", async () => {
    const hdc = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 10 },
      { code: 0, stdout: "updated\n", stderr: "", durationMs: 11 }
    ]);
    const rpc = createRpcHandlers({ hdcRunner: hdc.runner, adbRunner: makeRunner([]).runner });

    const result = await rpc.handle("debug.writeNode", {
      protocol: "hdc",
      targetRef: "AURORA-001",
      nodePath: "/sys/node",
      value: "updated",
      readBack: true
    });

    expect(result).toMatchObject({
      ok: true,
      verified: true,
      value: "updated"
    });
    expect(hdc.calls).toEqual([
      ["-t", "AURORA-001", "shell", "printf %s 'updated' > '/sys/node'"],
      ["-t", "AURORA-001", "shell", "cat '/sys/node'"]
    ]);
  });

  it("rejects unsupported protocols", async () => {
    const rpc = createRpcHandlers({
      adbRunner: makeRunner([]).runner,
      hdcRunner: makeRunner([]).runner
    });

    await expect(rpc.handle("debug.detectTargets", { protocol: "ssh" })).rejects.toMatchObject({
      code: "UNSUPPORTED_PROTOCOL"
    });
    expect(rpc.toRpcError(new RpcRequestError("UNSUPPORTED_PROTOCOL", "bad protocol"))).toEqual({
      code: "UNSUPPORTED_PROTOCOL",
      message: "bad protocol"
    });
  });
});
