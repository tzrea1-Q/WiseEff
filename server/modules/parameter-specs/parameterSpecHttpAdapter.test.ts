import { describe, expect, it } from "vitest";

import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../contracts/routeManifest";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
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
  it("returns typed 410 for retired Catalog writes through S8-LEG without wrapping router.handle", async () => {
    const write = routeManifest.find((route) => route.id === "parameterSpecs.create");
    expect(write).toBeDefined();
    const result = await handleLegacyCatalogRequest(
      {
        method: write!.method,
        path: fillRoutePath(write!.path),
        params: {},
        query: {},
        headers: {},
        requestId: "cgh-adapter-write",
        body: {},
      },
      {
        catalogReleaseId: "catalog-unready",
        sunsetHttpDate: "Fri, 31 Dec 2027 00:00:00 GMT",
        getQueryable: async () => {
          throw new Error("retired write must not query");
        },
        resolveInvocation: async () => null,
      },
    );
    expect(result.status).toBe(410);
    const body = catalogLegacyGoneResponseSchema.parse(result.body);
    expect(body.error.details.reason).toBe("legacy-surface-retired");
    expect(body.error.details.retryable).toBe(false);
  });

  it("does not intercept live spec GET navigation used by topology and parameter-admin", async () => {
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const reads = ["parameterSpecs.list", "parameterSpecs.get", "parameterSpecs.listReviewTasks"]
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
