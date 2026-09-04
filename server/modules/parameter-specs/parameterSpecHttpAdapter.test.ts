import { describe, expect, it } from "vitest";

import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../contracts/routeManifest";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { registerParameterSpecRoutes } from "./routes";

function fillRoutePath(path: string): string {
  return path
    .replace(":specId", "spec-adapter")
    .replace(":taskId", "task-adapter")
    .replace(":schemaId", "schema-adapter")
    .replace(":promotionId", "promo-adapter");
}

describe("parameter spec HTTP adapter", () => {
  it("returns 410 for retired Catalog and governance writes", async () => {
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const write = routeManifest.find((route) => route.id === "parameterSpecs.create");
    expect(write).toBeDefined();
    const response = await requestJson(server, fillRoutePath(write!.path), {
      method: write!.method,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(410);
    const body = catalogLegacyGoneResponseSchema.parse(response.body);
    expect(body.error.details.reason).toBe("legacy-surface-retired");
    expect(body.error.details.retryable).toBe(false);
  });

  it("returns typed legacy list outcome for eligible Catalog reads", async () => {
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const list = routeManifest.find((route) => route.id === "parameterSpecs.list");
    expect(list).toBeDefined();
    const response = await requestJson<{ items: unknown[] }>(server, list!.path, {
      method: list!.method,
    });
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});
