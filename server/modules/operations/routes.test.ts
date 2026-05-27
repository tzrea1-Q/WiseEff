import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerOperationsRoutes } from "./routes";

function createReadyDb(): Database {
  const db: Database = {
    query: async <Row,>() => ({
      rows: [{ ok: 1 }] as Row[],
      rowCount: 1
    }),
    transaction: async (fn) => fn(db)
  };

  return db;
}

describe("operations routes", () => {
  it("serves /health/live", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, service: "wiseeff-api", status: "live" });
  });

  it("serves /health/ready with database status", async () => {
    const router = createRouter();
    const db = createReadyDb();
    registerOperationsRoutes(router, { db });

    const response = await requestJson(createHttpServer(router), "/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      status: "ready",
      dependencies: { database: { ok: true, status: "ready" } }
    });
  });

  it("reports /health/ready as unavailable when the database is missing", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      status: "not_ready",
      dependencies: { database: { ok: false, status: "missing" } }
    });
  });

  it("keeps /api/v1/health compatibility", async () => {
    const router = createRouter();
    registerOperationsRoutes(router, {});

    const response = await requestJson(createHttpServer(router), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });
});
