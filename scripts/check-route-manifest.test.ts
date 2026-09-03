import { describe, expect, it } from "vitest";

import {
  parameterCatalogBoundedLegacyReadRouteIds,
  parameterCatalogCanonicalRoutes,
  parameterCatalogLegacyWriteRouteIds,
  parameterCatalogProjectBindingRouteIds,
  pcatApiGates
} from "../server/modules/contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../server/modules/contracts/routeManifest";
import { schemaRegistry } from "../server/modules/contracts/schemaRegistry";

describe("catalog route manifest freeze", () => {
  it("fails when a PCAT canonical route is absent from the manifest", () => {
    const ids = new Set(routeManifest.map((route) => route.id));
    const missing = parameterCatalogCanonicalRoutes
      .map((route) => route.id)
      .filter((id) => !ids.has(id));
    expect(missing, "missing catalog route in routeManifest").toEqual([]);
  });

  it("fails when a PCAT-API-12 project-binding route disappears", () => {
    const ids = new Set(routeManifest.map((route) => route.id));
    for (const routeId of parameterCatalogProjectBindingRouteIds) {
      expect(ids.has(routeId), routeId).toBe(true);
      expect(schemaRegistry[routeId]?.responseBody).toEqual(expect.any(String));
    }
  });

  it("fails when a 410 legacy write is still advertised as a live success", () => {
    for (const routeId of parameterCatalogLegacyWriteRouteIds) {
      expect(schemaRegistry[routeId]?.successStatus, routeId).toBe(410);
    }
    for (const routeId of parameterCatalogBoundedLegacyReadRouteIds) {
      expect(schemaRegistry[routeId]?.additionalResponses?.["410"], routeId).toBe("ErrorResponse");
    }
  });

  it("does not publish operator diagnostics on the public router", () => {
    expect(
      routeManifest.filter((route) => route.path.startsWith("/api/v2/operator/parameter-catalog"))
    ).toEqual([]);
  });

  it("keeps the twelve PCAT-API identifiers in the frozen contract", () => {
    expect(pcatApiGates).toHaveLength(12);
  });
});
