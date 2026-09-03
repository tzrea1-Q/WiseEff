import type { HttpMethod, WiseEffRouter } from "../../../shared/http/router";

import { handleCatalogGovernance } from "./handlers";
import { catalogGovernanceRoutes } from "./mapping";
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

export function registerCatalogGovernanceRoutes(
  router: WiseEffRouter,
  ports: CatalogGovernancePorts,
): void {
  for (const route of catalogGovernanceRoutes) {
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
      return { status: result.status, body: result.body };
    });
  }
}

export const catalogGovernanceRouteManifest = catalogGovernanceRoutes.map((route) => ({
  id: route.id,
  method: route.method,
  path: route.path,
}));
