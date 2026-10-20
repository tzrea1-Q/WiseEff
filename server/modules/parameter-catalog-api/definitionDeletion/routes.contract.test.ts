import { describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { routeManifest } from "../../contracts/routeManifest";
import { schemaRegistry } from "../../contracts/schemaRegistry";
import { dtoSchemaCoveredRouteIds } from "../../contracts/dtoSchemas/index";
import { registerParameterCatalogApi } from "../productionWire";

describe("definition deletion contract registration", () => {
  it("publishes both real production routes with their exact DTO contracts", () => {
    const router = createRouter();
    registerParameterCatalogApi(router, { resolveAuth: () => { throw new Error("Registration does not authenticate"); } });
    for (const id of ["catalog.previewDefinitionDeletion", "catalog.deleteDefinition"]) {
      const route = routeManifest.find(entry => entry.id === id)!;
      expect(route).toBeDefined();
      expect(router.listRoutes()).toContainEqual({ method: route.method, pattern: route.path });
      expect(dtoSchemaCoveredRouteIds as readonly string[]).toContain(id);
      expect(schemaRegistry[id]?.responseBody).toBe(id === "catalog.deleteDefinition" ? "CatalogDefinitionDeletedResponse" : "CatalogDefinitionDeletionPreviewResponse");
    }
  });
});
