import { describe, expect, it, vi } from "vitest";

import { buildBridgeConnectUrl, launchBridgeConnect, probeLocalBridgeHealth, requestLocalBridgeConnect } from "./bridgeConnectLauncher";

describe("bridgeConnectLauncher", () => {
  it("launches custom protocol URLs via location.assign", () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign }
    });

    launchBridgeConnect("wiseeff-bridge://connect?server=http%3A%2F%2F127.0.0.1");

    expect(assign).toHaveBeenCalledWith("wiseeff-bridge://connect?server=http%3A%2F%2F127.0.0.1");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("builds connect URLs with server, origin, and pairing code", () => {
    expect(
      buildBridgeConnectUrl("http://101.43.45.27", "337769", "http://101.43.45.27")
    ).toBe("wiseeff-bridge://connect?server=http%3A%2F%2F101.43.45.27&webOrigin=http%3A%2F%2F101.43.45.27&code=337769");
  });

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

  it("posts connect requests to the local bridge HTTP API", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, accepted: true })
    })) as unknown as typeof fetch;

    await expect(
      requestLocalBridgeConnect(
        {
          server: "http://101.43.45.27",
          webOrigin: "http://101.43.45.27",
          code: "337769"
        },
        fetchImpl
      )
    ).resolves.toEqual({ reachable: true, ok: true, accepted: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/connect"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          server: "http://101.43.45.27",
          webOrigin: "http://101.43.45.27",
          code: "337769"
        })
      })
    );
  });
});
