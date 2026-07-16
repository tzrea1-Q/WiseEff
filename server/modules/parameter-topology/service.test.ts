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
  insertValidationRun: vi.fn(),
  listEffectiveTopology: vi.fn(),
  listSourceTopology: vi.fn(),
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
