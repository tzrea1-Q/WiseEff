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
    expect(result.writeOutcome).toBe("unknown");
    expect(result.readbackOutcome).toBe("unknown");
    expect(result.error).toContain("Bridge disconnected.");
    expect(result.writeResult.ok).toBe(false);
  });

  it.each([
    { stdout: "cat: /sys/current: Permission denied", value: "cat: /sys/current: Permission denied" },
    { stdout: "", value: "cat: /sys/current: Permission denied" },
    { value: "/bin/sh: cat: /sys/current: No such file or directory" },
    { stderr: "[Fail] Device is offline", value: "" }
  ])("rejects successful legacy Bridge reads containing command diagnostics: %j", async (payload) => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, ...payload }) };

    await expect(readNodeViaBridge({
      rpc: rpc as never,
      bridgeId: "br-old",
      protocol: "hdc",
      targetRef: "target-1",
      nodePath: "/sys/current",
      preserveExactRead: false,
      timeoutMs: 1000
    })).resolves.toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("keeps an executed write independent from a failed legacy readback", async () => {
    const diagnostic = "cat: /sys/current: Permission denied";
    const rpc = { call: vi.fn().mockResolvedValue({
      ok: true,
      writeOutcome: "executed",
      readbackOutcome: "observed",
      writeResult: { ok: true, value: diagnostic },
      readResult: { ok: true, value: diagnostic }
    }) };

    await expect(writeNodeViaBridge({
      rpc: rpc as never,
      bridgeId: "br-old",
      protocol: "hdc",
      targetRef: "target-1",
      nodePath: "/sys/current",
      value: diagnostic,
      readBack: true,
      preserveExactRead: false,
      timeoutMs: 1000
    })).resolves.toMatchObject({
      ok: true,
      writeOutcome: "executed",
      readbackOutcome: "failed",
      error: diagnostic,
      writeResult: { ok: true },
      readResult: { ok: false }
    });
  });

  it("does not trust an executed outcome when the write output contains a command diagnostic", async () => {
    const diagnostic = "sh: /sys/current: Read-only file system";
    const rpc = { call: vi.fn().mockResolvedValue({
      ok: true,
      writeOutcome: "executed",
      readbackOutcome: "not_requested",
      writeResult: { ok: true, stderr: diagnostic }
    }) };

    await expect(writeNodeViaBridge({
      rpc: rpc as never,
      bridgeId: "br-old",
      protocol: "adb",
      targetRef: "target-1",
      nodePath: "/sys/current",
      value: "1",
      readBack: false,
      preserveExactRead: false,
      timeoutMs: 1000
    })).resolves.toMatchObject({
      ok: false,
      writeOutcome: "failed",
      readbackOutcome: "not_requested",
      error: diagnostic,
      writeResult: { ok: false }
    });
  });

  it("preserves an explicitly unknown write outcome despite a failed nested command", async () => {
    const rpc = { call: vi.fn().mockResolvedValue({
      ok: false,
      writeOutcome: "unknown",
      readbackOutcome: "unknown",
      writeResult: { ok: false, error: "The write acknowledgement was lost." }
    }) };

    await expect(writeNodeViaBridge({
      rpc: rpc as never,
      bridgeId: "br-1",
      protocol: "adb",
      targetRef: "target-1",
      nodePath: "/sys/current",
      value: "1",
      readBack: true,
      preserveExactRead: false,
      timeoutMs: 1000
    })).resolves.toMatchObject({ ok: false, writeOutcome: "unknown", readbackOutcome: "unknown" });
  });

  it("infers independent outcomes from legacy nested Bridge results", async () => {
    const rpc = {
      call: vi.fn().mockResolvedValue({
        ok: false,
        verified: false,
        error: "Readback mismatch after write.",
        writeResult: { ok: true, value: "1", durationMs: 7 },
        readResult: { ok: true, value: "0x1", durationMs: 8 }
      })
    };

    await expect(
      writeNodeViaBridge({
        rpc: rpc as never,
        bridgeId: "br-1",
        protocol: "hdc",
        targetRef: "target-1",
        nodePath: "/sys/value",
        value: "1",
        readBack: true,
        preserveExactRead: false,
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      ok: true,
      verified: false,
      writeOutcome: "executed",
      readbackOutcome: "observed",
      value: "0x1",
      error: undefined
    });
  });

  it("does not fabricate outcomes from a legacy top-level-only Bridge result", async () => {
    const rpc = { call: vi.fn().mockResolvedValue({ ok: true, verified: true, value: "1" }) };

    await expect(
      writeNodeViaBridge({
        rpc: rpc as never,
        bridgeId: "br-old",
        protocol: "adb",
        targetRef: "serial-1",
        nodePath: "/sys/value",
        value: "1",
        readBack: true,
        preserveExactRead: false,
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      ok: false,
      verified: false,
      writeOutcome: "unknown",
      readbackOutcome: "unknown",
      error: expect.stringContaining("upgrade")
    });
  });
});
