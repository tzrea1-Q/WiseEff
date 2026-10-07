import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, DEFAULT_MAX_REQUEST_BODY_BYTES } from "./server";
import type { RouteRequest } from "./router";

const openServers: Array<ReturnType<typeof createHttpServer>> = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

async function listen(server: ReturnType<typeof createHttpServer>) {
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function echoRouter(seen: { body?: unknown }) {
  return {
    handle: async (request: RouteRequest) => {
      seen.body = request.body;
      return { status: 200, body: { ok: true } };
    }
  };
}

describe("createHttpServer", () => {
  it("keeps idle sockets longer than Node's 5s default", () => {
    const server = createHttpServer({
      handle: async () => ({ status: 204, body: {} })
    });

    openServers.push(server);
    expect(server.keepAliveTimeout).toBeGreaterThanOrEqual(65_000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    server.close();
  });

  it("rejects an oversized body during collection with 413 instead of buffering it", async () => {
    const seen: { body?: unknown } = {};
    const baseUrl = await listen(createHttpServer(echoRouter(seen), { maxBodyBytes: () => 1024 }));

    const response = await fetch(`${baseUrl}/api/v1/oversized`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(4096) })
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string; details: { maxBytes: number } } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.details.maxBytes).toBe(1024);
    expect(seen.body).toBeUndefined();
  });

  it("accepts a body within a declared route bound", async () => {
    const seen: { body?: unknown } = {};
    const baseUrl = await listen(
      createHttpServer(echoRouter(seen), {
        maxBodyBytes: ({ path }) => (path === "/api/v1/limited" ? 1024 : DEFAULT_MAX_REQUEST_BODY_BYTES)
      })
    );

    const response = await fetch(`${baseUrl}/api/v1/limited`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(64) })
    });

    expect(response.status).toBe(200);
    expect(seen.body).toEqual({ payload: "x".repeat(64) });
  });

  it("leaves routes without a declared limit unbounded", async () => {
    const seen: { body?: unknown } = {};
    const baseUrl = await listen(createHttpServer(echoRouter(seen)));

    // Comfortably larger than the old blanket transport cap: existing upload routes must
    // not inherit the catalog transfer contract.
    const response = await fetch(`${baseUrl}/api/v1/unlimited`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(30 * 1024 * 1024) })
    });

    expect(response.status).toBe(200);
    expect((seen.body as { payload: string }).payload.length).toBe(30 * 1024 * 1024);
  });

  it("exposes ETag only to allowed CORS origins", async () => {
    const baseUrl = await listen(
      createHttpServer({
        handle: async () => ({
          status: 200,
          body: { ok: true },
          headers: { ETag: '"test-etag"' },
        }),
      }),
    );

    const allowed = await fetch(`${baseUrl}/api/v1/etag`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("ETag");

    const disallowed = await fetch(`${baseUrl}/api/v1/etag`, {
      headers: { Origin: "https://example.invalid" },
    });
    expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();
    expect(disallowed.headers.get("access-control-expose-headers")).toBeNull();
  });
});
