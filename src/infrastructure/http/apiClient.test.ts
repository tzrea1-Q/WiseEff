import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";

describe("createApiClient", () => {
  it("requests JSON from the configured base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.get("/api/v1/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/health", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
  });

  it("sends DELETE requests with JSON accept headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock });

    await expect(client.delete("/api/v1/parameter-drafts/draft-1")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/parameter-drafts/draft-1", {
      headers: { Accept: "application/json" },
      method: "DELETE"
    });
  });

  it("maps API error responses", async () => {
    const fetchMock = vi.fn(async () =>
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
      message: "Admin access required."
    });
  });
});
