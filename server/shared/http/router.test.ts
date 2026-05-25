import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { createRouter } from "./router";

describe("createRouter", () => {
  it("routes by method and path", async () => {
    const router = createRouter();
    router.get("/api/v1/health", async () => ({ status: 200, body: { ok: true } }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/health",
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
        headers: {},
        requestId: "req-1",
        body: undefined
      })
    ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Route not found.", 404));
  });
});
