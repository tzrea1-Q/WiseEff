import type { RouteRequest, WiseEffRouter } from "../../../shared/http/router";
import {
  parameterCatalogCanonicalRoutes,
  parameterCatalogKernelReadByRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { handleCatalogRead } from "./handlers";
import type { CatalogReadPorts, CatalogReadRequest } from "./types";

const READ_ROUTE_IDS = new Set<string>(Object.keys(parameterCatalogKernelReadByRouteId));

const catalogReadGetRoutes = parameterCatalogCanonicalRoutes.filter(
  (route) => route.method === "GET" && READ_ROUTE_IDS.has(route.id),
);

function toCatalogReadRequest(request: RouteRequest): CatalogReadRequest {
  return {
    method: "GET",
    path: request.path,
    params: request.params,
    query: request.query,
    headers: request.headers,
    requestId: request.requestId,
  };
}

export function registerCatalogReadRoutes(router: WiseEffRouter, ports: CatalogReadPorts): void {
  for (const route of catalogReadGetRoutes) {
    router.get(route.path, async (request) => {
      const result = await handleCatalogRead(ports, toCatalogReadRequest(request));
      // RouteResponse has no headers field; release/retry headers stay on the isolated HTTP server.
      return { status: result.status, body: result.body };
    });
  }
}
