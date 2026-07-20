import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getProjectById } from "../parameters/repository";
import { listIdentityMappingTaskRows, listProjectBindingRows } from "./bindingService";
import { listIdentityMappingTasks, listProjectBindings } from "./service";

vi.mock("../parameters/repository", () => ({
  getProjectById: vi.fn()
}));

vi.mock("./bindingService", () => ({
  listProjectBindingRows: vi.fn(),
  listIdentityMappingTaskRows: vi.fn(),
  getIdentityMappingTaskById: vi.fn(),
  resolveIdentityMappingTaskRow: vi.fn()
}));

vi.mock("./repository", () => ({
  getConfigRevisionById: vi.fn(),
  getLatestConfigRevision: vi.fn(),
  insertValidationRun: vi.fn(),
  listEffectiveTopology: vi.fn(),
  listSourceTopology: vi.fn(),
  listRevisionDiagnostics: vi.fn(),
  listConfigRevisionMembers: vi.fn(),
  updateConfigRevisionStatus: vi.fn()
}));

vi.mock("./governanceAudit", () => ({
  writeGovernanceAudit: vi.fn()
}));

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

describe("parameter topology service org scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listProjectBindings returns 404 when projectId is outside caller organization", async () => {
    vi.mocked(getProjectById).mockResolvedValue(null);

    await expect(
      listProjectBindings(makeDb(), makeAuth(), { projectId: "cross-org-project" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { projectId: "cross-org-project" }
    } satisfies Partial<ApiError>);

    expect(getProjectById).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "cross-org-project"
    });
    expect(listProjectBindingRows).not.toHaveBeenCalled();
  });

  it("listProjectBindings surfaces the persisted moduleId on each DTO (phase 2 browse source of truth)", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(listProjectBindingRows).mockResolvedValue([
      {
        id: "binding-1",
        parameterSpecId: "spec-1",
        parameterSpecVersionId: "spec-version-1",
        propertyKey: "gpio_int",
        driverModule: "sc8562",
        logicalNodeId: "logical-1",
        instanceName: "sc8562@6E",
        locator: "/amba/i2c@FDF5E000/sc8562@6E",
        typedValue: { kind: "empty" },
        rawValue: "<0>",
        schemaState: "valid",
        policyState: "pass",
        moduleId: "mod-charging"
      }
    ]);

    const result = await listProjectBindings(makeDb(), makeAuth(), { projectId: "project-1" });

    expect(result.items).toEqual([
      expect.objectContaining({ id: "binding-1", moduleId: "mod-charging" })
    ]);
  });

  it("listIdentityMappingTasks returns 404 when projectId filter is outside caller organization", async () => {
    vi.mocked(getProjectById).mockResolvedValue(null);

    await expect(
      listIdentityMappingTasks(makeDb(), makeAuth(), { projectId: "cross-org-project" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { projectId: "cross-org-project" }
    } satisfies Partial<ApiError>);

    expect(listIdentityMappingTaskRows).not.toHaveBeenCalled();
  });
});
