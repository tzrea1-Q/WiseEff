import { describe, expect, it, vi } from "vitest";

import { createBridgeRpcClient } from "./rpc";

describe("bridge rpc", () => {
  it("times out when bridge does not answer", async () => {
    vi.useFakeTimers();
    try {
      const pool = {
        send: vi.fn(() => new Promise(() => undefined))
      };
      const rpc = createBridgeRpcClient({ pool: pool as never, now: () => Date.now() });
      const pending = rpc.call(
        "br-1",
        "debug.detectTargets",
        { protocol: "adb", timeoutMs: 10 },
        { timeoutMs: 20 }
      );
      const assertion = expect(pending).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns rpc results from the pool", async () => {
    const pool = {
      send: vi.fn().mockResolvedValue({
        type: "rpc.response",
        id: "req-1",
        ok: true,
        result: { targets: [] }
      })
    };
    const rpc = createBridgeRpcClient({ pool: pool as never, now: () => new Date("2026-06-23T12:00:00.000Z") });

    await expect(
      rpc.call("br-1", "debug.detectTargets", { protocol: "adb" }, { timeoutMs: 1000 })
    ).resolves.toEqual({ targets: [] });

    expect(pool.send).toHaveBeenCalledWith(
      "br-1",
      expect.objectContaining({
        type: "rpc.request",
        method: "debug.detectTargets",
        params: { protocol: "adb" },
        deadlineAt: "2026-06-23T12:00:01.000Z"
      })
    );
  });

  it("throws when bridge returns an rpc error", async () => {
    const pool = {
      send: vi.fn().mockResolvedValue({
        type: "rpc.response",
        id: "req-1",
        ok: false,
        error: { code: "ADB_UNAVAILABLE", message: "adb not found" }
      })
    };
    const rpc = createBridgeRpcClient({ pool: pool as never });

    await expect(rpc.call("br-1", "debug.detectTargets", { protocol: "adb" })).rejects.toThrow(/adb not found/i);
  });
});
