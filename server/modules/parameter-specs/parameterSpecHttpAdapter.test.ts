import { describe, expect, it } from "vitest";

import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../contracts/routeManifest";
import { buildOpenApiDocument } from "../contracts/openapi";
import { dtoSchemaCatalog } from "../contracts/dtoSchemas/catalog";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
import { legacyDriverSchemaRetirementRouteManifest } from "../parameter-catalog-api/legacy/routes";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { buildWiseEffRouter } from "../../app";
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
  it("publishes an exact promotion history DTO without overlay state or mutation contracts", () => {
    const document = buildOpenApiDocument();
    expect(document.paths["/api/v2/platform/driver-schema-promotion-history"].get?.operationId).toBe("parameterSpecs.listPromotionHistory");
    const item = { id: "promotion", platformSchemaId: "platform", sourceSchemaId: "source",
      sourceOrganizationId: "organization", promotedByUserId: null, promotedAt: "2026-10-01T12:00:00.000Z", documentationSource: null };
    const schema = dtoSchemaCatalog.DriverSchemaPromotionHistoryListResponse;
    expect(schema.safeParse({ items: [item] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ ...item, lifecycle: "active", equivalent: true }] }).success).toBe(false);
    expect(Object.keys(document.paths["/api/v2/platform/driver-schema-promotion-history"])).toEqual(["get"]);
  });

  it.each(legacyDriverSchemaRetirementRouteManifest)("retires $method $path even when the module is registered independently", async (route) => {
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () => {
        throw new Error("Retired overlay routes must not authenticate or query.");
      },
    });
    const response = await requestJson(createHttpServer(router), fillRoutePath(route.path), {
      method: route.method,
      body: route.method === "GET" ? undefined : JSON.stringify({ invalid: true }),
    });
    expect(response.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(response.body).error.details).toEqual({
      reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false,
    });
    expect(response.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
  });

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
    const { router } = buildWiseEffRouter();
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

  it("returns 410 gone-first for winning-router admin mint POST", async () => {
    const { router } = buildWiseEffRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () => {
        throw new Error("gone-first must not authenticate");
      },
    });
    const server = createHttpServer(router);
    const response = await requestJson(server, "/api/v2/parameter-specs", {
      method: "POST",
      body: JSON.stringify({ not: "a-valid-create-body" }),
    });
    expect(response.status).toBe(410);
    const body = catalogLegacyGoneResponseSchema.parse(response.body);
    expect(body.error.details.reason).toBe("legacy-surface-retired");
    expect(body.error.details.retryable).toBe(false);
    expect(body.error.details.successor).toBe("/api/v2/catalog");
    expect(JSON.stringify(body)).not.toMatch(/archive/i);
  });

  it("returns 410 for unauthenticated winning-router admin mint POST", async () => {
    const { router } = buildWiseEffRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: async () => {
        throw new Error("unauthenticated gone-first must not resolve auth");
      },
    });
    const server = createHttpServer(router);
    const response = await requestJson(server, "/api/v2/parameter-specs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it("returns 410 gone-first for winning-router governance list and keeps detail", async () => {
    const { router } = buildWiseEffRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () => {
        throw new Error("governance-list gone-first must not authenticate");
      },
    });
    const server = createHttpServer(router);
    const listed = await requestJson(server, "/api/v2/parameter-specs?view=governance", {
      method: "GET",
    });
    expect(listed.status).toBe(410);
    const body = catalogLegacyGoneResponseSchema.parse(listed.body);
    expect(body.error.details.reason).toBe("legacy-surface-retired");
    expect(body.error.details.retryable).toBe(false);
    expect(body.error.details.successor).toBe("/api/v2/catalog");
  });

  it("retires overlay authoring instead of serving the old DTS coverage writer", async () => {
    const { router } = buildWiseEffRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const overlay = await requestJson(server, "/api/v2/organization-driver-schemas", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(overlay.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(overlay.body).error.details.reason).toBe("legacy-surface-retired");
  });

  it("keeps effective spec detail reads but retires governance detail, review resolve and activate", async () => {
    const { router } = buildWiseEffRouter();
    registerParameterSpecRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const kept = [
      { method: "GET" as const, path: "/api/v2/parameter-specs/spec-adapter?view=effective" },
      { method: "GET" as const, path: "/api/v2/parameter-specs/spec-adapter?view=governance" },
      { method: "POST" as const, path: "/api/v2/parameter-spec-review-tasks/task-adapter/resolve" },
      { method: "POST" as const, path: "/api/v2/parameter-specs/spec-adapter/activate" },
    ];
    for (const route of kept) {
      const response = await requestJson(server, route.path, {
        method: route.method,
        body: route.method === "POST" ? JSON.stringify({}) : undefined,
      });
      if (route.method === "GET" && route.path.endsWith("view=effective")) {
        expect(response.status, route.path).not.toBe(410);
      } else {
        expect(response.status, route.path).toBe(410);
        const successor = route.path.endsWith("/resolve")
          ? "/parameter-admin/specs?review=open"
          : "/api/v2/catalog";
        expect(catalogLegacyGoneResponseSchema.parse(response.body).error.details).toEqual({
          reason: "legacy-surface-retired", successor, retryable: false,
        });
        expect(response.headers.get("link")).toBe(`<${successor}>; rel="successor-version"`);
      }
    }
  });
});
