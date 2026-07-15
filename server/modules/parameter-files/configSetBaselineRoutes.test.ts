import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterFileRoutes } from "./routes";
import * as baselineService from "./baselineService";
import * as configSetService from "./configSetService";
import * as exportService from "./exportService";

vi.mock("./service", () => ({
  uploadProjectParameterFile: vi.fn(),
  getProjectParameterFileContent: vi.fn(),
  listProjectParameterFilesForAuth: vi.fn()
}));

vi.mock("./repository", () => ({
  getFileVersionById: vi.fn(),
  getProjectParameterFileById: vi.fn(),
  listFileVersions: vi.fn(),
  listProjectParameterFiles: vi.fn()
}));

vi.mock("../parameters/repository", () => ({
  listOpenConflicts: vi.fn()
}));

vi.mock("./syncService", () => ({
  syncFileVersion: vi.fn()
}));

vi.mock("./conflictService", () => ({
  resolveParameterFileConflict: vi.fn()
}));

vi.mock("./configSetService", () => ({
  createConfigSet: vi.fn(),
  listConfigSets: vi.fn(),
  addConfigSetFile: vi.fn(),
  removeConfigSetFile: vi.fn(),
  updateConfigSet: vi.fn(),
  ensureDefaultConfigSet: vi.fn()
}));

vi.mock("./baselineService", () => ({
  createBaseline: vi.fn(),
  listBaselines: vi.fn(),
  getBaseline: vi.fn(),
  compareBaseline: vi.fn(),
  rollbackToBaseline: vi.fn(),
  releaseBaseline: vi.fn()
}));

vi.mock("./exportService", () => ({
  exportConfigSet: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "admin:access"],
    ...overrides
  };
}

