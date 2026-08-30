import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestAuthContext } from "../../testing/authContext";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterFileRoutes } from "./routes";
import * as service from "./service";
import * as candidateService from "./candidateService";
import * as configSetService from "./configSetService";
import * as conflictService from "./conflictService";

vi.mock("./service", () => ({
  uploadProjectParameterFile: vi.fn(),
  getProjectParameterFileContent: vi.fn(),
  listProjectParameterFilesForAuth: vi.fn(),
  rollbackProjectParameterFileVersion: vi.fn()
}));

vi.mock("./candidateService", () => ({
  abandonCandidate: vi.fn(),
  activateCandidate: vi.fn(),
  createCandidate: vi.fn(),
  getCandidate: vi.fn(),
  getCandidateContent: vi.fn(),
  getCandidateImpact: vi.fn(),
  listCandidates: vi.fn(),
  recomputeCandidateImpact: vi.fn()
}));

vi.mock("./repository", () => ({
  getFileVersionById: vi.fn(),
  getProjectParameterFileById: vi.fn(),
  listFileVersions: vi.fn(),
  listProjectParameterFiles: vi.fn()
}));

vi.mock("../parameters/fileSyncConflictRepository", () => ({
  listOpenConflicts: vi.fn()
}));

vi.mock("./syncService", () => ({
  syncFileVersion: vi.fn()
}));

vi.mock("./conflictService", () => ({
  resolveParameterFileConflict: vi.fn(),
  previewBulkConflictResolution: vi.fn(),
  resolveConflictsBulk: vi.fn()
}));

vi.mock("./configSetService", () => ({
  addConfigSetFile: vi.fn(),
  createConfigSet: vi.fn(),
  listConfigSets: vi.fn(),
  removeConfigSetFile: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      organizationName: "ChargeLab",
      permissions: ["parameter:view", "admin:access"]
    }),
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeObjectStore(): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn()
  };
}

