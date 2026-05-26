import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { createRouter } from "./router";
import { createHttpServer, type RawBody } from "./server";

async function requestText(server: ReturnType<typeof createHttpServer>, path: string, init: RequestInit = {}) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    return { response, text: await response.text() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("createRouter", () => {
  it("routes by method and path", async () => {
    const router = createRouter();
    router.get("/api/v1/health", async () => ({ status: 200, body: { ok: true } }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/health",
      params: {},
      query: {},
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response).toEqual({ status: 200, body: { ok: true } });
  });

  it("returns 404 for missing routes", async () => {
    const router = createRouter();

    await expect(
      router.handle({
        method: "GET",
        path: "/missing",
        params: {},
        query: {},
        headers: {},
        requestId: "req-1",
        body: undefined
      })
    ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Route not found.", 404));
  });

  it("matches dynamic params and query strings", async () => {
    const router = createRouter();
    router.get("/api/v1/logs/:logId/runs", async (request) => ({
      status: 200,
      body: {
        logId: request.params.logId,
        limit: request.query.limit,
        status: request.query.status
      }
    }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/logs/log-123/runs",
      params: {},
      query: { limit: "20", status: ["complete", "failed"] },
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response.body).toEqual({
      logId: "log-123",
      limit: "20",
      status: ["complete", "failed"]
    });
  });

  it("prefers exact routes over dynamic routes", async () => {
    const router = createRouter();
    router.get("/api/v1/jobs/events", async () => ({ status: 200, body: { exact: true } }));
    router.get("/api/v1/jobs/:jobId", async () => ({ status: 200, body: { exact: false } }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/jobs/events",
      params: {},
      query: {},
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response.body).toEqual({ exact: true });
  });

  it("prefers static segments over dynamic segments position by position", async () => {
    const router = createRouter();
    router.get("/api/v1/:scope/search", async (request) => ({
      status: 200,
      body: { route: "scope", scope: request.params.scope }
    }));
    router.get("/api/v1/parameters/:parameterId", async (request) => ({
      status: 200,
      body: { route: "parameter", parameterId: request.params.parameterId }
    }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/parameters/search",
      params: {},
      query: {},
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response.body).toEqual({ route: "parameter", parameterId: "search" });
  });

  it("returns a validation error for malformed dynamic route encoding", async () => {
    const router = createRouter();
    router.get("/api/v1/parameters/:parameterId/history", async (request) => ({
      status: 200,
      body: { parameterId: request.params.parameterId }
    }));

    await expect(
      router.handle({
        method: "GET",
        path: "/api/v1/parameters/%E0%A4%A/history",
        params: {},
        query: {},
        headers: {},
        requestId: "req-1",
        body: undefined
      })
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Route parameter is not valid URL encoding.", 400, {
        path: "/api/v1/parameters/%E0%A4%A/history"
      })
    );
  });
});

describe("createHttpServer", () => {
  it("passes text and csv uploads as raw bodies", async () => {
    const server = createHttpServer({
      handle: async (request) => {
        const body = request.body as RawBody;
        return {
          status: 200,
          body: {
            contentType: body.contentType,
            kind: body.kind,
            text: body.bytes.toString("utf8")
          }
        };
      }
    });

    const { response, text } = await requestText(server, "/api/v1/logs", {
      method: "POST",
      body: "timestamp,message\n1,ok",
      headers: { "Content-Type": "text/csv" }
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      contentType: "text/csv",
      kind: "raw",
      text: "timestamp,message\n1,ok"
    });
  });

  it("sends server-sent events from route responses", async () => {
    async function* events() {
      yield { event: "job", data: { id: "job_1", status: "processing" } };
    }
    const server = createHttpServer({
      handle: async () => ({ status: 200, sse: events() })
    });

    const { response, text } = await requestText(server, "/api/v1/jobs/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: job\n");
    expect(text).toContain('data: {"id":"job_1","status":"processing"}\n\n');
  });
});
