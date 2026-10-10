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
  it.each([
    ["post", "/api/v1/parameter-modules", "201", "CreateParameterModuleRequest", "ParameterModuleResponse"],
    ["patch", "/api/v1/parameter-modules/{moduleId}", "200", "UpdateParameterModuleRequest", "ParameterModuleResponse"],
    ["delete", "/api/v1/parameter-modules/{moduleId}", "204", undefined, undefined],
    ["post", "/api/v1/parameter-modules/{moduleId}/move", "200", "MoveParameterModuleRequest", "ParameterModuleResponse"]
  ] as const)("documents structural retirement and supported business-category CRUD for %s %s", (method, path, successStatus, requestSchema, responseSchema) => {
    const operation = buildOpenApiDocument().paths[path]![method]!;
    expect(operation.responses["410"], `${method.toUpperCase()} ${path} retirement response`).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/CatalogLegacyGoneResponse" } } }
    });
    if (responseSchema) {
      expect(operation.responses[successStatus]).toMatchObject({
        content: { "application/json": { schema: { $ref: `#/components/schemas/${responseSchema}` } } }
      });
    } else {
      expect(operation.responses[successStatus]).toBeDefined();
      expect(operation.responses[successStatus]).not.toHaveProperty("content");
      expect(operation.responses["200"]).toBeUndefined();
    }
    expect(operation.summary).toContain("shared business-category CRUD supported");
    if (requestSchema) {
      expect(operation.requestBody).toMatchObject({
        required: true,
        content: { "application/json": { schema: { $ref: `#/components/schemas/${requestSchema}` } } }
      });
    }
  });

  it("keeps shared business-category module navigation documented as supported", () => {
    const operation = buildOpenApiDocument().paths["/api/v1/parameter-modules"]!.get!;
    expect(operation.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/ParameterModuleListResponse" } } }
    });
    expect(operation.responses["410"]).toBeUndefined();
  });

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
