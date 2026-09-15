import type { HttpMethod, WiseEffRouter } from "../../../shared/http/router";

import { handleCatalogGovernance } from "./handlers";
import { catalogDefinitionReplacementRoutes, catalogGovernanceRoutes } from "./mapping";
import type { CatalogGovernancePorts, CatalogGovernanceRequest } from "./types";

function addRoute(
  router: WiseEffRouter,
  method: HttpMethod,
  path: string,
  handler: Parameters<WiseEffRouter["get"]>[1],
): void {
  const add =
    method === "GET"
      ? router.get
      : method === "POST"
        ? router.post
        : method === "PUT"
          ? router.put
          : method === "PATCH"
            ? router.patch
            : router.delete;
  add.call(router, path, handler);
}

function registerRoutes(
  router: WiseEffRouter,
  ports: CatalogGovernancePorts,
  routes: ReadonlyArray<{ readonly method: HttpMethod; readonly path: string }>,
): void {
  for (const route of routes) {
    addRoute(router, route.method, route.path, async (request) => {
      const catalogRequest: CatalogGovernanceRequest = {
        method: request.method,
        path: request.path,
        params: request.params,
        query: request.query,
        headers: request.headers,
        requestId: request.requestId,
        body: request.body,
      };
      const result = await handleCatalogGovernance(ports, catalogRequest);
      return { status: result.status, body: result.body, headers: { ...result.headers } };
    });
  }
}

export function registerCatalogGovernanceRoutes(
  router: WiseEffRouter,
  ports: CatalogGovernancePorts,
): void {
  registerRoutes(router, ports, catalogGovernanceRoutes);
}

/**
 * Definition identity correction migration routes (`PCAT-API-13`).  Registered
 * separately so the frozen PCAT-API-04..06 route set stays exactly 19 routes.
 */
export function registerCatalogDefinitionReplacementRoutes(
  router: WiseEffRouter,
  ports: CatalogGovernancePorts,
): void {
  registerRoutes(router, ports, catalogDefinitionReplacementRoutes);
}

export const catalogGovernanceRouteManifest = catalogGovernanceRoutes.map((route) => ({
  id: route.id,
  method: route.method,
  path: route.path,
}));

export const catalogDefinitionReplacementRouteManifest = catalogDefinitionReplacementRoutes.map(
  (route) => ({
    id: route.id,
    method: route.method,
    path: route.path,
  }),
);
