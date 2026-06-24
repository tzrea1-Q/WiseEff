import { describe, expect, it, vi } from "vitest";

import { probeLocalBridgeHealth } from "./bridgeConnectLauncher";

describe("bridgeConnectLauncher", () => {
  it("parses tools probe state from local health JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: {
          adb: { available: false, reason: "adb not found" },
          hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
        }
      })
    })) as unknown as typeof fetch;

    await expect(probeLocalBridgeHealth(fetchImpl)).resolves.toEqual({
      ok: true,
      paired: true,
      connected: true,
      updatedAt: "2026-06-25T00:00:00.000Z",
      tools: {
        adb: { available: false, reason: "adb not found" },
        hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
      }
    });
  });
});
