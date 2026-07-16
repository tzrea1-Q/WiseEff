import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { getProjectParameterFileById } from "../parameter-files/repository";
import {
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
    insertProjectParameterValueWithSource: vi.fn()
  };
});

const mockedGetFile = vi.mocked(getProjectParameterFileById);
const mockedBySource = vi.mocked(findProjectValueBySource);
const mockedInsert = vi.mocked(insertProjectParameterValueWithSource);

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

describe("resolveStructuredEditToParameter fail-closed identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetFile.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      fileName: "board.dts",
      format: "dts",
      enabled: true,
      updatedAt: "2026-07-11T09:00:00.000Z"
    });
  });

  it("returns an existing source binding when present", async () => {
    mockedBySource.mockResolvedValue({
      id: "ppv-1",
      projectId: "project-1",
      parameterDefinitionId: "pd-1",
      name: "temp_max",
      module: "battery",
      currentValue: "80"
    });

    const resolved = await resolveStructuredEditToParameter(fakeDb, auth(), "project-1", edit);

    expect(resolved.id).toBe("ppv-1");
    expect(mockedInsert).not.toHaveBeenCalled();
  });

  it("inserts a new PPV+source binding when no source match (never name/module fallback)", async () => {
    mockedBySource.mockResolvedValue(null);
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
    expect(mockedInsert).toHaveBeenCalled();
  });
});
