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

  it("matches dynamic route params without breaking exact routes", async () => {
    const router = createRouter();
    router.get("/api/v1/parameters/:parameterId/history", async (request) => ({
      status: 200,
      body: {
        parameterId: request.params.parameterId,
        limit: request.query.limit
      }
    }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/parameters/aurora-fast-charge-current/history",
      params: {},
      query: { limit: "25" },
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response.body).toEqual({
      parameterId: "aurora-fast-charge-current",
      limit: "25"
    });
  });

  it("prefers exact routes over dynamic routes", async () => {
    const router = createRouter();
    router.get("/api/v1/parameters/review/history", async () => ({
      status: 200,
      body: { route: "exact" }
    }));
    router.get("/api/v1/parameters/:parameterId/history", async (request) => ({
      status: 200,
      body: { route: "dynamic", parameterId: request.params.parameterId }
    }));

    const response = await router.handle({
      method: "GET",
      path: "/api/v1/parameters/review/history",
      params: {},
      query: {},
      headers: {},
      requestId: "req-1",
      body: undefined
    });

    expect(response.body).toEqual({ route: "exact" });
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
