import { describe, expect, it, vi } from "vitest";

import { detectTargetsAcrossBridges, readNodeViaBridge, writeNodeViaBridge } from "./bridgeExecution";

describe("bridgeExecution", () => {
  it("returns only bridges that found adb targets", async () => {
    const rpc = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ targets: [{ targetRef: "serial-1", online: true, label: "serial-1" }] })
        .mockResolvedValueOnce({ targets: [] })
    };
    const result = await detectTargetsAcrossBridges({
      rpc: rpc as never,
      bridges: [
        { id: "br-1", machineLabel: "Laptop" },
        { id: "br-2", machineLabel: "Desktop" }
      ],
      protocol: "adb",
      timeoutMs: 1000
    });
    expect(result).toEqual([
      expect.objectContaining({ bridgeId: "br-1", targetRef: "serial-1", id: "bridge:br-1:adb:serial-1" })
    ]);
  });

  it("ignores HDC [Empty] placeholder targets from bridge RPC", async () => {
    const rpc = {
      call: vi.fn().mockResolvedValueOnce({ targets: [{ targetRef: "[Empty]", online: true, label: "[Empty]" }] })
    };
    const result = await detectTargetsAcrossBridges({
      rpc: rpc as never,
      bridges: [{ id: "br-1", machineLabel: "Laptop" }],
      protocol: "hdc",
      timeoutMs: 1000
    });
    expect(result).toEqual([]);
  });

  it("maps bridge read payload into gateway-compatible result", async () => {
    const rpc = {
      call: vi.fn().mockResolvedValue({
        ok: true,
        value: "3000",
        stdout: "3000",
        durationMs: 8
      })
    };

    await expect(
      readNodeViaBridge({
        rpc: rpc as never,
        bridgeId: "br-1",
        protocol: "adb",
        targetRef: "serial-1",
        nodePath: "/sys/current",
        preserveExactRead: false,
        timeoutMs: 1000
      })
    ).resolves.toEqual({
      ok: true,
      value: "3000",
      stdout: "3000",
      stderr: undefined,
      error: undefined,
      durationMs: 8
    });
  });

  it("handles bridge rpc write errors as failed write results", async () => {
    const rpc = {
      call: vi.fn().mockRejectedValue(new Error("Bridge disconnected."))
    };

    const result = await writeNodeViaBridge({
      rpc: rpc as never,
      bridgeId: "br-1",
      protocol: "adb",
      targetRef: "serial-1",
      nodePath: "/sys/current",
      value: "3200",
      readBack: true,
      preserveExactRead: false,
      timeoutMs: 1000
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("Bridge disconnected.");
    expect(result.writeResult.ok).toBe(false);
  });
});
