import { describe, expect, it } from "vitest";

import { apiFailureReasons } from "../server/modules/parameter-catalog-contract/index";
import { buildOpenApiDocument } from "../server/modules/contracts/openapi";
import { schemaRegistry } from "../server/modules/contracts/schemaRegistry";
import {
  catalogApiFailureReasons,
  catalogFailureClientBehaviors,
  parameterCatalogCoveredRouteIds,
  parameterCatalogDtoSchemaCatalog
} from "../server/modules/contracts/dtoSchemas/parameterCatalog";

describe("catalog contract schema freeze", () => {
  it("fails when a catalog schema name is missing from generated OpenAPI", () => {
    const document = buildOpenApiDocument();
    for (const [name, schema] of Object.entries(parameterCatalogDtoSchemaCatalog)) {
      expect(schema, name).toBeDefined();
      const component = document.components.schemas[name] as Record<string, unknown> | undefined;
      expect(component, name).toBeDefined();
      expect(component?.["x-wiseeff-schema"]).toBe(name);
      expect(component?.type === "object" || Array.isArray(component?.anyOf)).toBe(true);
      if (component?.type === "object") {
        expect(component.properties, name).toBeDefined();
      }
    }
  });

  it("fails when a covered catalog route points at an unrealized response schema", () => {
    for (const routeId of parameterCatalogCoveredRouteIds) {
      const entry = schemaRegistry[routeId];
      expect(entry, routeId).toBeDefined();
      expect(
        parameterCatalogDtoSchemaCatalog[entry.responseBody as keyof typeof parameterCatalogDtoSchemaCatalog],
        `${routeId} ${entry.responseBody}`
      ).toBeDefined();
    }
  });

  it("fails when a stable catalog error reason is dropped from the client behavior table", () => {
    expect([...catalogApiFailureReasons]).toEqual([...apiFailureReasons]);
    expect(Object.keys(catalogFailureClientBehaviors).sort()).toEqual(
      [...catalogApiFailureReasons].sort()
    );
  });
});