function makeViewOnlyAuth(): AuthContext {
  return makeAuth({ permissions: ["parameter:view"] });
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

const configSet = {
  id: "cs-1",
  organizationId: "org-1",
  projectId: "project-1",
  name: "default",
  description: "Primary config set",
  createdAt: "2026-07-14T09:00:00.000Z",
  updatedAt: "2026-07-14T09:00:00.000Z"
};

const baseline = {
  id: "bl-1",
  organizationId: "org-1",
  configSetId: "cs-1",
  name: "v1.0",
  status: "draft" as const,
  createdBy: "user-1",
  createdAt: "2026-07-14T09:01:00.000Z"
};

describe("config set and baseline routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v1/projects/:projectId/config-sets returns 201 with config set dto", async () => {
    const db = makeDb();
    vi.mocked(configSetService.createConfigSet).mockResolvedValue(configSet);

    const response = await requestJson<{ item: typeof configSet }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets",
      {
        method: "POST",
        body: JSON.stringify({ name: "default", description: "Primary config set" })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.item).toEqual(configSet);
    expect(configSetService.createConfigSet).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      {
        projectId: "project-1",
        name: "default",
        description: "Primary config set",
        derivedFromId: undefined
      },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/projects/:projectId/config-sets returns 200 with items", async () => {
    const db = makeDb();
    vi.mocked(configSetService.listConfigSets).mockResolvedValue([configSet]);

    const response = await requestJson<{ items: typeof configSet[] }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([configSet]);
    expect(configSetService.listConfigSets).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "project-1"
    );
  });

  it("POST /api/v1/projects/:projectId/config-sets/:configSetId/files returns 201 with membership dto", async () => {
    const db = makeDb();
    const membership = { configSetId: "cs-1", fileId: "file-1", role: "base" as const, sortOrder: 0 };
    vi.mocked(configSetService.addConfigSetFile).mockResolvedValue(membership);

    const response = await requestJson<{ item: typeof membership }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets/cs-1/files",
      {
        method: "POST",
        body: JSON.stringify({ fileId: "file-1", role: "base", sortOrder: 0 })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.item).toEqual(membership);
    expect(configSetService.addConfigSetFile).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      { configSetId: "cs-1", fileId: "file-1", role: "base", sortOrder: 0 },
      { requestId: "test-request" }
    );
  });

  it("DELETE /api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId returns 200", async () => {
    const db = makeDb();
    vi.mocked(configSetService.removeConfigSetFile).mockResolvedValue(undefined);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets/cs-1/files/file-1",
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    expect(configSetService.removeConfigSetFile).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      { configSetId: "cs-1", fileId: "file-1" },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/projects/:projectId/config-sets/:configSetId/baselines returns 201 with baseline dto", async () => {
    const db = makeDb();
    vi.mocked(baselineService.createBaseline).mockResolvedValue(baseline);

    const response = await requestJson<{ item: typeof baseline }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets/cs-1/baselines",
      {
        method: "POST",
        body: JSON.stringify({ name: "v1.0", notes: "Initial baseline" })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.item).toEqual(baseline);
    expect(baselineService.createBaseline).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      { configSetId: "cs-1", name: "v1.0", notes: "Initial baseline" },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/projects/:projectId/config-sets/:configSetId/baselines returns 200 with items", async () => {
    const db = makeDb();
    vi.mocked(baselineService.listBaselines).mockResolvedValue([baseline]);

    const response = await requestJson<{ items: typeof baseline[] }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/config-sets/cs-1/baselines"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([baseline]);
    expect(baselineService.listBaselines).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "cs-1"
    );
  });

  it("GET /api/v1/projects/:projectId/baselines/:baselineId/compare returns 200 with comparison", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const comparison = {
      baselineId: "bl-1",
      members: [{ fileId: "file-1", status: "unchanged" as const }]
    };
    vi.mocked(baselineService.compareBaseline).mockResolvedValue(comparison);

    const response = await requestJson<{ item: typeof comparison }>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/baselines/bl-1/compare"
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(comparison);
    expect(baselineService.compareBaseline).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "bl-1",
      { objectStore }
    );
  });

  it("POST /api/v1/projects/:projectId/baselines/:baselineId/rollback returns 200 with rollback summary", async () => {
    const db = makeDb();
    const rollbackResult = { baselineId: "bl-1", restored: 2 };
    vi.mocked(baselineService.rollbackToBaseline).mockResolvedValue(rollbackResult);

    const response = await requestJson<{ item: typeof rollbackResult }>(
      makeServer({ db }),
      "/api/v1/projects/project-1/baselines/bl-1/rollback",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(rollbackResult);
    expect(baselineService.rollbackToBaseline).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "bl-1",
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/projects/:projectId/baselines/:baselineId/release returns 200 with baseline and gate", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const gate = {
      ok: true,
      mode: "block" as const,
      requiresConfirmation: false,
      diagnostics: [],
      compiler: "dtc" as const
    };
    const releasedBaseline = { ...baseline, status: "released" as const };
    vi.mocked(baselineService.releaseBaseline).mockResolvedValue({ baseline: releasedBaseline, gate });

    const response = await requestJson<{ item: typeof releasedBaseline; gate: typeof gate }>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/baselines/bl-1/release",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(releasedBaseline);
    expect(response.body.gate).toEqual(gate);
    expect(baselineService.releaseBaseline).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "bl-1",
      { objectStore, validator: undefined },
      { requestId: "test-request" }
    );
  });

  it("GET /api/v1/projects/:projectId/config-sets/:configSetId/export returns 200 with export payload", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const exportResult = {
      manifest: {
        configSetId: "cs-1",
        name: "default",
        projectId: "project-1",
        exportedAt: "2026-07-14T09:02:00.000Z",
        members: []
      },
      files: []
    };
    vi.mocked(exportService.exportConfigSet).mockResolvedValue(exportResult);

    const response = await requestJson<typeof exportResult>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/config-sets/cs-1/export"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(exportResult);
    expect(exportService.exportConfigSet).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organization: expect.objectContaining({ id: "org-1" }) }),
      "cs-1",
      { objectStore, validator: undefined },
      { requestId: "test-request" }
    );
  });

  it("returns 403 when auth lacks admin:access for config-set routes", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeViewOnlyAuth() }),
      "/api/v1/projects/project-1/config-sets",
      { method: "POST", body: JSON.stringify({ name: "default" }) }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(configSetService.createConfigSet).not.toHaveBeenCalled();
  });

  it("returns 403 when auth lacks admin:access for baseline release", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore, auth: makeViewOnlyAuth() }),
      "/api/v1/projects/project-1/baselines/bl-1/release",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(baselineService.releaseBaseline).not.toHaveBeenCalled();
  });

  it("returns 409 with diagnostics when releaseBaseline fails validation gate", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const diagnostics = [
      { file: "board.dts", line: 12, severity: "error" as const, message: "syntax error" }
    ];
    vi.mocked(baselineService.releaseBaseline).mockRejectedValue(
      new ApiError("CONFLICT", "DTS validation failed.", 409, {
        code: "dts-validation-failed",
        diagnostics,
        mode: "block",
        compiler: "dtc"
      })
    );

    const response = await requestJson<{ error: { code: string; details: { diagnostics: typeof diagnostics } } }>(
      makeServer({ db, objectStore }),
      "/api/v1/projects/project-1/baselines/bl-1/release",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(response.body.error.details.diagnostics).toEqual(diagnostics);
  });
});
