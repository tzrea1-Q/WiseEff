import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { createAuditEvent } from "../audit/repository";
import { getFileVersionById, getProjectParameterFileByName, insertFileVersion, setCurrentVersion } from "./repository";
import { patchDtsProperty, patchJsonValue, writebackMergedParameterValue } from "./writebackService";

vi.mock("./repository", () => ({
  getProjectParameterFileByName: vi.fn(),
  getFileVersionById: vi.fn(),
  insertFileVersion: vi.fn(),
  setCurrentVersion: vi.fn()
}));

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn()
}));

const mockedGetProjectParameterFileByName = vi.mocked(getProjectParameterFileByName);
const mockedGetFileVersionById = vi.mocked(getFileVersionById);
const mockedInsertFileVersion = vi.mocked(insertFileVersion);
const mockedSetCurrentVersion = vi.mocked(setCurrentVersion);
const mockedCreateAuditEvent = vi.mocked(createAuditEvent);

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

describe("writebackService patches", () => {
  it("patchJsonValue updates nested leaf value", () => {
    const patched = patchJsonValue(
      JSON.stringify(
        {
          battery: {
            temp: {
              max: 80
            }
          }
        },
        null,
        2
      ),
      "battery/temp/max",
      "85"
    );

    expect(JSON.parse(patched.toString("utf8"))).toEqual({
      battery: {
        temp: {
          max: 85
        }
      }
    });
  });

  it("patchDtsProperty updates property value in target block", () => {
    const source = `
/ {
  battery {
    temp {
      max = 80;
    };
  };
};
`;
    const patched = patchDtsProperty(source, "battery/temp/max", "85");
    const output = patched.toString("utf8");
    expect(output).toContain("max = 85;");
    expect(output).not.toContain("max = 80;");
  });
});

describe("writebackMergedParameterValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates v2 writeback version after merge", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ source_file_name: "config.json", source_node_path: "battery/temp/max" }],
        rowCount: 1
      })
    };
    const objectStore = {
      get: vi.fn(async () => Buffer.from(JSON.stringify({ battery: { temp: { max: 80 } } }, null, 2), "utf8")),
      put: vi.fn(async () => ({
        storageKey: "org-1/next-config.json",
        fileName: "config.json",
        contentType: "application/json",
        fileSizeBytes: 42,
        checksumSha256: "checksum-next"
      }))
    } as ObjectStore;

    mockedGetProjectParameterFileByName.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      fileName: "config.json",
      format: "json",
      enabled: true,
      currentVersionId: "version-1",
      currentVersionNumber: 1,
      updatedAt: "2026-07-11T10:00:00.000Z"
    });
    mockedGetFileVersionById.mockResolvedValue({
      id: "version-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/current-config.json",
      checksum: "checksum-current",
      sizeBytes: 40,
      parsedIndex: { "battery/temp/max": { value: "80" } },
      origin: "upload",
      createdAt: "2026-07-11T10:01:00.000Z",
      createdByUserId: "user-1"
    });
    mockedInsertFileVersion.mockResolvedValue({
      id: "version-2",
      fileId: "file-1",
      versionNumber: 2,
      checksum: "checksum-next",
      sizeBytes: 42,
      parsedIndex: { "battery/temp/max": { value: "85" } },
      origin: "writeback",
      createdAt: "2026-07-11T10:02:00.000Z",
      createdByUserId: "user-1"
    });

    const result = await writebackMergedParameterValue(db, objectStore, adminAuth(), {
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      mergedValue: "85"
    });

    expect(result).toEqual({
      skipped: false,
      fileId: "file-1",
      versionId: "version-2",
      versionNumber: 2
    });
    expect(objectStore.put).toHaveBeenCalled();
    const putPayload = vi.mocked(objectStore.put).mock.calls[0][0];
    expect(JSON.parse(putPayload.bytes.toString("utf8"))).toEqual({
      battery: { temp: { max: 85 } }
    });
    expect(mockedInsertFileVersion).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        fileId: "file-1",
        versionNumber: 2,
        origin: "writeback"
      })
    );
    expect(mockedSetCurrentVersion).toHaveBeenCalledWith(db, {
      fileId: "file-1",
      versionId: "version-2"
    });
    expect(mockedCreateAuditEvent).toHaveBeenCalled();
  });

  it("skips when parameter source fields are missing", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ source_file_name: null, source_node_path: null }],
        rowCount: 1
      })
    };
    const objectStore = {
      get: vi.fn(),
      put: vi.fn()
    } as unknown as ObjectStore;

    const result = await writebackMergedParameterValue(db, objectStore, adminAuth(), {
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      mergedValue: "85"
    });

    expect(result).toEqual({ skipped: true });
    expect(mockedGetProjectParameterFileByName).not.toHaveBeenCalled();
    expect(vi.mocked(objectStore.put)).not.toHaveBeenCalled();
  });
});
