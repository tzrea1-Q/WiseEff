import { describe, expect, it, vi } from "vitest";

import {
  buildBridgeConnectUrl,
  pollLocalBridgeHealth,
  probeLocalBridgeHealth,
  shouldConfirmBridgeSchemeLaunch
} from "./bridgeConnectLauncher";

describe("bridgeConnectLauncher", () => {
  it("builds scheme URL from origin and pairing code", () => {
    expect(buildBridgeConnectUrl("https://tzrea1.com", "123456")).toBe(
      "wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=123456"
    );
  });

  it("polls health until connected or timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, paired: true, connected: false, updatedAt: "t" }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, paired: true, connected: true, updatedAt: "t" }), { status: 200 })
      );

    const result = await pollLocalBridgeHealth({ fetchImpl: fetchMock, intervalMs: 1, timeoutMs: 50 });
    expect(result?.connected).toBe(true);
  });

  it("returns null when health endpoint is unreachable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(probeLocalBridgeHealth(fetchMock)).resolves.toBeNull();
  });

  it("skips confirm when localStorage flag is set", () => {
    expect(shouldConfirmBridgeSchemeLaunch({ getItem: () => "1" })).toBe(false);
  });
});
