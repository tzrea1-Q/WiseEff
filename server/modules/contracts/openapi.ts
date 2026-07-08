import type { HttpMethod } from "../../shared/http/router";
import { routeManifest } from "./routeManifest";
import { schemaRegistry } from "./schemaRegistry";

type SchemaRef = { $ref: string };
type BinarySchema = { type: "string"; format: "binary" };
type MediaTypeObject = { schema: SchemaRef | BinarySchema };
type ResponseObject = { description: string; content?: Record<string, MediaTypeObject> };
type ResponseRef = { $ref: string };
type ParameterObject = {
  name: string;
  in: "path";
  required: true;
  schema: { type: "string" };
};

export type OpenApiOperation = {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    required: boolean;
    content: Record<string, MediaTypeObject>;
  };
  responses: Record<string, ResponseObject | ResponseRef>;
};

export type OpenApiPathItem = Partial<Record<Lowercase<HttpMethod>, OpenApiOperation>>;

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  paths: Record<string, OpenApiPathItem>;
  components: {
    schemas: Record<string, unknown>;
    responses: Record<string, ResponseObject>;
  };
};

function toOpenApiPath(path: string) {
  return path.replace(/:([^/]+)/g, "{$1}");
}

function pathParameters(path: string): ParameterObject[] | undefined {
  const parameters = Array.from(path.matchAll(/:([^/]+)/g), ([, name]) => ({
    name,
    in: "path" as const,
    required: true as const,
    schema: { type: "string" as const }
  }));

  return parameters.length > 0 ? parameters : undefined;
}

function schemaRef(name: string): SchemaRef {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schemaName: string) {
  return {
    "application/json": {
      schema: schemaRef(schemaName)
    }
  };
}

function binaryContent() {
  return {
    "application/octet-stream": {
      schema: { type: "string" as const, format: "binary" as const }
    }
  };
}

function responseContent(schema: { responseBody: string; responseMedia?: "json" | "binary" }) {
  return schema.responseMedia === "binary" ? binaryContent() : jsonContent(schema.responseBody);
}

function buildSchemaPlaceholders() {
  const schemas: Record<string, unknown> = {
    ErrorEnvelope: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message", "details", "requestId"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "object", additionalProperties: true },
            requestId: { type: "string" }
          }
        }
      }
    }
  };

  for (const schema of Object.values(schemaRegistry)) {
    if (schema.requestBody) {
      schemas[schema.requestBody] = { type: "object", "x-wiseeff-schema": schema.requestBody };
    }
    schemas[schema.responseBody] =
      schema.responseMedia === "binary"
        ? { type: "string", format: "binary", "x-wiseeff-schema": schema.responseBody }
        : { type: "object", "x-wiseeff-schema": schema.responseBody };
    for (const responseBody of Object.values(schema.additionalSuccessResponses ?? {})) {
      schemas[responseBody] = { type: "object", "x-wiseeff-schema": responseBody };
    }
  }

  return schemas;
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = {};

  for (const route of routeManifest) {
    const schema = schemaRegistry[route.id];
    if (!schema) {
      throw new Error(`Missing schema registry entry for route ${route.id}.`);
    }

    const path = toOpenApiPath(route.path);
    const method = route.method.toLowerCase() as Lowercase<HttpMethod>;
    paths[path] ??= {};
    paths[path][method] = {
      operationId: route.id,
      summary: schema.summary,
      tags: schema.tags,
      ...(pathParameters(route.path) ? { parameters: pathParameters(route.path) } : {}),
      ...(schema.requestBody
        ? {
            requestBody: {
              required: true,
              content: jsonContent(schema.requestBody)
            }
          }
        : {}),
      responses: {
        [schema.successStatus ?? 200]: {
          description: "Successful response.",
          content: responseContent(schema)
        },
        ...(schema.additionalSuccessResponses
          ? Object.fromEntries(
              Object.entries(schema.additionalSuccessResponses).map(([status, schemaName]) => [
                status,
                { description: "Successful response.", content: jsonContent(schemaName) }
              ])
            )
          : {}),
        ...(schema.additionalResponses
          ? Object.fromEntries(
              Object.entries(schema.additionalResponses).map(([status, schemaName]) => [
                status,
                { $ref: `#/components/responses/${schemaName}` }
              ])
            )
          : {}),
        "400": { $ref: "#/components/responses/ErrorResponse" },
        "500": { $ref: "#/components/responses/ErrorResponse" }
      }
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "WiseEff API",
      version: "m5"
    },
    paths,
    components: {
      schemas: buildSchemaPlaceholders(),
      responses: {
        ErrorResponse: {
          description: "WiseEff error envelope.",
          content: jsonContent("ErrorEnvelope")
        }
      }
    }
  };
}
