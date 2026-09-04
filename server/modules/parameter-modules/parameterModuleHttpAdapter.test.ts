import { describe, expect, it } from "vitest";

import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../contracts/routeManifest";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { registerParameterModuleRoutes } from "./routes";

function fillRoutePath(path: string): string {
  return path
    .replace(":moduleId", "module-adapter")
    .replace(":mappingId", "mapping-adapter")
    .replace(":compatible", "compat-adapter");
}

describe("parameter module HTTP adapter", () => {
  it("returns 410 for retired module identity and overlay writes", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const write = routeManifest.find((route) => route.id === "parameterModules.registerDriver");
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

  it("returns typed legacy list outcome for eligible module registry reads", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const list = routeManifest.find((route) => route.id === "parameterModules.getRegistry");
    expect(list).toBeDefined();
    const response = await requestJson<{ items: unknown[] }>(server, list!.path, {
      method: list!.method,
    });
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});
