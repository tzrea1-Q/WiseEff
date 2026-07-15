import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterFileRoutes } from "./routes";
import * as repository from "./repository";
import * as structuralReadService from "./structuralReadService";

vi.mock("./service", () => ({
  uploadProjectParameterFile: vi.fn(),
  getProjectParameterFileContent: vi.fn(),
  listProjectParameterFilesForAuth: vi.fn(),
}));

vi.mock("./repository", () => ({
  getFileVersionById: vi.fn(),
  getProjectParameterFileById: vi.fn(),
  listFileVersions: vi.fn(),
  listProjectParameterFiles: vi.fn(),
}));

vi.mock("../parameters/repository", () => ({
  listOpenConflicts: vi.fn(),
}));

vi.mock("./syncService", () => ({
  syncFileVersion: vi.fn(),
}));

vi.mock("./conflictService", () => ({
  resolveParameterFileConflict: vi.fn(),
}));

vi.mock("./structuralReadService", () => ({
  getParameterFileVersionStructure: vi.fn(),
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "admin:access"],
    ...overrides,
  };
}

function makeViewOnlyAuth(): AuthContext {
  return makeAuth({ permissions: ["parameter:view"] });
}

function makeNoViewAuth(): AuthContext {
  return makeAuth({ permissions: [] });
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn(),
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerParameterFileRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth(),
  });
  return createHttpServer(router);
}

const file = {
  id: "file-1",
  projectId: "project-1",
  fileName: "sample.dts",
  format: "dts" as const,
  enabled: true,
  currentVersionId: "ver-1",
  currentVersionNumber: 1,
  updatedAt: "2026-07-14T09:01:00.000Z",
};

const version = {
  id: "ver-1",
  fileId: "file-1",
  versionNumber: 1,
  storageKey: "k",
  checksum: "c",
  sizeBytes: 1,
  parsedIndex: {},
  origin: "upload" as const,
  createdAt: "2026-07-14T09:01:00.000Z",
  createdByUserId: "user-1",
};

const structureBody = {
  nodes: [
    {
      nodePath: "demo_bool",
      name: "demo_bool",
      labels: ["demo_bool"],
      properties: [{ name: "weak_source_sleep_enabled", valueType: "bool", rawText: "", normalizedValue: "true" }],
      phandleRefs: [],
    },
  ],
};

describe("structured read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET .../versions/:versionId/structure returns 200 with nodes for viewers", async () => {
    const db = makeDb();
    vi.mocked(repository.getProjectParameterFileById).mockResolvedValue(file);
    vi.mocked(repository.getFileVersionById).mockResolvedValue(version);
    vi.mocked(structuralReadService.getParameterFileVersionStructure).mockResolvedValue(structureBody);

    const response = await requestJson<typeof structureBody>(
      makeServer({ db, auth: makeViewOnlyAuth() }),
      "/api/v1/projects/project-1/parameter-files/file-1/versions/ver-1/structure",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(structureBody);
    expect(structuralReadService.getParameterFileVersionStructure).toHaveBeenCalledWith(db, "ver-1");
  });

  it("GET .../versions/:versionId/structure returns 403 without parameter:view", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeNoViewAuth() }),
      "/api/v1/projects/project-1/parameter-files/file-1/versions/ver-1/structure",
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(structuralReadService.getParameterFileVersionStructure).not.toHaveBeenCalled();
  });

  it("GET .../versions/:versionId/structure returns 404 for unknown version", async () => {
    const db = makeDb();
    vi.mocked(repository.getProjectParameterFileById).mockResolvedValue(file);
    vi.mocked(repository.getFileVersionById).mockResolvedValue(null);

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeViewOnlyAuth() }),
      "/api/v1/projects/project-1/parameter-files/file-1/versions/missing/structure",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(structuralReadService.getParameterFileVersionStructure).not.toHaveBeenCalled();
  });
});
