import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi";
import { routeManifest } from "./routeManifest";
import { schemaRegistry } from "./schemaRegistry";

type OpenApiMethod = "get" | "post" | "delete";

const criticalRouteIds = [
  "auth.me",
  "parameters.reviewChangeRequest",
  "logs.upload",
  "jobs.get",
  "debugging.writeNode",
  "agent.approveToolCall",
  "operations.ready"
] as const;

const criticalPathsByRouteId: Record<(typeof criticalRouteIds)[number], string> = {
  "auth.me": "/api/v1/me",
  "parameters.reviewChangeRequest": "/api/v1/parameter-change-requests/{requestId}/review",
  "logs.upload": "/api/v1/logs",
  "jobs.get": "/api/v1/jobs/{jobId}",
  "debugging.writeNode": "/api/v1/debugging/nodes/write",
  "agent.approveToolCall": "/api/v1/agent/sessions/{sessionId}/approvals/{approvalId}/approve",
  "operations.ready": "/health/ready"
};

function toOpenApiMethod(method: string): OpenApiMethod {
  return method.toLowerCase() as OpenApiMethod;
}

describe("M5 OpenAPI contract", () => {
  it("has schema metadata for every manifested route", () => {
    for (const route of routeManifest) {
      expect(schemaRegistry[route.id], route.id).toBeDefined();
    }
  });

  it("publishes critical commercial pilot paths", () => {
    const document = buildOpenApiDocument();

    for (const routeId of criticalRouteIds) {
      const route = routeManifest.find((entry) => entry.id === routeId);
      expect(route, routeId).toBeDefined();

      const openApiPath = criticalPathsByRouteId[routeId];
      expect(document.paths[openApiPath], openApiPath).toBeDefined();
      expect(document.paths[openApiPath][toOpenApiMethod(route!.method)], route!.id).toBeDefined();
    }
  });

  it("declares required OpenAPI path parameters for templated paths", () => {
    const document = buildOpenApiDocument();
    const operation = document.paths["/api/v1/agent/sessions/{sessionId}/tool-calls/{toolCallId}/run"]?.post;

    expect(operation?.parameters).toEqual([
      { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
      { name: "toolCallId", in: "path", required: true, schema: { type: "string" } }
    ]);
  });

  it("publishes route-specific success status codes", () => {
    const document = buildOpenApiDocument();
    const createdRoutes = [
      { path: "/api/v1/audit-events", method: "post" },
      { path: "/api/v1/parameter-drafts", method: "post" },
      { path: "/api/v1/parameter-submission-rounds", method: "post" },
      { path: "/api/v1/parameter-import-batches", method: "post" },
      { path: "/api/v1/log-files", method: "post" },
      { path: "/api/v1/logs", method: "post" },
      { path: "/api/v1/debugging/sessions", method: "post" },
      { path: "/api/v1/agent/sessions", method: "post" }
    ] as const;
    const okRoutes = [
      { path: "/api/v1/me", method: "get" },
      { path: "/api/v1/projects", method: "get" },
      { path: "/health/ready", method: "get" }
    ] as const;

    for (const route of createdRoutes) {
      const responses = document.paths[route.path]?.[route.method]?.responses;
      expect(responses?.["201"], route.path).toBeDefined();
      expect(responses?.["200"], route.path).toBeUndefined();
    }

    for (const route of okRoutes) {
      const responses = document.paths[route.path]?.[route.method]?.responses;
      expect(responses?.["200"], route.path).toBeDefined();
      expect(responses?.["201"], route.path).toBeUndefined();
    }
  });

  it("uses the documented error envelope on every operation", () => {
    const document = buildOpenApiDocument();

    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses["400"]).toEqual({ $ref: "#/components/responses/ErrorResponse" });
        expect(operation.responses["500"]).toEqual({ $ref: "#/components/responses/ErrorResponse" });
      }
    }
  });
});
