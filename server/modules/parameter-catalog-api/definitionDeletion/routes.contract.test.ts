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
    for (const [id, response] of Object.entries({ "catalog.previewDefinitionDeletion": "CatalogDefinitionDeletionPreviewResponse",
      "catalog.deleteDefinition": "CatalogDefinitionDeletedResponse", "catalog.listDefinitionErasures": "CatalogDefinitionErasureListResponse",
      "catalog.retryDefinitionCleanup": "CatalogDefinitionDeletedResponse" })) {
      const route = routeManifest.find(entry => entry.id === id)!;
      expect(route).toBeDefined();
      expect(router.listRoutes()).toContainEqual({ method: route.method, pattern: route.path });
      expect(dtoSchemaCoveredRouteIds as readonly string[]).toContain(id);
      expect(schemaRegistry[id]?.responseBody).toBe(response);
    }
  });
});
