import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import * as repository from "./repository";
import * as projectService from "./projectService";
import { registerParameterRoutes } from "./routes";
import * as service from "./service";

vi.mock("./repository", () => ({
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getParameterById: vi.fn(),
  getProjectAdminDetail: vi.fn(),
  listParameterHistory: vi.fn(),
  listParameters: vi.fn(),
  listProjectAdminSummaries: vi.fn(),
  listProjectModules: vi.fn(),
  listProjects: vi.fn(),
  updateProject: vi.fn()
}));

vi.mock("./projectService", () => ({
  createProjectForAuth: vi.fn()
}));

vi.mock("./service", () => ({
  applyImportBatch: vi.fn(),
  createImportPreview: vi.fn(),
  createParameterModuleForAuth: vi.fn(),
  deleteDraft: vi.fn(),
  deleteParameterModuleForAuth: vi.fn(),
  listChangeRequests: vi.fn(),
  listDrafts: vi.fn(),
  listWorkflowAssignees: vi.fn(),
  listParameterModulesForAuth: vi.fn(),
  listSubmissionRounds: vi.fn(),
  moveParameterModuleForAuth: vi.fn(),
  parseDtsImportForAuth: vi.fn(),
  resolveParameterListQuery: vi.fn(),
  reviewChange: vi.fn(),
  saveDraft: vi.fn(),
  submitParameterChanges: vi.fn(),
  updateParameterModuleForAuth: vi.fn(),
  withdrawSubmissionRound: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "aurora", roleId: "software-user" }],
    permissions: ["parameter:view", "parameter:edit"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerParameterRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

describe("parameter routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/projects returns items", async () => {
    const db = makeDb();
    const project = { id: "aurora", name: "Aurora", code: "AUR" };
    vi.mocked(repository.listProjects).mockResolvedValue([project]);

    const response = await requestJson<{ items: typeof project[] }>(makeServer({ db }), "/api/v1/projects");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [project] });
    expect(repository.listProjects).toHaveBeenCalledWith(db, { organizationId: "org-1" });
  });

  it("GET project workflow assignees returns service-filtered candidates", async () => {
    const db = makeDb();
    const candidates = {
      hardwareCommitters: [{ id: "u-hw", name: "Hardware" }],
      softwareCommitters: [{ id: "u-sw", name: "Software" }],
      softwareUsers: [{ id: "u-user", name: "Developer" }],
    };
    vi.mocked(service.listWorkflowAssignees).mockResolvedValue(candidates);

    const response = await requestJson<{ item: typeof candidates }>(
      makeServer({ db }),
      "/api/v1/projects/aurora/parameter-workflow-assignees",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: candidates });
    expect(service.listWorkflowAssignees).toHaveBeenCalledWith(db, makeAuth(), "aurora");
  });

  it("GET /api/v1/parameters passes filters", async () => {
    const db = makeDb();
    vi.mocked(repository.listParameters).mockResolvedValue([]);
    vi.mocked(service.resolveParameterListQuery).mockResolvedValue({
      organizationId: "org-1",
      projectId: "aurora",
      risk: "High",
      q: "charge",
      limit: 500
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameters?projectId=aurora&risk=High&q=charge&limit=500"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
    expect(service.resolveParameterListQuery).toHaveBeenCalledWith(db, "org-1", {
      projectId: "aurora",
      risk: "High",
      q: "charge",
      limit: 500
    });
    expect(repository.listParameters).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      projectId: "aurora",
      risk: "High",
      q: "charge",
      limit: 500
    });
  });

  it("GET /api/v1/parameters accepts moduleId and includeDescendants", async () => {
    const db = makeDb();
    vi.mocked(repository.listParameters).mockResolvedValue([]);
    vi.mocked(service.resolveParameterListQuery).mockResolvedValue({
      organizationId: "org-1",
      moduleId: "pm-a",
      includeDescendants: false
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameters?moduleId=pm-a&includeDescendants=false"
    );

    expect(response.status).toBe(200);
    expect(service.resolveParameterListQuery).toHaveBeenCalledWith(db, "org-1", {
      moduleId: "pm-a",
      includeDescendants: false
    });
  });

  it("auth without parameter view permission cannot read parameters", async () => {
    const db = makeDb();
    const response = await requestJson<{ error: { code: string; message: string } }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:edit"] }) }),
      "/api/v1/parameters"
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Parameter view permission is required."
    });
    expect(repository.listParameters).not.toHaveBeenCalled();
  });

  it("GET /api/v1/parameters/:parameterId/history uses route params", async () => {
    const db = makeDb();
    const history = { version: "7", value: "3100", changedAt: "2026-05-25T05:00:00.000Z", changedBy: "Riley Chen" };
    vi.mocked(repository.listParameterHistory).mockResolvedValue([history]);

    const response = await requestJson<{ items: typeof history[] }>(
      makeServer({ db }),
      "/api/v1/parameters/param-1/history"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [history] });
    expect(repository.listParameterHistory).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      parameterId: "param-1"
    });
  });

  it("missing database returns INTERNAL_ERROR", async () => {
    const response = await requestJson<{ error: { code: string } }>(makeServer(), "/api/v1/projects");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("validation failure returns VALIDATION_FAILED", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db }),
      "/api/v1/parameters?risk=Critical"
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(repository.listParameters).not.toHaveBeenCalled();
  });

  it("forbidden submission returns FORBIDDEN", async () => {
    const db = makeDb();
    vi.mocked(service.submitParameterChanges).mockRejectedValue(
      new ApiError("FORBIDDEN", "Parameter edit permission is required.", 403)
    );

    const response = await requestJson<{ error: { code: string } }>(makeServer({ db }), "/api/v1/parameter-submission-rounds", {
      method: "POST",
      body: JSON.stringify({
        projectId: "aurora",
        items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }]
      })
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("submit route passes workflow assignees through to the service", async () => {
    const db = makeDb();
    const round = {
      id: "round-1",
      projectId: "aurora",
      projectName: "Aurora",
      submitter: "Riley Chen",
      createdAt: "2026-05-25T05:00:00.000Z",
      status: "hardware_review" as const,
      summary: "Parameter changes submitted.",
      items: []
    };
    vi.mocked(service.submitParameterChanges).mockResolvedValue(round);

    const response = await requestJson<{ item: typeof round }>(makeServer({ db }), "/api/v1/parameter-submission-rounds", {
      method: "POST",
      body: JSON.stringify({
        projectId: "aurora",
        items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }],
        assignees: {
          hardwareCommitterId: "u-hardware",
          softwareCommitterId: "u-software-committer",
          softwareUserId: "u-software-user"
        }
      })
    });

    expect(response.status).toBe(201);
    expect(service.submitParameterChanges).toHaveBeenCalledWith(
      db,
      makeAuth(),
      {
        projectId: "aurora",
        items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }],
        assignees: {
          hardwareCommitterId: "u-hardware",
          softwareCommitterId: "u-software-committer",
          softwareUserId: "u-software-user"
        }
      },
      { requestId: "test-request" }
    );
  });

  it("submit route preserves explicit binding draft identity", async () => {
    const db = makeDb();
    const round = {
      id: "round-binding-1",
      projectId: "aurora",
      projectName: "Aurora",
      submitter: "Riley Chen",
      createdAt: "2026-07-18T05:00:00.000Z",
      status: "hardware_review" as const,
      summary: "Binding draft submitted.",
      items: []
    };
    vi.mocked(service.submitParameterChanges).mockResolvedValue(round);

    const response = await requestJson<{ item: typeof round }>(makeServer({ db }), "/api/v1/parameter-submission-rounds", {
      method: "POST",
      body: JSON.stringify({
        projectId: "aurora",
        items: [
          {
            draftId: "draft-binding-1",
            projectParameterBindingId: "binding-1",
            parameterSpecId: "spec-1",
            targetValue: "<&gpio13 30 0>",
            reason: "Move GPIO line"
          }
        ],
        assignees: {
          hardwareCommitterId: "u-hardware",
          softwareCommitterId: "u-software-committer",
          softwareUserId: "u-software-user"
        }
      })
    });

    expect(response.status).toBe(201);
    expect(service.submitParameterChanges).toHaveBeenCalledWith(
      db,
      makeAuth(),
      expect.objectContaining({
        items: [
          {
            draftId: "draft-binding-1",
            projectParameterBindingId: "binding-1",
            parameterSpecId: "spec-1",
            targetValue: "<&gpio13 30 0>",
            reason: "Move GPIO line"
          }
        ]
      }),
      { requestId: "test-request" }
    );
  });

  it("submit route rejects partial or mixed binding draft identity", async () => {
    const db = makeDb();

    for (const item of [
      {
        draftId: "draft-binding-1",
        projectParameterBindingId: "binding-1",
        targetValue: "<&gpio13 30 0>",
        reason: "Missing spec"
      },
      {
        parameterId: "binding-1",
        draftId: "draft-binding-1",
        projectParameterBindingId: "binding-1",
        parameterSpecId: "spec-1",
        targetValue: "<&gpio13 30 0>",
        reason: "Mixed legacy and binding identity"
      }
    ]) {
      const response = await requestJson<{ error: { code: string } }>(makeServer({ db }), "/api/v1/parameter-submission-rounds", {
        method: "POST",
        body: JSON.stringify({ projectId: "aurora", items: [item] })
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect(service.submitParameterChanges).not.toHaveBeenCalled();
  });

  it("submit route rejects partial workflow assignees before the service", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db }),
      "/api/v1/parameter-submission-rounds",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "aurora",
          items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }],
          assignees: {
            hardwareCommitterId: "u-hardware"
          }
        })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(service.submitParameterChanges).not.toHaveBeenCalled();
  });

  it("review route can return merged request after service success", async () => {
    const db = makeDb();
    const mergedRequest = {
      id: "request-1",
      projectId: "aurora",
      parameterId: "param-1",
      module: "Charging Policy",
      title: "fast_charge_current_limit_ma",
      currentValue: "3100",
      targetValue: "3100",
      submitter: "Riley Chen",
      createdAt: "2026-05-25T05:00:00.000Z",
      createdAtTs: "2026-05-25T05:00:00.000Z",
      updatedAt: "2026-05-25T05:15:00.000Z",
      status: "merged" as const,
      aiSummary: "Merged request.",
      waitingHours: 0,
      aiSuggestion: {
        recommendation: "advance" as const,
        confidence: "high" as const,
        summary: "Merged request.",
        reasons: [],
        similarRequests: []
      },
      impact: []
    };
    vi.mocked(service.reviewChange).mockResolvedValue(mergedRequest);

    const response = await requestJson<{ item: typeof mergedRequest }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "parameter:edit", "parameter:review"] }) }),
      "/api/v1/parameter-change-requests/request-1/review",
      {
        method: "POST",
        body: JSON.stringify({ decision: "advance", expectedVersion: 7, note: "Merge approved." })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: mergedRequest });
    expect(service.reviewChange).toHaveBeenCalledWith(
      db,
      makeAuth({ permissions: ["parameter:view", "parameter:edit", "parameter:review"] }),
      {
        requestId: "request-1",
        decision: "advance",
        expectedVersion: 7,
        note: "Merge approved."
      },
      { requestId: "test-request" }
    );
  });

  it("apply import route passes request id for audit correlation", async () => {
    const db = makeDb();
    const appliedBatch = {
      id: "batch-1",
      projectId: "aurora",
      status: "applied" as const,
      sourceName: "admin-upload.csv",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [],
      createdAt: "2026-05-25T05:00:00.000Z",
      appliedAt: "2026-05-25T05:15:00.000Z"
    };
    vi.mocked(service.applyImportBatch).mockResolvedValue(appliedBatch);

    const response = await requestJson<{ item: typeof appliedBatch }>(
      makeServer({ db }),
      "/api/v1/parameter-import-batches/batch-1/apply",
      {
        method: "POST",
        body: JSON.stringify({ selectedItemIds: ["item-1"] })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: appliedBatch });
    expect(service.applyImportBatch).toHaveBeenCalledWith(
      db,
      makeAuth(),
      {
        batchId: "batch-1",
        selectedItemIds: ["item-1"]
      },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/parameter-import/parse-dts returns parsed rows for admin", async () => {
    const db = makeDb();
    const parsed = {
      format: "dts-full" as const,
      rows: [
        {
          name: "status",
          module: "demo_multi_instance/battery_checker@0",
          sourceNodePath: "demo_multi_instance/battery_checker@0/status",
          rawText: '"ok"',
          normalizedValue: '"ok"',
          valueType: "string-list"
        }
      ]
    };
    vi.mocked(service.parseDtsImportForAuth).mockReturnValue(parsed);

    const response = await requestJson<typeof parsed>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameter-import/parse-dts",
      {
        method: "POST",
        body: JSON.stringify({ sourceName: "board.dts", content: '/dts-v1/;\n&demo { status = "ok"; };\n' })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(parsed);
    expect(service.parseDtsImportForAuth).toHaveBeenCalledWith(
      makeAuth({ permissions: ["parameter:view", "admin:access"] }),
      {
        sourceName: "board.dts",
        content: '/dts-v1/;\n&demo { status = "ok"; };\n'
      }
    );
  });

  it("POST /api/v1/parameter-import/parse-dts rejects missing sourceName", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeAuth({ permissions: ["admin:access"] }) }),
      "/api/v1/parameter-import/parse-dts",
      {
        method: "POST",
        body: JSON.stringify({ content: "/dts-v1/;\n" })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(service.parseDtsImportForAuth).not.toHaveBeenCalled();
  });

  it("review route rejects conflicting path and body request ids", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db }),
      "/api/v1/parameter-change-requests/request-1/review",
      {
        method: "POST",
        body: JSON.stringify({ requestId: "request-2", decision: "advance" })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(service.reviewChange).not.toHaveBeenCalled();
  });

  it("review route rejects auth without parameter review or merge permission before service work", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string; message: string } }>(
      makeServer({
        db,
        auth: makeAuth({
          permissions: ["parameter:view", "parameter:edit"],
          roles: [{ projectId: "aurora", roleId: "hardware-user" }]
        })
      }),
      "/api/v1/parameter-change-requests/request-1/review",
      {
        method: "POST",
        body: JSON.stringify({ decision: "advance", expectedVersion: 7 })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Parameter review or merge permission is required."
    });
    expect(service.reviewChange).not.toHaveBeenCalled();
  });

  it("review route allows software-user merge role before service work", async () => {
    const db = makeDb();
    vi.mocked(service.reviewChange).mockResolvedValue({
      id: "request-1",
      parameterId: "param-1",
      module: "Charging",
      title: "Merge request",
      currentValue: "3000",
      targetValue: "3100",
      submitter: "Riley Chen",
      createdAt: "2026-05-25T05:00:00.000Z",
      createdAtTs: "2026-05-25T05:00:00.000Z",
      updatedAt: "2026-05-25T05:15:00.000Z",
      status: "merged",
      aiSummary: "Merged request.",
      waitingHours: 0,
      aiSuggestion: {
        recommendation: "advance",
        confidence: "high",
        summary: "Merged request.",
        reasons: [],
        similarRequests: []
      },
      impact: []
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameter-change-requests/request-1/review",
      {
        method: "POST",
        body: JSON.stringify({ decision: "advance", expectedVersion: 7 })
      }
    );

    expect(response.status).toBe(200);
    expect(service.reviewChange).toHaveBeenCalled();
  });

  it("GET /api/v1/parameters/admin/projects requires admin permission", async () => {
    const db = makeDb();
    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view"] }) }),
      "/api/v1/parameters/admin/projects"
    );

    expect(response.status).toBe(403);
    expect(repository.listProjectAdminSummaries).not.toHaveBeenCalled();
  });

  it("GET /api/v1/parameters/admin/projects returns admin summaries", async () => {
    const db = makeDb();
    const item = {
      id: "aurora",
      name: "Aurora",
      code: "AUR",
      status: "initialized",
      moduleCount: 3,
      parameterCount: 12,
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    vi.mocked(repository.listProjectAdminSummaries).mockResolvedValue([item]);

    const response = await requestJson<{ items: typeof item[] }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameters/admin/projects"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [item] });
  });

  it("POST /api/v1/parameters/admin/projects creates a project", async () => {
    const db = makeDb();
    const item = {
      id: "nova",
      name: "Nova",
      code: "NOVA",
      status: "initialized",
      moduleCount: 0,
      parameterCount: 0,
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    vi.mocked(projectService.createProjectForAuth).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameters/admin/projects",
      {
        method: "POST",
        body: JSON.stringify({ name: "Nova", code: "NOVA" })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(projectService.createProjectForAuth).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      {
        id: "nova",
        name: "Nova",
        code: "NOVA"
      },
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it("DELETE /api/v1/parameters/admin/projects/:projectId deletes an empty project", async () => {
    const db = makeDb();
    vi.mocked(repository.deleteProject).mockResolvedValue({ deleted: true });

    const response = await requestJson<{ ok: true }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameters/admin/projects/nova",
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(repository.deleteProject).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      projectId: "nova"
    });
  });

  it("DELETE /api/v1/parameters/admin/projects/:projectId returns 404 when project is missing", async () => {
    const db = makeDb();
    vi.mocked(repository.deleteProject).mockResolvedValue({ deleted: false, reason: "not_found" });

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameters/admin/projects/missing",
      { method: "DELETE" }
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/v1/parameter-modules returns tree items for viewers", async () => {
    const db = makeDb();
    const module = {
      id: "pm-a",
      parentId: null,
      name: "Power",
      path: "pm-a",
      depth: 1,
      sortOrder: 0,
      description: "",
      scope: ""
    };
    vi.mocked(service.listParameterModulesForAuth).mockResolvedValue([module]);

    const response = await requestJson<{ items: typeof module[] }>(makeServer({ db }), "/api/v1/parameter-modules");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [module] });
    expect(service.listParameterModulesForAuth).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) })
    );
  });

  it("POST /api/v1/parameter-modules requires admin permission", async () => {
    const db = makeDb();
    vi.mocked(service.createParameterModuleForAuth).mockRejectedValue(
      new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403)
    );

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db }),
      "/api/v1/parameter-modules",
      {
        method: "POST",
        body: JSON.stringify({ name: "Battery" })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("POST /api/v1/parameter-modules creates a module for admin", async () => {
    const db = makeDb();
    const item = {
      id: "pm-b",
      parentId: "pm-a",
      name: "Battery",
      path: "pm-a/pm-b",
      depth: 2,
      sortOrder: 0,
      description: "",
      scope: ""
    };
    vi.mocked(service.createParameterModuleForAuth).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameter-modules",
      {
        method: "POST",
        body: JSON.stringify({ name: "Battery", parentId: "pm-a" })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(service.createParameterModuleForAuth).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      { name: "Battery", parentId: "pm-a" },
      expect.objectContaining({ requestId: "test-request" })
    );
  });

  it("POST /api/v1/parameter-modules/:moduleId/move reparents a module", async () => {
    const db = makeDb();
    const item = {
      id: "pm-b",
      parentId: "pm-x",
      name: "Battery",
      path: "pm-x/pm-b",
      depth: 2,
      sortOrder: 0,
      description: "",
      scope: ""
    };
    vi.mocked(service.moveParameterModuleForAuth).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameter-modules/pm-b/move",
      {
        method: "POST",
        body: JSON.stringify({ parentId: "pm-x" })
      }
    );

    expect(response.status).toBe(200);
    expect(service.moveParameterModuleForAuth).toHaveBeenCalledWith(
      db,
      expect.any(Object),
      "pm-b",
      { parentId: "pm-x" },
      expect.any(Object)
    );
  });

  it("DELETE /api/v1/parameter-modules/:moduleId returns 204 for admin", async () => {
    const db = makeDb();
    vi.mocked(service.deleteParameterModuleForAuth).mockResolvedValue(undefined);

    const response = await requestJson(
      makeServer({ db, auth: makeAuth({ permissions: ["parameter:view", "admin:access"] }) }),
      "/api/v1/parameter-modules/pm-empty",
      { method: "DELETE" }
    );

    expect(response.status).toBe(204);
    expect(service.deleteParameterModuleForAuth).toHaveBeenCalledWith(
      db,
      expect.any(Object),
      "pm-empty",
      expect.any(Object)
    );
  });
});
