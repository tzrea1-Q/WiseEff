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

  it("loads authorization from an async token provider for OIDC runtimes", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const getAuthorization = vi.fn(async () => "Bearer oidc-token");
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      getAuthorization,
      fetchImpl: fetchMock
    });

    await expect(client.get("/api/v1/me")).resolves.toEqual({ ok: true });

    expect(getAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/me", {
      headers: { Accept: "application/json", Authorization: "Bearer oidc-token" },
      method: "GET"
    });
  });

  it("falls back to configured static authorization when the async provider has no token", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const getAuthorization = vi.fn(async () => undefined);
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      authorization: "Bearer smoke-token",
      getAuthorization,
      fetchImpl: fetchMock
    });

    await expect(client.get("/api/v1/me")).resolves.toEqual({ ok: true });

    expect(getAuthorization).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/me", {
      headers: { Accept: "application/json", Authorization: "Bearer smoke-token" },
      method: "GET"
    });
  });

  it("notifies the auth runtime when token resolution fails", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onAuthorizationFailure = vi.fn();
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:8787",
      getAuthorization: async () => {
        throw new Error("refresh failed");
      },
      onAuthorizationFailure,
      fetchImpl: fetchMock
    });

    await expect(client.get("/api/v1/me")).rejects.toThrow("refresh failed");
    expect(onAuthorizationFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "refresh failed" }));
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("sends PATCH requests with JSON bodies", async () => {
    const fetchMock = createFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.patch("/api/v1/users/u-target/activation", { isActive: false })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/users/u-target/activation", {
      body: JSON.stringify({ isActive: false }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PATCH"
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
