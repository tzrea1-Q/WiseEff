import { describe, expect, it } from "vitest";

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
  it("does not 410 live module mapping or driver-registry writes", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const writes = ["parameterModules.registerDriver", "parameterModules.createMapping"]
      .map((id) => routeManifest.find((route) => route.id === id))
      .filter((route): route is (typeof routeManifest)[number] => Boolean(route));
    expect(writes).toHaveLength(2);
    for (const route of writes) {
      const response = await requestJson(server, fillRoutePath(route.path), {
        method: route.method,
        body: JSON.stringify({}),
      });
      expect(response.status, route.id).not.toBe(410);
    }
  });

  it("does not intercept GET registry, discovery hints, or driver-registry navigation", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const reads = ["parameterModules.getRegistry", "parameterModules.discoveryHints", "parameterModules.listDriverRegistry"]
      .map((id) => routeManifest.find((route) => route.id === id))
      .filter((route): route is (typeof routeManifest)[number] => Boolean(route));
    expect(reads).toHaveLength(3);
    for (const route of reads) {
      const response = await requestJson<Record<string, unknown>>(server, fillRoutePath(route.path), {
        method: route.method,
      });
      expect(response.status).not.toBe(410);
      expect(response.body).not.toEqual({ items: [] });
    }
  });
});
