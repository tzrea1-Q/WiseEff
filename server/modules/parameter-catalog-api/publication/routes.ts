import type { HttpMethod, WiseEffRouter } from "../../../shared/http/router";

import { handleCatalogPublication } from "./handlers";
import { catalogPublicationRoutes } from "./mapping";
import type { CatalogPublicationPorts, CatalogPublicationRequest } from "./types";

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

export function registerCatalogPublicationRoutes(
  router: WiseEffRouter,
  ports: CatalogPublicationPorts,
): void {
  for (const route of catalogPublicationRoutes) {
    addRoute(router, route.method, route.path, async (request) => {
      const catalogRequest: CatalogPublicationRequest = {
        method: request.method,
        path: request.path,
        params: request.params,
        query: request.query,
        headers: request.headers,
        requestId: request.requestId,
        body: request.body,
      };
      const result = await handleCatalogPublication(ports, catalogRequest);
      return { status: result.status, body: result.body, headers: { ...result.headers } };
    });
  }
}

export const catalogPublicationRouteManifest = catalogPublicationRoutes.map((route) => ({
  id: route.id,
  method: route.method,
  path: route.path,
}));
