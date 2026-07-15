import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterSpecRoutes } from "../parameter-specs/routes";
import { registerParameterTopologyRoutes } from "./routes";
import * as specService from "../parameter-specs/service";
import * as topologyService from "./service";

vi.mock("../parameter-specs/service", () => ({
  listParameterSpecs: vi.fn(),
  getParameterSpec: vi.fn(),
  resolveSpecReviewTask: vi.fn()
}));

vi.mock("./service", () => ({
  getTopology: vi.fn(),
  listProjectBindings: vi.fn(),
  listIdentityMappingTasks: vi.fn(),
  resolveIdentityMappingTask: vi.fn(),
  validateConfigRevision: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["parameter:view"],
    ...overrides
  };
}

function makeAdminAuth(): AuthContext {
  return makeAuth({
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  });
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  const deps = {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  };
  registerParameterSpecRoutes(router, deps);
  registerParameterTopologyRoutes(router, deps);
  return createHttpServer(router);
}

const bindingDto = {
  id: "binding-1",
  parameterSpecId: "spec-1",
  parameterSpecVersionId: "spec-ver-1",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  logicalNodeId: "logical-1",
  instanceName: "sc8562@6E",
  locator: "/amba/i2c@FDF5E000/sc8562@6E",
  effectiveValue: { kind: "cells" as const, bits: 32 as const, groups: [[{ kind: "integer" as const, raw: "0", value: "0" }]] },
  rawValue: "<0>",
  schemaState: "valid" as const,
  policyState: "pass" as const
};

describe("parameter semantic v2 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v2/parameter-specs lets viewers list specs", async () => {
    vi.mocked(specService.listParameterSpecs).mockResolvedValue({
      items: [
        {
          id: "spec-1",
          sourceKind: "dts",
          specificationKey: "sc8562/gpio_int",
          propertyKey: "gpio_int",
          driverModule: "sc8562",
          lifecycle: "active",
          currentVersionId: "spec-ver-1",
          currentVersion: 1
        }
      ]
    });

    const response = await requestJson<{ items: Array<{ id: string; propertyKey: string }> }>(
      makeServer({ db: makeDb() }),
      "/api/v2/parameter-specs"
    );

    expect(response.status).toBe(200);
    expect(response.body?.items[0]).toMatchObject({ id: "spec-1", propertyKey: "gpio_int" });
    expect(response.body?.items[0]).not.toHaveProperty("path");
  });

  it("GET /api/v2/parameter-specs/:specId returns 404 for cross-org ids", async () => {
    const { ApiError } = await import("../../shared/http/errors");
    vi.mocked(specService.getParameterSpec).mockRejectedValue(
      new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId: "spec-x" })
    );

    const response = await requestJson(makeServer({ db: makeDb() }), "/api/v2/parameter-specs/spec-x");
    expect(response.status).toBe(404);
  });

  it("POST /api/v2/parameter-spec-review-tasks/:taskId/resolve requires parameter admin", async () => {
    const response = await requestJson(makeServer({ db: makeDb(), auth: makeAuth() }), "/api/v2/parameter-spec-review-tasks/task-1/resolve", {
      method: "POST",
      body: JSON.stringify({ decision: "resolved", parameterSpecId: "spec-1", reason: "Matched linux schema" })
    });
    expect(response.status).toBe(403);
    expect(specService.resolveSpecReviewTask).not.toHaveBeenCalled();
  });

  it("POST /api/v2/parameter-spec-review-tasks/:taskId/resolve lets admins approve", async () => {
    vi.mocked(specService.resolveSpecReviewTask).mockResolvedValue({
      id: "task-1",
      status: "resolved",
      parameterSpecId: "spec-1",
      reason: "Matched linux schema"
    });

    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/parameter-spec-review-tasks/task-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ decision: "resolved", parameterSpecId: "spec-1", reason: "Matched linux schema" })
      }
    );

    expect(response.status).toBe(200);
    expect(specService.resolveSpecReviewTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      expect.objectContaining({ taskId: "task-1", decision: "resolved", parameterSpecId: "spec-1" }),
      expect.objectContaining({ requestId: "test-request" })
    );
  });

  it("GET topology lets viewers read source and effective views", async () => {
    vi.mocked(topologyService.getTopology).mockResolvedValue({
      view: "effective",
      revisionId: "rev-1",
      configSetId: "cs-1",
      projectId: "project-1",
      nodes: []
    });

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/config-sets/cs-1/revisions/rev-1/topology?view=effective"
    );

    expect(response.status).toBe(200);
    expect(topologyService.getTopology).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      expect.objectContaining({
        projectId: "project-1",
        configSetId: "cs-1",
        revisionId: "rev-1",
        view: "effective"
      })
    );
  });

  it("GET /api/v2/projects/:projectId/parameter-bindings returns semantic binding DTOs", async () => {
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({ items: [bindingDto] });

    const response = await requestJson<{ items: Array<Record<string, unknown>> }>(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(200);
    expect(response.body?.items[0]).toMatchObject({
      id: "binding-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      instanceName: "sc8562@6E",
      locator: "/amba/i2c@FDF5E000/sc8562@6E"
    });
    expect(response.body?.items[0]).not.toHaveProperty("path");
    expect(response.body?.items[0]).not.toHaveProperty("recommendedValue");
  });

  it("GET /api/v2/projects/:projectId/parameter-bindings returns 404 for cross-org projectId", async () => {
    const { ApiError } = await import("../../shared/http/errors");
    vi.mocked(topologyService.listProjectBindings).mockRejectedValue(
      new ApiError("NOT_FOUND", "Project was not found for this organization.", 404, {
        projectId: "cross-org-project"
      })
    );

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/cross-org-project/parameter-bindings"
    );
    expect(response.status).toBe(404);
  });

  it("GET /api/v2/identity-mapping-tasks lets viewers list open tasks", async () => {
    vi.mocked(topologyService.listIdentityMappingTasks).mockResolvedValue({
      items: [
        {
          id: "map-1",
          projectId: "project-1",
          configRevisionId: "rev-1",
          status: "open",
          candidateLogicalNodeIds: ["ln-a", "ln-b"]
        }
      ]
    });

    const response = await requestJson(makeServer({ db: makeDb() }), "/api/v2/identity-mapping-tasks?projectId=project-1");
    expect(response.status).toBe(200);
  });

  it("POST /api/v2/identity-mapping-tasks/:taskId/resolve forbids non-admins", async () => {
    const response = await requestJson(makeServer({ db: makeDb(), auth: makeAuth() }), "/api/v2/identity-mapping-tasks/map-1/resolve", {
      method: "POST",
      body: JSON.stringify({ decision: "resolved", selectedLogicalNodeId: "ln-a", reason: "Same board instance" })
    });
    expect(response.status).toBe(403);
    expect(topologyService.resolveIdentityMappingTask).not.toHaveBeenCalled();
  });

  it("POST /api/v2/identity-mapping-tasks/:taskId/resolve lets admins resolve", async () => {
    vi.mocked(topologyService.resolveIdentityMappingTask).mockResolvedValue({
      id: "map-1",
      status: "resolved",
      selectedLogicalNodeId: "ln-a"
    });

    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/identity-mapping-tasks/map-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ decision: "resolved", selectedLogicalNodeId: "ln-a", reason: "Same board instance" })
      }
    );

    expect(response.status).toBe(200);
    expect(topologyService.resolveIdentityMappingTask).toHaveBeenCalled();
  });

  it("POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate requires admin", async () => {
    const viewer = await requestJson(
      makeServer({ db: makeDb(), auth: makeAuth() }),
      "/api/v2/projects/project-1/config-revisions/rev-1/validate",
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(viewer.status).toBe(403);

    vi.mocked(topologyService.validateConfigRevision).mockResolvedValue({
      id: "run-1",
      status: "passed",
      stage: "toolchain",
      artifactHashes: { effectiveDtb: "abc" }
    });

    const admin = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/projects/project-1/config-revisions/rev-1/validate",
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(admin.status).toBe(200);
    expect(topologyService.validateConfigRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      expect.objectContaining({ projectId: "project-1", revisionId: "rev-1" }),
      expect.objectContaining({ requestId: "test-request" })
    );
  });
});