function makeServer(options: { db?: Database; objectStore?: ObjectStore; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerParameterFileRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

describe("parameter file routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET config sets allows active parameter viewers without admin permission", async () => {
    const db = makeDb();
    const items = [{ id: "set-1", name: "default" }];
    vi.mocked(configSetService.listConfigSets).mockResolvedValue(items as never);

    const response = await requestJson<{ items: typeof items }>(
      makeServer({
        db,
        auth: makeAuth({
          roles: [{ projectId: "project-1", roleId: "software-user" }],
          permissions: ["parameter:view", "parameter:edit"]
        })
      }),
      "/api/v1/projects/project-1/config-sets"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items });
    expect(configSetService.listConfigSets).toHaveBeenCalledWith(db, expect.any(Object), "project-1");
  });

  it("POST /api/v1/projects/:projectId/parameter-files returns 201 with file dto", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");
    const file = {
      id: "file-1",
      projectId: "project-1",
      fileName: "config.json",
      format: "json" as const,
      enabled: true,
      currentVersionId: "ver-1",
      currentVersionNumber: 1,
      updatedAt: "2026-07-11T09:01:00.000Z"
    };
    const version = {
      id: "ver-1",
      fileId: "file-1",
      versionNumber: 1,
      checksum: "checksum-config",
      sizeBytes: bytes.byteLength,
      parsedIndex: {},
      origin: "upload" as const,
      createdAt: "2026-07-11T09:01:00.000Z",
      createdByUserId: "user-1"
    };
    vi.mocked(service.uploadProjectParameterFile).mockResolvedValue({ file, version });

    const response = await requestJson<{ item: typeof file }>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/parameter-files",
      {
        method: "POST",
        body: JSON.stringify({
          fileName: "config.json",
          contentBase64: bytes.toString("base64")
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.item).toEqual(file);
    expect(service.uploadProjectParameterFile).toHaveBeenCalledWith(
      db,
      objectStore,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      {
        projectId: "project-1",
        fileName: "config.json",
        bytes
      },
      { requestId: "test-request" }
    );
  });

  it("GET candidate response uses the public lifecycle projection without trusted correlation", async () => {
    vi.mocked(candidateService.getCandidate).mockResolvedValue({
      id: "candidate-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "config.dts",
      format: "dts",
      status: "ready",
      parsedIndex: {},
      diagnostics: [],
      impact: {},
      blockers: [],
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      createdByUserId: "user-1"
    });

    const response = await requestJson<{ item: Record<string, unknown> }>(
      makeServer({ db: makeDb() }),
      "/api/v1/projects/project-1/parameter-file-candidates/candidate-1"
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({ id: "candidate-1", status: "ready" });
    expect(response.body.item).not.toHaveProperty("initiatorSessionId");
    expect(response.body.item).not.toHaveProperty("initiatorToolCallId");
    expect(response.body.item).not.toHaveProperty("initiatorApprovalId");
    expect(response.body.item).not.toHaveProperty("initiatorSystemName");
  });

  it("POST resolve accepts optional reason", async () => {
    const db = makeDb();
    const item = { id: "conflict-1", status: "resolved_file" };
    vi.mocked(conflictService.resolveParameterFileConflict).mockResolvedValue(item as never);

    const response = await requestJson<{ item: typeof item }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/parameter-file-conflicts/conflict-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ resolution: "file", reason: "keep file" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(item);
    expect(conflictService.resolveParameterFileConflict).toHaveBeenCalledWith(
      db,
      expect.any(Object),
      { conflictId: "conflict-1", resolution: "file", reason: "keep file" },
      { requestId: expect.any(String) }
    );
  });

  it("POST bulk-preview and bulk-resolve wire conflict service", async () => {
    const db = makeDb();
    const preview = {
      resolution: "ui" as const,
      eligible: [{ id: "conflict-1" }],
      ineligible: [],
      impact: { eligibleCount: 1, ineligibleCount: 0, parameterNames: ["temp_max"], fileIds: ["file-1"] }
    };
    const bulk = { resolved: [{ id: "conflict-1" }], skipped: [] };
    vi.mocked(conflictService.previewBulkConflictResolution).mockResolvedValue(preview as never);
    vi.mocked(conflictService.resolveConflictsBulk).mockResolvedValue(bulk as never);

    const previewResponse = await requestJson<typeof preview>(
      makeServer({ db }),
      "/api/v1/projects/project-1/parameter-file-conflicts/bulk-preview",
      {
        method: "POST",
        body: JSON.stringify({ resolution: "ui", conflictIds: ["conflict-1"] })
      }
    );
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toEqual(preview);
    expect(conflictService.previewBulkConflictResolution).toHaveBeenCalledWith(
      db,
      expect.any(Object),
      { projectId: "project-1", resolution: "ui", conflictIds: ["conflict-1"] }
    );

    const resolveResponse = await requestJson<typeof bulk>(
      makeServer({ db }),
      "/api/v1/projects/project-1/parameter-file-conflicts/bulk-resolve",
      {
        method: "POST",
        body: JSON.stringify({ resolution: "ui", conflictIds: ["conflict-1"], reason: "batch" })
      }
    );
    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body).toEqual(bulk);
    expect(conflictService.resolveConflictsBulk).toHaveBeenCalledWith(
      db,
      expect.any(Object),
      { projectId: "project-1", resolution: "ui", conflictIds: ["conflict-1"], reason: "batch" },
      { requestId: expect.any(String) }
    );
  });

  it("POST version rollback returns 201 with the new pointer version", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const file = {
      id: "file-1",
      projectId: "project-1",
      fileName: "config.json",
      format: "json" as const,
      enabled: true,
      currentVersionId: "ver-3",
      currentVersionNumber: 3,
      updatedAt: "2026-08-17T09:00:00.000Z"
    };
    const version = {
      id: "ver-3",
      fileId: "file-1",
      versionNumber: 3,
      checksum: "checksum-rollback",
      sizeBytes: 12,
      parsedIndex: {},
      origin: "rollback" as const,
      createdAt: "2026-08-17T09:00:00.000Z",
      createdByUserId: "user-1",
      createdByDisplayName: "Riley Chen"
    };
    vi.mocked(service.rollbackProjectParameterFileVersion).mockResolvedValue({ file, version });

    const { getProjectParameterFileById } = await import("./repository");
    vi.mocked(getProjectParameterFileById).mockResolvedValue(file as never);

    const response = await requestJson<{ item: typeof version; file: typeof file }>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/parameter-files/file-1/versions/ver-1/rollback",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(201);
    expect(response.body.item.origin).toBe("rollback");
    expect(response.body.file.currentVersionId).toBe("ver-3");
    expect(service.rollbackProjectParameterFileVersion).toHaveBeenCalledWith(
      db,
      objectStore,
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      { projectId: "project-1", fileId: "file-1", versionId: "ver-1" },
      { requestId: "test-request" }
    );
  });
});
