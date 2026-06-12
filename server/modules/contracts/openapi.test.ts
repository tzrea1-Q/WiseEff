import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi";
import { routeManifest } from "./routeManifest";
import { schemaRegistry } from "./schemaRegistry";

type OpenApiMethod = "get" | "post" | "put" | "patch" | "delete";

const criticalRouteIds = [
  "auth.login",
  "auth.me",
  "auth.updateProfile",
  "parameters.reviewChangeRequest",
  "logs.upload",
  "jobs.get",
  "debugging.writeNode",
  "agent.approveToolCall",
  "operations.ready",
  "operations.pilotReadiness"
] as const;

const criticalPathsByRouteId: Record<(typeof criticalRouteIds)[number], string> = {
  "auth.login": "/api/v1/auth/login",
  "auth.me": "/api/v1/me",
  "auth.updateProfile": "/api/v1/me/profile",
  "parameters.reviewChangeRequest": "/api/v1/parameter-change-requests/{requestId}/review",
  "logs.upload": "/api/v1/logs",
  "jobs.get": "/api/v1/jobs/{jobId}",
  "debugging.writeNode": "/api/v1/debugging/nodes/write",
  "agent.approveToolCall": "/api/v1/agent/sessions/{sessionId}/approvals/{approvalId}/approve",
  "operations.ready": "/health/ready",
  "operations.pilotReadiness": "/api/v1/operations/pilot-readiness"
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

  it("publishes user governance API routes as commercial-readiness contracts", () => {
    expect(routeManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "users.list", method: "GET", path: "/api/v1/users", module: "users", stability: "commercial-readiness" }),
        expect.objectContaining({ id: "users.create", method: "POST", path: "/api/v1/users", module: "users", stability: "commercial-readiness" }),
        expect.objectContaining({
          id: "users.listRegistrationRoleRequests",
          method: "GET",
          path: "/api/v1/users/registration-role-requests",
          module: "users",
          stability: "commercial-readiness"
        }),
        expect.objectContaining({
          id: "users.approveRegistrationRoleRequest",
          method: "POST",
          path: "/api/v1/users/registration-role-requests/:requestId/approve",
          module: "users",
          stability: "commercial-readiness"
        }),
        expect.objectContaining({
          id: "users.rejectRegistrationRoleRequest",
          method: "POST",
          path: "/api/v1/users/registration-role-requests/:requestId/reject",
          module: "users",
          stability: "commercial-readiness"
        }),
        expect.objectContaining({ id: "users.update", method: "PATCH", path: "/api/v1/users/:userId", module: "users", stability: "commercial-readiness" }),
        expect.objectContaining({
          id: "users.activation",
          method: "PATCH",
          path: "/api/v1/users/:userId/activation",
          module: "users",
          stability: "commercial-readiness"
        }),
        expect.objectContaining({
          id: "users.replaceRoles",
          method: "PUT",
          path: "/api/v1/users/:userId/roles",
          module: "users",
          stability: "commercial-readiness"
        })
      ])
    );

    expect(schemaRegistry["users.create"]).toMatchObject({
      requestBody: "CreateUserGovernanceRequest",
      responseBody: "UserGovernanceResponse",
      successStatus: 201
    });
    expect(schemaRegistry["users.approveRegistrationRoleRequest"]).toMatchObject({
      responseBody: "RegistrationRoleRequestResponse",
      additionalResponses: { "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
    });
  });

  it("publishes local account lifecycle API routes as commercial-readiness contracts", () => {
    expect(routeManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "auth.register", method: "POST", path: "/api/v1/auth/register", module: "auth", stability: "commercial-readiness" }),
        expect.objectContaining({ id: "auth.login", method: "POST", path: "/api/v1/auth/login", module: "auth", stability: "commercial-readiness" }),
        expect.objectContaining({ id: "auth.logout", method: "POST", path: "/api/v1/auth/logout", module: "auth", stability: "commercial-readiness" }),
        expect.objectContaining({ id: "auth.updateProfile", method: "PATCH", path: "/api/v1/me/profile", module: "auth", stability: "commercial-readiness" })
      ])
    );

    expect(schemaRegistry["auth.register"]).toMatchObject({
      requestBody: "RegisterLocalAccountRequest",
      responseBody: "AuthSessionResponse",
      successStatus: 201
    });
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
      { path: "/api/v1/auth/register", method: "post" },
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

  it("documents pilot readiness auth failures with a 403 response", () => {
    const document = buildOpenApiDocument();
    const responses = document.paths["/api/v1/operations/pilot-readiness"]?.get?.responses;

    expect(responses?.["403"]).toEqual({ $ref: "#/components/responses/ErrorResponse" });
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
