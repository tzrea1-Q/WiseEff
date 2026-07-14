import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterFileRoutes } from "./routes";
import * as service from "./service";

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
});
