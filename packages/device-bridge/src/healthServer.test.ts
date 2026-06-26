import { describe, expect, it, vi } from "vitest";

import { createToolProbeCache } from "./healthState";
import { startHealthServer } from "./healthServer";

describe("healthServer", () => {
  it("includes tools probe results in health JSON", async () => {
    const probe = vi.fn(async () => ({
      adb: { available: false, reason: "adb not found" },
      hdc: { available: true, version: "hdc version 2.0.0", source: "system" as const }
    }));
    const cache = createToolProbeCache({ probe, ttlMs: 60_000 });
    const onHealthRead = vi.fn(async () => {
      await cache.refreshTools();
    });

    const health = await startHealthServer({
      onHealthRead,
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: cache.getTools()
      })
    });

    const response = await fetch(health.url);
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body.tools).toEqual({
      adb: { available: false, reason: "adb not found" },
      hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
    });
    expect(onHealthRead).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);

    await health.close();
  });

  it("caches tool probes for 60 seconds on repeated health reads", async () => {
    const probe = vi.fn(async () => ({
      adb: { available: true, version: "Android Debug Bridge version 1.0.41" },
      hdc: { available: false, reason: "hdc not found" }
    }));
    let now = 0;
    const cache = createToolProbeCache({
      probe,
      ttlMs: 60_000,
      now: () => now
    });

    const health = await startHealthServer({
      onHealthRead: () => cache.refreshTools(),
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: cache.getTools()
      })
    });

    await fetch(health.url);
    now = 30_000;
    await fetch(health.url);
    expect(probe).toHaveBeenCalledTimes(1);

    now = 61_000;
    await fetch(health.url);
    expect(probe).toHaveBeenCalledTimes(2);

    await health.close();
  });

  it("allows browser health reads from local loopback origins", async () => {
    const health = await startHealthServer({
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await fetch(health.url, {
      headers: {
        Origin: "http://localhost:5173"
      }
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    await health.close();
  });
});
