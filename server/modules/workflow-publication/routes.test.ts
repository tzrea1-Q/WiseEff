import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import type { AuthContext } from "../auth/types";
import { createAgentInvocation, type UserInvocationContext } from "../auth/trustedInvocation";
import { buildOpenApiDocument } from "../contracts/openapi";
import { registerWorkflowPublicationRoutes } from "./routes";
import { updateWorkflowPublication } from "./service";

const workflows = { "parameter-management": true, debugging: true, "log-analysis": false, knowledge: false };
const superadmin = makeTestAuthContext({ roleId: "platform-admin" });

function setup(auth: AuthContext | null = superadmin, available = true) {
  const query = vi.fn(async () => ({ rows: [{
    workflows, version: 2, updated_at: new Date("2026-10-23T00:00:00Z"),
    updated_by_user_id: "private-editor-id", updated_by_name: "Private editor"
  }], rowCount: 1 }));
  const db = { query, transaction: vi.fn() } as unknown as Database;
  const router = createRouter();
  registerWorkflowPublicationRoutes(router, {
    db: available ? db : undefined,
    getCurrentAuthContext: () => {
      if (!auth) throw new ApiError("UNAUTHENTICATED", "Authentication required.");
      return auth;
    }
  });
  return { server: createHttpServer(router), db, query };
}

describe("workflow publication HTTP boundary", () => {
  it("returns only global state to an authenticated ordinary user, with caching disabled", async () => {
    const { server } = setup(makeTestAuthContext({ roleId: "guest" }));
    const result = await requestJson(server, "/api/v1/workflow-publication");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ item: { workflows, version: 2 } });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("returns management attribution only to a platform super administrator", async () => {
    const { server } = setup();
    const result = await requestJson(server, "/api/v1/admin/workflow-publication");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ item: { workflows, version: 2, updatedAt: "2026-10-23T00:00:00.000Z",
      updatedBy: { id: "private-editor-id", name: "Private editor" } } });
  });

  it.each([
    ["ordinary member", makeTestAuthContext({ roleId: "hardware-user" })],
    ["organization administrator", makeTestAuthContext({ roleId: "admin" })],
    ["project-scoped platform role", makeTestAuthContext({ roles: [{ projectId: "project", roleId: "platform-admin" }] })],
    ["inactive super administrator", makeTestAuthContext({ roleId: "platform-admin", isActive: false })]
  ] as const)("rejects management reads and writes for %s before querying", async (_label, auth) => {
    for (const method of ["GET", "PUT"]) {
      const { server, query } = setup(auth);
      const result = await requestJson(server, "/api/v1/admin/workflow-publication", {
        method, ...(method === "PUT" ? { body: JSON.stringify({ workflows, expectedVersion: 2 }) } : {})
      });
      expect(result.status).toBe(403);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each(["/api/v1/workflow-publication", "/api/v1/admin/workflow-publication"])("requires authentication on %s", async (path) => {
    const { server, query } = setup(null);
    expect((await requestJson(server, path)).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { workflows, expectedVersion: -1 },
    { workflows, expectedVersion: 0.5 },
    { workflows, expectedVersion: "2" },
    { workflows },
    { workflows: { ...workflows, future: true }, expectedVersion: 2 },
    { workflows: { ...workflows, knowledge: "false" }, expectedVersion: 2 },
    { workflows: { debugging: false }, expectedVersion: 2 },
    { workflows, expectedVersion: 2, actorUserId: "spoofed" },
    { workflows, expectedVersion: 2, organizationId: "other-org" }
  ])("rejects malformed or spoofed input %j", async (body) => {
    const { server, db } = setup();
    expect((await requestJson(server, "/api/v1/admin/workflow-publication", { method: "PUT", body: JSON.stringify(body) })).status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when storage is unavailable or uninitialized", async () => {
    const unavailable = setup(superadmin, false);
    expect((await requestJson(unavailable.server, "/api/v1/workflow-publication")).status).toBe(500);
    const missing = setup();
    missing.query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect((await requestJson(missing.server, "/api/v1/workflow-publication")).status).toBe(500);
  });

  it("does not let an Agent invocation impersonate a human configuration write", async () => {
    const { db } = setup();
    const agent = createAgentInvocation(superadmin, { sessionId: "session", toolCallId: "call", approval: { required: false } });
    await expect(updateWorkflowPublication(db, agent as unknown as UserInvocationContext, { workflows, expectedVersion: 2 }, "request"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("documents separate read/admin DTOs and optimistic writes", () => {
    const contract = buildOpenApiDocument();
    expect(contract.paths["/api/v1/workflow-publication"]?.get?.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowPublicationResponse" } } }
    });
    expect(contract.paths["/api/v1/admin/workflow-publication"]?.put).toMatchObject({
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateWorkflowPublicationRequest" } } } },
      responses: { "403": {}, "409": {} }
    });
  });
});
