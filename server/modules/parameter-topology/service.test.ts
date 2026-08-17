import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { getConfigSetById } from "../parameter-files/configSetRepository";
import { getProjectById } from "../projects/repository";
import {
  getBindingForProject,
  listBindingCompareRows,
  listBindingRevisionRows,
  listIdentityMappingTaskRows,
  listProjectBindingRows
} from "./bindingService";
import { listConfigRevisions as listConfigRevisionRows } from "./repository";
import {
  getBindingCompare,
  getBindingHistory,
  listConfigRevisions,
  listIdentityMappingTasks,
  listProjectBindings
} from "./service";

vi.mock("../projects/repository", () => ({
  getProjectById: vi.fn()
}));

vi.mock("../parameter-files/configSetRepository", () => ({
  getConfigSetById: vi.fn()
}));

vi.mock("./bindingService", () => ({
  listProjectBindingRows: vi.fn(),
  listIdentityMappingTaskRows: vi.fn(),
  getIdentityMappingTaskById: vi.fn(),
  resolveIdentityMappingTaskRow: vi.fn(),
  getBindingForProject: vi.fn(),
  listBindingRevisionRows: vi.fn(),
  listBindingCompareRows: vi.fn()
}));

vi.mock("./repository", () => ({
  getConfigRevisionById: vi.fn(),
  getLatestConfigRevision: vi.fn(),
  insertValidationRun: vi.fn(),
  listEffectiveTopology: vi.fn(),
  listSourceTopology: vi.fn(),
  listRevisionDiagnostics: vi.fn(),
  listConfigRevisionMembers: vi.fn(),
  listConfigRevisions: vi.fn(),
  updateConfigRevisionStatus: vi.fn()
}));

