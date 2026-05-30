import { describe, expect, it, vi } from "vitest";
import { createApiClient, WiseEffApiError } from "./apiClient";

function createFetchMock(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

describe("createApiClient", () => {
  it("requests JSON from the configured base URL", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.get("/api/v1/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/health", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
  });

  it("adds an authorization header when configured", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      authorization: "Bearer test-token",
      fetchImpl: fetchMock
    });

    await expect(client.get("/api/v1/me")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/me", {
      headers: { Accept: "application/json", Authorization: "Bearer test-token" },
      method: "GET"
    });
  });

  it("sends DELETE requests with JSON accept headers", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.delete("/api/v1/parameter-drafts/draft-1")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/parameter-drafts/draft-1", {
      headers: { Accept: "application/json" },
      method: "DELETE"
    });
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Content-Type");
  });

  it("sends PUT requests with JSON bodies", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.put("/api/v1/parameters/p-1", { value: 42 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/parameters/p-1", {
      body: JSON.stringify({ value: 42 }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PUT"
    });
  });

  it("uploads files as FormData with optional fields", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ id: "log-1" }), { status: 201 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });
    const file = new File(["timestamp,message\n1,ok"], "diagnostics.csv", { type: "text/csv" });

    await expect(client.upload("/api/v1/logs", file, { projectId: "aurora" })).resolves.toEqual({ id: "log-1" });

    const init = fetchMock.mock.calls[0][1];
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/logs");
    expect(init).toMatchObject({
      headers: { Accept: "application/json" },
      method: "POST"
    });
    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get("file")).toBe(file);
    expect(formData.get("projectId")).toBe("aurora");
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });

  it("maps API error responses", async () => {
    const fetchMock = createFetchMock(
      new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Admin access required.",
            details: {},
            requestId: "req-1"
          }
        }),
        { status: 403 }
      )
    );
    const client = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.get("/api/v1/audit-events")).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {},
      message: "Admin access required.",
      name: WiseEffApiError.name,
      requestId: "req-1"
    });
  });

  it("falls back to the documented internal error envelope shape", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({}), { status: 500 }));
    const client = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(client.get("/health/ready")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      details: {},
      message: "Request failed.",
      requestId: ""
    });
  });
});
