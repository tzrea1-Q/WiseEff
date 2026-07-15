import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAuditEvent } from "../audit/repository";
import { getProjectParameterFileById } from "../parameter-files/repository";
import {
  bindParameterSource,
  findProjectValueByDefinition,
  findProjectValueBySource,
  insertProjectParameterValueWithSource
} from "./repository";
import { resolveStructuredEditToParameter } from "./service";

vi.mock("../parameter-files/repository", () => ({
  getProjectParameterFileById: vi.fn()
}));

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return {
    ...actual,
    findProjectValueBySource: vi.fn(),
    findProjectValueByDefinition: vi.fn(),
    bindParameterSource: vi.fn(),
    insertProjectParameterValueWithSource: vi.fn()
  };
});

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn()
}));

const mockedGetFile = vi.mocked(getProjectParameterFileById);
const mockedBySource = vi.mocked(findProjectValueBySource);
const mockedByDefinition = vi.mocked(findProjectValueByDefinition);
const mockedBind = vi.mocked(bindParameterSource);
const mockedInsert = vi.mocked(insertProjectParameterValueWithSource);
const mockedAudit = vi.mocked(createAuditEvent);

const fakeDb = { query: vi.fn(), transaction: vi.fn() };

function auth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:edit", "admin:access"]
  };
}

const edit = {
  fileId: "file-1",
  nodePath: "battery",
  propertyName: "temp_max",
  rawText: "<85>"
};

describe("resolveStructuredEditToParameter identity fallback modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockedGetFile.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      fileName: "board.dts",
      format: "dts",
      enabled: true,
      updatedAt: "2026-07-11T09:00:00.000Z"
    });
  });

  it("allow mode binds an existing (name,module) match", async () => {
    mockedBySource.mockResolvedValue(null);
    mockedByDefinition.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    const resolved = await resolveStructuredEditToParameter(fakeDb, auth(), "project-1", edit);

    expect(resolved.id).toBe("ppv-1");
    expect(mockedBind).toHaveBeenCalled();
    expect(mockedInsert).not.toHaveBeenCalled();
  });

  it("warn mode binds fallback and writes an identity-fallback audit event", async () => {
    vi.stubEnv("DTS_IDENTITY_FALLBACK_MODE", "warn");
    mockedBySource.mockResolvedValue(null);
    mockedByDefinition.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    await resolveStructuredEditToParameter(fakeDb, auth(), "project-1", edit);

    expect(mockedAudit).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({
        kind: "parameter-file-identity-fallback",
        action: "warn",
        metadata: expect.objectContaining({
          mode: "warn",
          sourceNodePath: "battery/temp_max"
        })
      })
    );
  });

  it("deny mode skips (name,module) hit and inserts a new PPV+source binding", async () => {
    vi.stubEnv("DTS_IDENTITY_FALLBACK_MODE", "deny");
    mockedBySource.mockResolvedValue(null);
    mockedByDefinition.mockResolvedValue({
      id: "ppv-existing",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });
    mockedInsert.mockResolvedValue({
      id: "ppv-new",
      projectId: "project-1",
      parameterDefinitionId: "pd-new",
      name: "temp_max",
      module: "battery",
      currentValue: ""
    });

    const resolved = await resolveStructuredEditToParameter(fakeDb, auth(), "project-1", edit);

    expect(resolved.id).toBe("ppv-new");
    expect(mockedByDefinition).not.toHaveBeenCalled();
    expect(mockedBind).not.toHaveBeenCalled();
    expect(mockedInsert).toHaveBeenCalled();
  });
});
