import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { syncFileVersion } from "./syncService";
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

vi.mock("../parameters/repository", () => ({
  findProjectValueBySource: vi.fn(),
  findProjectValueByDefinition: vi.fn(),
  bindParameterSource: vi.fn(),
  upsertFileSyncDraft: vi.fn()
}));

const mockedGetProjectParameterFileById = vi.mocked(getProjectParameterFileById);
const mockedGetFileVersionById = vi.mocked(getFileVersionById);
const mockedFindProjectValueBySource = vi.mocked(findProjectValueBySource);
const mockedFindProjectValueByDefinition = vi.mocked(findProjectValueByDefinition);
const mockedBindParameterSource = vi.mocked(bindParameterSource);
const mockedUpsertFileSyncDraft = vi.mocked(upsertFileSyncDraft);

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

describe("syncFileVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetProjectParameterFileById.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      fileName: "config.json",
      format: "json",
      enabled: true,
      updatedAt: "2026-07-11T09:00:00.000Z"
    });
  });

  it("JSON file index changes value 80->85 creates file_sync draft", async () => {
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
      skipped: false
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
  });

  it("same value only binds source and skips draft", async () => {
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
      skipped: false
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
      skipped: true
    });
    expect(mockedFindProjectValueBySource).not.toHaveBeenCalled();
    expect(mockedFindProjectValueByDefinition).not.toHaveBeenCalled();
    expect(mockedBindParameterSource).not.toHaveBeenCalled();
    expect(mockedUpsertFileSyncDraft).not.toHaveBeenCalled();
  });
});
