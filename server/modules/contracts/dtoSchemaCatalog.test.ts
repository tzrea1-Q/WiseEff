import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./openapi";
import { schemaRegistry } from "./schemaRegistry";
import { dtoSchemaCatalog, dtoSchemaCoveredRouteIds } from "./dtoSchemas/catalog";

const leftoverSchemaNames = new Set(["GenericObjectResponse"]);

describe("DTO schema catalog coverage", () => {
  it("realizes request/response schemas for every covered route", () => {
    for (const routeId of dtoSchemaCoveredRouteIds) {
      const entry = schemaRegistry[routeId];
      expect(entry, routeId).toBeDefined();
      if (entry.requestBody && dtoSchemaCatalog[entry.requestBody]) {
        expect(dtoSchemaCatalog[entry.requestBody], `${routeId} request ${entry.requestBody}`).toBeDefined();
      }
      if (!leftoverSchemaNames.has(entry.responseBody)) {
        expect(dtoSchemaCatalog[entry.responseBody], `${routeId} response ${entry.responseBody}`).toBeDefined();
      }
    }
  });

  it("publishes object properties for catalogued OpenAPI component schemas", () => {
    const document = buildOpenApiDocument();
    for (const name of Object.keys(dtoSchemaCatalog)) {
      const schema = document.components.schemas[name] as Record<string, unknown> | undefined;
      expect(schema, name).toBeDefined();
      expect(schema?.["x-wiseeff-schema"]).toBe(name);
      expect(schema?.type === "object" || Array.isArray(schema?.anyOf)).toBe(true);
      if (schema?.type === "object") {
        expect(schema.properties, name).toBeDefined();
      }
    }
  });

  it("keeps the existing ErrorEnvelope shape", () => {
    const envelope = buildOpenApiDocument().components.schemas.ErrorEnvelope as Record<string, unknown>;
    expect(envelope).toMatchObject({
      type: "object",
      required: ["error"]
    });
    const error = (envelope.properties as Record<string, Record<string, unknown>>).error;
    expect(error.required).toEqual(["code", "message", "details", "requestId"]);
  });

  it("names Xiaoze thread operations instead of GenericObjectResponse", () => {
    expect(schemaRegistry["xiaoze.listThreads"]?.responseBody).toBe("XiaozeThreadListResponse");
    expect(schemaRegistry["xiaoze.getThread"]?.responseBody).toBe("XiaozeThreadDetailResponse");
    expect(schemaRegistry["xiaoze.run"]?.requestBody).toBe("XiaozeAgUiRunRequest");
    expect(schemaRegistry["xiaoze.run"]?.responseBody).toBe("GenericObjectResponse");
  });
});
