import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterFileRoutes } from "./routes";
import * as dtsSearchService from "./dtsSearchService";

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

vi.mock("./dtsSearchService", () => ({
  searchProjectDts: vi.fn(),
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

const hitsBody = {
  hits: [
    {
      fileId: "file-1",
      fileName: "sample.dts",
      versionId: "ver-1",
      nodePath: "amba/i2c@XXXX0000/chip@6E",
      snippet: "amba/i2c@XXXX0000/chip@6E",
    },
  ],
};

describe("dts search routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/projects/:projectId/dts-search returns 200 with hits for viewers", async () => {
    const db = makeDb();
    vi.mocked(dtsSearchService.searchProjectDts).mockResolvedValue(hitsBody);

    const response = await requestJson<typeof hitsBody>(
      makeServer({ db, auth: makeViewOnlyAuth() }),
      "/api/v1/projects/project-1/dts-search?q=chip%406E&by=path",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(hitsBody);
    expect(dtsSearchService.searchProjectDts).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      projectId: "project-1",
      q: "chip@6E",
      by: "path",
    });
  });

  it("GET /api/v1/projects/:projectId/dts-search returns 403 without parameter:view", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, auth: makeNoViewAuth() }),
      "/api/v1/projects/project-1/dts-search?q=chip%406E&by=path",
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(dtsSearchService.searchProjectDts).not.toHaveBeenCalled();
  });
});
