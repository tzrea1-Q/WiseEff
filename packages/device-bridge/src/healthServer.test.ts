import { describe, expect, it, vi } from "vitest";

import { request } from "node:http";

import { createToolProbeCache } from "./healthState";
import { startHealthServer } from "./healthServer";

type TestResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

function requestHealth(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: options.method ?? "GET",
        headers: options.headers ?? {}
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(", ");
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            headers,
            body
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

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
      port: 0,
      onHealthRead,
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: cache.getTools()
      })
    });

    const response = await requestHealth(health.url);
    expect(response.ok).toBe(true);
    const body = JSON.parse(response.body);
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
      port: 0,
      onHealthRead: () => cache.refreshTools(),
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: cache.getTools()
      })
    });

    await requestHealth(health.url);
    now = 30_000;
    await requestHealth(health.url);
    expect(probe).toHaveBeenCalledTimes(1);

    now = 61_000;
    await requestHealth(health.url);
    expect(probe).toHaveBeenCalledTimes(2);

    await health.close();
  });

  it("allows browser health reads from local loopback origins", async () => {
    const health = await startHealthServer({
      port: 0,
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      headers: { Origin: "http://localhost:5173" }
    });
    expect(response.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    await health.close();
  });

  it("allows browser health reads from any origin even when unpaired (standby)", async () => {
    const health = await startHealthServer({
      port: 0,
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      headers: { Origin: "https://tzrea1.com" }
    });
    expect(response.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("https://tzrea1.com");

    await health.close();
  });

  it("allows browser health reads from any origin when paired", async () => {
    const health = await startHealthServer({
      port: 0,
      allowedOrigin: ["https://tzrea1.com"],
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      headers: { Origin: "https://wiseeff.example.com" }
    });
    expect(response.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("https://wiseeff.example.com");

    await health.close();
  });

  it("responds to OPTIONS /health with open CORS preflight for any origin", async () => {
    const health = await startHealthServer({
      port: 0,
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      method: "OPTIONS",
      headers: { Origin: "https://tzrea1.com" }
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://tzrea1.com");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");

    await health.close();
  });

  it("responds to OPTIONS /health with private network access for remote origins", async () => {
    const health = await startHealthServer({
      port: 0,
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      method: "OPTIONS",
      headers: {
        Origin: "http://101.43.45.27",
        "Access-Control-Request-Private-Network": "true"
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://101.43.45.27");
    expect(response.headers["access-control-allow-private-network"]).toBe("true");

    await health.close();
  });

  it("allows browser health reads from the paired web origin", async () => {
    const health = await startHealthServer({
      port: 0,
      allowedOrigin: ["https://tzrea1.com", "https://tzrea1.com"],
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      headers: { Origin: "https://tzrea1.com" }
    });
    expect(response.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("https://tzrea1.com");

    await health.close();
  });

  it("matches allowed origins by hostname when scheme differs", async () => {
    const health = await startHealthServer({
      port: 0,
      allowedOrigin: "http://tzrea1.com",
      getState: () => ({
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url, {
      headers: { Origin: "https://tzrea1.com" }
    });
    expect(response.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("https://tzrea1.com");

    await health.close();
  });

  it("includes launcherPath in health JSON when provided", async () => {
    const health = await startHealthServer({
      port: 0,
      getState: () => ({
        paired: false,
        connected: false,
        launcherPath: "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd",
        updatedAt: "2026-06-28T00:00:00.000Z"
      })
    });

    const response = await requestHealth(health.url);
    const body = JSON.parse(response.body);
    expect(body.launcherPath).toBe("C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd");

    await health.close();
  });

  it("accepts POST /connect and returns CORS headers for remote origins", async () => {
    const onConnect = vi.fn(async () => ({ ok: true, accepted: true }));
    const health = await startHealthServer({
      port: 0,
      onConnect,
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-28T00:00:00.000Z"
      })
    });

    const connectUrl = health.url.replace(/\/health$/, "/connect");
    const response = await requestHealth(connectUrl, {
      method: "POST",
      headers: {
        Origin: "http://101.43.45.27",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        server: "http://101.43.45.27",
        webOrigin: "http://101.43.45.27",
        code: "123456"
      })
    });
    expect(response.status).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBe("http://101.43.45.27");
    expect(JSON.parse(response.body)).toEqual({ ok: true, accepted: true });
    expect(onConnect).toHaveBeenCalledWith({
      server: "http://101.43.45.27",
      webOrigin: "http://101.43.45.27",
      code: "123456"
    });

    await health.close();
  });

  it("responds to OPTIONS /connect with private network access", async () => {
    const health = await startHealthServer({
      port: 0,
      onConnect: async () => ({ ok: true, accepted: true }),
      getState: () => ({
        paired: false,
        connected: false,
        updatedAt: "2026-06-28T00:00:00.000Z"
      })
    });

    const connectUrl = health.url.replace(/\/health$/, "/connect");
    const response = await requestHealth(connectUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://101.43.45.27",
        "Access-Control-Request-Private-Network": "true"
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://101.43.45.27");
    expect(response.headers["access-control-allow-private-network"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");

    await health.close();
  });
});
