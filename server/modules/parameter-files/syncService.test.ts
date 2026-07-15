import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAuditEvent } from "../audit/repository";
import { syncFileVersion } from "./syncService";
import { detectFileUiDraftConflict } from "./conflictService";
import { getFileVersionById, getProjectParameterFileById } from "./repository";
import {
  bindParameterSource,
  findProjectValueByDefinition,
  findProjectValueBySource,
  upsertFileSyncDraft
} from "../parameters/repository";

vi.mock("./repository", () => ({
  getProjectParameterFileById: vi.fn(),
  getFileVersionById: vi.fn()
}));

vi.mock("./conflictService", () => ({
  detectFileUiDraftConflict: vi.fn()
}));

vi.mock("../parameters/repository", () => ({
  findProjectValueBySource: vi.fn(),
  findProjectValueByDefinition: vi.fn(),
  bindParameterSource: vi.fn(),
  upsertFileSyncDraft: vi.fn()
}));

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn()
}));

const mockedGetProjectParameterFileById = vi.mocked(getProjectParameterFileById);
const mockedGetFileVersionById = vi.mocked(getFileVersionById);
const mockedFindProjectValueBySource = vi.mocked(findProjectValueBySource);
const mockedFindProjectValueByDefinition = vi.mocked(findProjectValueByDefinition);
const mockedBindParameterSource = vi.mocked(bindParameterSource);
const mockedUpsertFileSyncDraft = vi.mocked(upsertFileSyncDraft);
const mockedDetectFileUiDraftConflict = vi.mocked(detectFileUiDraftConflict);
const mockedCreateAuditEvent = vi.mocked(createAuditEvent);

const fakeDb = {
  query: vi.fn()
};

function adminAuth(): AuthContext {
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
    permissions: ["admin:access"]
  };
}

function mockUploadVersion() {
  mockedGetFileVersionById.mockResolvedValue({
    id: "version-1",
    fileId: "file-1",
    versionNumber: 1,
    checksum: "checksum",
    sizeBytes: 10,
    origin: "upload",
    createdAt: "2026-07-11T09:01:00.000Z",
    parsedIndex: { "battery/temp_max": { value: "85" } }
  });
}

describe("syncFileVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockedGetProjectParameterFileById.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      fileName: "config.json",
      format: "json",
      enabled: true,
      updatedAt: "2026-07-11T09:00:00.000Z"
    });
    mockedUpsertFileSyncDraft.mockResolvedValue({
      id: "ppv-1-user-1-file-sync",
      projectId: "project-1",
      parameterId: "ppv-1",
      targetValue: "85",
      reason: "Synced from config.json:battery/temp_max",
      updatedAt: "2026-07-11T09:02:00.000Z"
    });
  });

  it("JSON file index changes value 80->85 creates file_sync draft", async () => {
    mockUploadVersion();
    mockedFindProjectValueBySource.mockResolvedValue(null);
    mockedFindProjectValueByDefinition.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    const result = await syncFileVersion(fakeDb, adminAuth(), {
      fileId: "file-1",
      versionId: "version-1"
    });

    expect(result).toEqual({
      draftsCreated: 1,
      unchanged: 0,
      unmatched: 0,
      skipped: false,
      identityFallbackUses: 1
    });
    expect(mockedUpsertFileSyncDraft).toHaveBeenCalledWith(fakeDb, {
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      userId: "user-1",
      targetValue: "85",
      reason: "Synced from config.json:battery/temp_max",
      originFileVersionId: "version-1"
    });
    expect(mockedBindParameterSource).toHaveBeenCalledWith(fakeDb, {
      projectParameterValueId: "ppv-1",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max"
    });
    expect(mockedDetectFileUiDraftConflict).toHaveBeenCalledWith(fakeDb, {
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId: "ppv-1-user-1-file-sync",
      fileValue: "85"
    });
  });

  it("same value only binds source and skips draft", async () => {
    mockUploadVersion();
    mockedFindProjectValueBySource.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "85"
    });

    const result = await syncFileVersion(fakeDb, adminAuth(), {
      fileId: "file-1",
      versionId: "version-1"
    });

    expect(result).toEqual({
      draftsCreated: 0,
      unchanged: 1,
      unmatched: 0,
      skipped: false,
      identityFallbackUses: 0
    });
    expect(mockedUpsertFileSyncDraft).not.toHaveBeenCalled();
    expect(mockedBindParameterSource).toHaveBeenCalledTimes(1);
  });

  it("writeback origin version skips sync entirely", async () => {
    mockedGetFileVersionById.mockResolvedValue({
      id: "version-1",
      fileId: "file-1",
      versionNumber: 1,
      checksum: "checksum",
      sizeBytes: 10,
      origin: "writeback",
      createdAt: "2026-07-11T09:01:00.000Z",
      parsedIndex: { "battery/temp_max": { value: "85" } }
    });

    const result = await syncFileVersion(fakeDb, adminAuth(), {
      fileId: "file-1",
      versionId: "version-1"
    });

    expect(result).toEqual({
      draftsCreated: 0,
      unchanged: 0,
      unmatched: 0,
      skipped: true,
      identityFallbackUses: 0
    });
    expect(mockedFindProjectValueBySource).not.toHaveBeenCalled();
    expect(mockedFindProjectValueByDefinition).not.toHaveBeenCalled();
    expect(mockedBindParameterSource).not.toHaveBeenCalled();
    expect(mockedUpsertFileSyncDraft).not.toHaveBeenCalled();
  });

  it("warn mode allows (name,module) fallback and writes an identity-fallback audit event", async () => {
    vi.stubEnv("DTS_IDENTITY_FALLBACK_MODE", "warn");
    mockUploadVersion();
    mockedFindProjectValueBySource.mockResolvedValue(null);
    mockedFindProjectValueByDefinition.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    const result = await syncFileVersion(fakeDb, adminAuth(), {
      fileId: "file-1",
      versionId: "version-1"
    });

    expect(result.identityFallbackUses).toBe(1);
    expect(result.draftsCreated).toBe(1);
    expect(mockedCreateAuditEvent).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({
        kind: "parameter-file-identity-fallback",
        action: "warn",
        metadata: expect.objectContaining({
          mode: "warn",
          sourceNodePath: "battery/temp_max",
          fallbackName: "temp_max",
          fallbackModule: "battery"
        })
      })
    );
  });

  it("deny mode refuses (name,module) fallback with VALIDATION_FAILED 409", async () => {
    vi.stubEnv("DTS_IDENTITY_FALLBACK_MODE", "deny");
    mockUploadVersion();
    mockedFindProjectValueBySource.mockResolvedValue(null);
    mockedFindProjectValueByDefinition.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    await expect(
      syncFileVersion(fakeDb, adminAuth(), {
        fileId: "file-1",
        versionId: "version-1"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 409
    });

    expect(mockedFindProjectValueByDefinition).not.toHaveBeenCalled();
    expect(mockedUpsertFileSyncDraft).not.toHaveBeenCalled();
    expect(mockedBindParameterSource).not.toHaveBeenCalled();
  });
});
