import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { getConfigSetById } from "../parameter-files/configSetRepository";
import { getProjectById } from "../projects/repository";
import { readCanonicalBindingChangeHistory } from "../parameter-bindings/catalogProjectValueSync";
import {
  listCanonicalBindingCompareRows,
  listCanonicalBindingHistoryValueRows,
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

vi.mock("../parameter-bindings/catalogProjectValueSync", () => ({
  readCanonicalBindingChangeHistory: vi.fn().mockResolvedValue(null)
}));

vi.mock("./bindingService", () => ({
  listProjectBindingRows: vi.fn(),
  listIdentityMappingTaskRows: vi.fn(),
  getIdentityMappingTaskById: vi.fn(),
  resolveIdentityMappingTaskRow: vi.fn(),
  getBindingForProject: vi.fn(),
  listCanonicalBindingCompareRows: vi.fn().mockResolvedValue(null),
  listCanonicalBindingHistoryValueRows: vi.fn().mockResolvedValue([]),
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
    vi.mocked(readCanonicalBindingChangeHistory).mockResolvedValue(null);
    vi.mocked(listCanonicalBindingCompareRows).mockResolvedValue(null);
    vi.mocked(listCanonicalBindingHistoryValueRows).mockResolvedValue([]);
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
        moduleId: "mod-charging",
        displayName: "GPIO 中断",
        description: "SC8562 中断 GPIO 展示描述。",
        documentation: "电荷泵中断引脚的完整参数说明。"
      }
    ]);

    const result = await listProjectBindings(makeDb(), makeAuth(), { projectId: "project-1" });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "binding-1",
        moduleId: "mod-charging",
        displayName: "GPIO 中断",
        description: "SC8562 中断 GPIO 展示描述。",
        documentation: "电荷泵中断引脚的完整参数说明。"
      })
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

  it("getBindingHistory refuses a legacy-only binding instead of reading semantic snapshots", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(getBindingForProject).mockResolvedValue({ id: "binding-1" });
    await expect(getBindingHistory(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(getBindingForProject).not.toHaveBeenCalled();
    expect(listBindingRevisionRows).not.toHaveBeenCalled();
  });

  it("rejects a caller whose role is scoped to another project", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    const auth = makeAuth();
    auth.roles = [{ projectId: "project-2", roleId: "hardware-user" }];

    await expect(getBindingHistory(makeDb(), auth, {
      projectId: "project-1",
      bindingId: "canonical-binding-1"
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(readCanonicalBindingChangeHistory).not.toHaveBeenCalled();
  });

  it("keeps project-bound admin roles organization-wide for canonical compare", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(listCanonicalBindingCompareRows).mockResolvedValue([]);
    const auth = makeTestAuthContext({
      userId: "admin-1",
      organizationId: "org-1",
      roles: [{ projectId: "project-2", roleId: "admin" }],
      permissions: ["parameter:view"]
    });

    await getBindingCompare(makeDb(), auth, {
      projectId: "project-1",
      bindingId: "canonical-binding-1"
    });

    expect(listCanonicalBindingCompareRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      visibleProjectIds: null
    }));
  });

  it("getBindingHistory reads canonical binding events for a canonical-only DTS binding", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(readCanonicalBindingChangeHistory).mockResolvedValue([
      {
        id: "event-2",
        bindingId: "canonical-binding-1",
        definitionId: "cdef-1",
        oldDefinitionRevisionId: "drev-1",
        newDefinitionRevisionId: "drev-2",
        oldCurrentValueId: "value-1",
        newCurrentValueId: "value-2",
        reason: "raise limit",
        successAuditRef: "audit-2",
        catalogReleaseId: "release-1",
        createdAt: "2026-01-02T00:00:00.000Z",
        valueState: "present"
      }
    ]);
    vi.mocked(listCanonicalBindingHistoryValueRows).mockResolvedValue([
      {
        id: "value-1",
        bindingId: "canonical-binding-1",
        definitionId: "cdef-1",
        definitionRevisionId: "drev-1",
        sourceRef: "config-set:cs-1",
        sourceOccurrenceId: "source-occurrence-1",
        sourceIdentity: "source-occurrence-1",
        valueState: "present",
        rawValue: "<1>",
        sourceAvailable: true,
        configSetId: "cs-1",
        fileId: "file-1",
        fileVersionId: "file-version-1",
        fileName: "board.dts",
        sourceLocator: { kind: "dts-property", propertyName: "limit" }
      },
      {
        id: "value-2",
        bindingId: "canonical-binding-1",
        definitionId: "cdef-1",
        definitionRevisionId: "drev-value-2",
        sourceRef: "config-set:cs-1",
        sourceOccurrenceId: "source-occurrence-1",
        sourceIdentity: "source-occurrence-1",
        valueState: "present",
        rawValue: "<2>",
        sourceAvailable: true,
        configSetId: "cs-1",
        fileId: "file-1",
        fileVersionId: "file-version-2",
        fileName: "board.dts",
        sourceLocator: { kind: "dts-property", propertyName: "limit" }
      }
    ]);

    const result = await getBindingHistory(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "canonical-binding-1"
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "event-2",
        bindingId: "canonical-binding-1",
        definitionId: "cdef-1",
        effectiveRevisionId: "drev-2",
        definitionRevisionId: "drev-value-2",
        currentValueId: "value-2",
        valueState: "present",
        reason: "raise limit"
      })
    ]);
    expect(getBindingForProject).not.toHaveBeenCalled();
    expect(listBindingRevisionRows).not.toHaveBeenCalled();
  });

  it("getBindingHistory returns 404 for a binding absent from the canonical owner", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    await expect(getBindingHistory(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(listBindingRevisionRows).not.toHaveBeenCalled();
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

  it("getBindingCompare returns each canonical source instance, including same-project siblings", async () => {
    vi.mocked(getProjectById).mockResolvedValue({ id: "project-1", name: "Project", code: "P1" });
    vi.mocked(listCanonicalBindingCompareRows).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Project",
        bindingId: "binding-sibling",
        definitionId: "cdef-1",
        effectiveRevisionId: "drev-2",
        definitionRevisionId: "drev-2",
        currentValueId: "value-sibling",
        sourceOccurrenceId: "source-sibling",
        sourceIdentity: "source-sibling",
        sourceRef: "config-set:cs-1",
        valueState: "present",
        rawValue: "<1>",
        sourceAvailable: true,
        configSetId: "cs-1",
        fileId: "file-1",
        fileVersionId: "file-version-sibling",
        fileName: "board.dts",
        sourceLocator: { kind: "dts-property", propertyName: "limit" },
        moduleName: "充电策略",
        driverModule: "sc8562"
      },
      {
        projectId: "project-3",
        projectName: "Borealis",
        bindingId: "binding-3",
        definitionId: "cdef-1",
        effectiveRevisionId: "drev-3",
        definitionRevisionId: "drev-3",
        currentValueId: "value-3",
        sourceOccurrenceId: "source-3",
        sourceIdentity: "source-3",
        sourceRef: "config-set:cs-3",
        valueState: "present",
        rawValue: "<2>",
        sourceAvailable: true,
        configSetId: "cs-3",
        fileId: "file-3",
        fileVersionId: "file-version-3",
        fileName: "board.dts",
        sourceLocator: { kind: "dts-property", propertyName: "limit" },
        moduleName: "充电策略",
        driverModule: "sc8562"
      }
    ]);

    const result = await getBindingCompare(makeDb(), makeAuth(), {
      projectId: "project-1",
      bindingId: "binding-1"
    });

    expect(result.items).toEqual([
      expect.objectContaining({ projectId: "project-1", bindingId: "binding-sibling", sourceIdentity: "source-sibling" }),
      expect.objectContaining({ projectId: "project-3", bindingId: "binding-3", effectiveRevisionId: "drev-3" })
    ]);
    expect(result.items.some((item) => item.bindingId === "binding-1")).toBe(false);
    expect(getBindingForProject).not.toHaveBeenCalled();
    expect(listBindingCompareRows).not.toHaveBeenCalled();
    expect(listCanonicalBindingCompareRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: "org-1",
      projectId: "project-1",
      bindingId: "binding-1",
      visibleProjectIds: ["project-1"]
    }));
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