vi.mock("./governanceAudit", () => ({
  writeGovernanceAudit: vi.fn()
}));

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    name: "Riley Chen",
    email: "riley@example.com",
    title: "Engineer",
    organizationName: "ChargeLab",
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  });
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

  it("getBindingHistory orders binding revisions newest-first and maps adjacent raw values into from→to", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue({ id: "binding-1" });
    // Intentionally provided out of order to prove the service sorts before mapping.
    vi.mocked(listBindingRevisionRows).mockResolvedValue([
      { id: "rev-2", configRevisionId: "cr-2", revisionNumber: 2, rawValue: "<1>", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "rev-1", configRevisionId: "cr-1", revisionNumber: 1, rawValue: "<0>", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "rev-3", configRevisionId: "cr-3", revisionNumber: 3, rawValue: "<2>", createdAt: "2026-01-03T00:00:00.000Z" }
    ]);

    const result = await getBindingHistory(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    });

    expect(result.items).toEqual([
      { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<1>", toRawValue: "<2>" },
      { id: "rev-2", changedAt: "2026-01-02T00:00:00.000Z", fromRawValue: "<0>", toRawValue: "<1>" },
      { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>" }
    ]);
    expect(getBindingForProject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "project-1",
      bindingId: "binding-1"
    });
    expect(listBindingRevisionRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "project-1",
      bindingId: "binding-1"
    });
  });

  it("getBindingHistory omits no-op config-revision snapshots that did not change raw value", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue({ id: "binding-1" });
    vi.mocked(listBindingRevisionRows).mockResolvedValue([
      { id: "rev-1", configRevisionId: "cr-1", revisionNumber: 1, rawValue: "<0>", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "rev-2", configRevisionId: "cr-2", revisionNumber: 2, rawValue: "<0>", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "rev-3", configRevisionId: "cr-3", revisionNumber: 3, rawValue: "<1>", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "rev-4", configRevisionId: "cr-4", revisionNumber: 4, rawValue: "<1>", createdAt: "2026-01-04T00:00:00.000Z" }
    ]);

    const result = await getBindingHistory(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    });

    expect(result.items).toEqual([
      { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<0>", toRawValue: "<1>" },
      { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>" }
    ]);
  });

  it("getBindingHistory returns 404 when the project is outside the caller organization", async () => {
    vi.mocked(getProjectById).mockResolvedValue(null);

    await expect(
      getBindingHistory(makeDb(), makeAuth(), { projectId: "cross-org-project", bindingId: "binding-1" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { projectId: "cross-org-project" }
    } satisfies Partial<ApiError>);

    expect(getBindingForProject).not.toHaveBeenCalled();
    expect(listBindingRevisionRows).not.toHaveBeenCalled();
  });

  it("getBindingHistory returns 404 when the binding does not belong to the project", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue(null);

    await expect(
      getBindingHistory(makeDb(), makeAuth(), { projectId: "project-1", bindingId: "ghost-binding" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { bindingId: "ghost-binding" }
    } satisfies Partial<ApiError>);

    expect(listBindingRevisionRows).not.toHaveBeenCalled();
  });

  it("getBindingCompare returns other projects sharing the binding spec+module, org-scoped", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue({ id: "binding-1" });
    vi.mocked(listBindingCompareRows).mockResolvedValue([
      {
        projectId: "project-2",
        projectName: "Aurora",
        rawValue: "<1>",
        moduleName: "充电策略",
        driverModule: "sc8562"
      },
      {
        projectId: "project-3",
        projectName: "Borealis",
        rawValue: "<2>",
        moduleName: "充电策略",
        driverModule: "sc8562"
      }
    ]);

    const result = await getBindingCompare(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    });

    expect(result.items).toEqual([
      { projectId: "project-2", projectName: "Aurora", rawValue: "<1>", moduleName: "充电策略", driverModule: "sc8562" },
      { projectId: "project-3", projectName: "Borealis", rawValue: "<2>", moduleName: "充电策略", driverModule: "sc8562" }
    ]);
    expect(result.items.some((item) => item.projectId === "project-1")).toBe(false);
    expect(getBindingForProject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "project-1",
      bindingId: "binding-1"
    });
    expect(listBindingCompareRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "project-1",
      bindingId: "binding-1"
    });
  });

  it("getBindingCompare returns 404 when the project is outside the caller organization", async () => {
    vi.mocked(getProjectById).mockResolvedValue(null);

    await expect(
      getBindingCompare(makeDb(), makeAuth(), { projectId: "cross-org-project", bindingId: "binding-1" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { projectId: "cross-org-project" }
    } satisfies Partial<ApiError>);

    expect(getBindingForProject).not.toHaveBeenCalled();
    expect(listBindingCompareRows).not.toHaveBeenCalled();
  });

  it("getBindingCompare returns 404 when the binding does not belong to the project", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue(null);

    await expect(
      getBindingCompare(makeDb(), makeAuth(), { projectId: "project-1", bindingId: "ghost-binding" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { bindingId: "ghost-binding" }
    } satisfies Partial<ApiError>);

    expect(listBindingCompareRows).not.toHaveBeenCalled();
  });

  it("listConfigRevisions returns org-scoped listed revisions and 404s missing config sets", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getConfigSetById).mockResolvedValue({
      id: "cs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "default",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z"
    });
    vi.mocked(listConfigRevisionRows).mockResolvedValue([
      {
        id: "rev-2",
        organizationId: "org-1",
        projectId: "project-1",
        configSetId: "cs-1",
        revisionNumber: 2,
        status: "resolved",
        manifestState: "complete",
        createdAt: "2026-08-17T10:00:00.000Z"
      },
      {
        id: "rev-1",
        organizationId: "org-1",
        projectId: "project-1",
        configSetId: "cs-1",
        revisionNumber: 1,
        status: "validated",
        manifestState: "complete",
        createdAt: "2026-08-16T10:00:00.000Z"
      }
    ]);

    const result = await listConfigRevisions(makeDb(), makeAuth(), {
      projectId: "project-1",
      configSetId: "cs-1"
    });

    expect(result.items.map((item) => item.id)).toEqual(["rev-2", "rev-1"]);
    expect(listConfigRevisionRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: "cs-1"
    });

    vi.mocked(getConfigSetById).mockResolvedValue(null);
    await expect(
      listConfigRevisions(makeDb(), makeAuth(), { projectId: "project-1", configSetId: "missing" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { configSetId: "missing" }
    } satisfies Partial<ApiError>);
    expect(listConfigRevisionRows).toHaveBeenCalledTimes(1);
  });

  it("listConfigRevisions returns 404 when the config set belongs to another project", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getConfigSetById).mockResolvedValue({
      id: "cs-other",
      organizationId: "org-1",
      projectId: "project-other",
      name: "other",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z"
    });

    await expect(
      listConfigRevisions(makeDb(), makeAuth(), { projectId: "project-1", configSetId: "cs-other" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: { configSetId: "cs-other" }
    } satisfies Partial<ApiError>);

    expect(listConfigRevisionRows).not.toHaveBeenCalled();
  });
});
