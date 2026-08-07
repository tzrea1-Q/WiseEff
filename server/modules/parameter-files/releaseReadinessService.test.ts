import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { assertReleaseGateAllows, evaluateReleaseReadiness } from "./releaseReadinessService";

vi.mock("./configSetRepository", () => ({
  getConfigSetById: vi.fn()
}));

vi.mock("./baselineRepository", () => ({
  listConfigSetMemberFiles: vi.fn(),
  listReleaseBaselinesByConfigSet: vi.fn()
}));

vi.mock("../parameters/repository", () => ({
  listOpenConflicts: vi.fn()
}));

vi.mock("../parameter-topology/repository", () => ({
  getLatestConfigRevision: vi.fn()
}));

vi.mock("../parameter-topology/bindingService", () => ({
  syncSingletonCardinalityBlockingTasks: vi.fn(),
  countBlockingIdentityMappingTasksForRevision: vi.fn()
}));

vi.mock("./validationGate", () => ({
  runValidationGate: vi.fn()
}));

import { getConfigSetById } from "./configSetRepository";
import { listConfigSetMemberFiles, listReleaseBaselinesByConfigSet } from "./baselineRepository";
import { listOpenConflicts } from "../parameters/repository";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import {
  countBlockingIdentityMappingTasksForRevision,
  syncSingletonCardinalityBlockingTasks
} from "../parameter-topology/bindingService";

const getConfigSetByIdMock = vi.mocked(getConfigSetById);
const listMembersMock = vi.mocked(listConfigSetMemberFiles);
const listBaselinesMock = vi.mocked(listReleaseBaselinesByConfigSet);
const listConflictsMock = vi.mocked(listOpenConflicts);
const getRevisionMock = vi.mocked(getLatestConfigRevision);
const syncTasksMock = vi.mocked(syncSingletonCardinalityBlockingTasks);
const countTasksMock = vi.mocked(countBlockingIdentityMappingTasksForRevision);

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

function viewerAuth(): AuthContext {
  return {
    ...adminAuth(),
    permissions: ["parameter:view"],
    roles: [{ projectId: null, roleId: "hardware-user" }]
  };
}

function createFakeDb(pendingCount = 0): Database {
  const query = vi.fn(async (text: string): Promise<QueryResult<{ count: number }>> => {
    if (text.includes("parameter_change_requests")) {
      return { rows: [{ count: pendingCount }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    query,
    transaction: async <T,>(fn: (q: Queryable) => Promise<T>) => fn({ query })
  };
}

describe("evaluateReleaseReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigSetByIdMock.mockResolvedValue({
      id: "cs-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "board-a",
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z"
    });
    listBaselinesMock.mockResolvedValue([]);
    listConflictsMock.mockResolvedValue([]);
    getRevisionMock.mockResolvedValue(null);
    syncTasksMock.mockResolvedValue(undefined as never);
    countTasksMock.mockResolvedValue(0);
    listMembersMock.mockResolvedValue([
      {
        configSetId: "cs-1",
        fileId: "file-base",
        fileName: "board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: "ver-1",
        currentVersionNumber: 1
      }
    ]);
  });

  it("rejects non-admin auth", async () => {
    await expect(evaluateReleaseReadiness(createFakeDb(), viewerAuth(), { configSetId: "cs-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("returns ready with gate token when no blockers or warnings", async () => {
    const result = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [],
      pendingChangeCount: 0,
      validationGate: {
        ok: true,
        mode: "block",
        requiresConfirmation: false,
        diagnostics: [],
        compiler: "dtc"
      }
    });
    expect(result.available).toBe(true);
    expect(result.level).toBe("ready");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.canCreateBaseline).toBe(true);
    expect(result.canRelease).toBe(true);
    expect(result.gateToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns in-sync when released baseline exists and gate is clear", async () => {
    listBaselinesMock.mockResolvedValue([
      {
        id: "bl-released",
        organizationId: "org-1",
        configSetId: "cs-1",
        name: "v1",
        status: "released",
        createdAt: "2026-08-07T00:00:00.000Z"
      }
    ]);
    const result = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [],
      pendingChangeCount: 0,
      validationGate: {
        ok: true,
        mode: "block",
        requiresConfirmation: false,
        diagnostics: [],
        compiler: "dtc"
      }
    });
    expect(result.level).toBe("in-sync");
    expect(result.releasedBaselineId).toBe("bl-released");
  });

  it("orders blockers for missing member version, conflicts, pending changes, and governance", async () => {
    listMembersMock.mockResolvedValue([
      {
        configSetId: "cs-1",
        fileId: "file-base",
        fileName: "board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: undefined,
        currentVersionNumber: undefined
      },
      {
        configSetId: "cs-1",
        fileId: "file-overlay",
        fileName: "overlay.dts",
        format: "dts",
        role: "overlay",
        sortOrder: 1,
        currentVersionId: undefined,
        currentVersionNumber: undefined
      }
    ]);
    getRevisionMock.mockResolvedValue({
      id: "rev-1",
      organizationId: "org-1",
      projectId: "project-1",
      configSetId: "cs-1",
      revisionNumber: 1,
      status: "resolved",
      createdAt: "2026-08-07T00:00:00.000Z"
    });
    countTasksMock.mockResolvedValue(2);

    const result = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [
        {
          id: "conflict-1",
          organizationId: "org-1",
          projectId: "project-1",
          projectParameterValueId: "ppv-1",
          parameterDefinitionId: "def-1",
          fileVersionId: "fv-1",
          fileDraftId: "fd-1",
          uiDraftId: "ud-1",
          fileValue: "1",
          uiDraftValue: "2",
          status: "open",
          createdAt: "2026-08-07T00:00:00.000Z",
          parameterName: "demo",
          fileId: "file-base",
          fileName: "board.dts",
          nodePath: "/board",
          propertyName: "model",
          source: {
            startOffset: 0,
            endOffset: 4,
            startLine: 3,
            startColumn: 1,
            endLine: 3,
            endColumn: 5
          }
        }
      ],
      pendingChangeCount: 1,
      validationGate: {
        ok: true,
        mode: "block",
        requiresConfirmation: false,
        diagnostics: [],
        compiler: "dtc"
      }
    });

    expect(result.level).toBe("blocked");
    expect(result.canCreateBaseline).toBe(false);
    expect(result.canRelease).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "missing-primary-version",
        "missing-member-version",
        "open-conflict",
        "pending-change",
        "publish-blocking-governance"
      ])
    );
    const conflict = result.blockers.find((item) => item.code === "open-conflict");
    expect(conflict?.target).toMatchObject({
      fileId: "file-base",
      nodePath: "/board",
      propertyName: "model",
      source: expect.objectContaining({ startLine: 3 })
    });
    expect(conflict?.remediation.kind).toBe("resolve-conflict");
  });

  it("surfaces policy warnings with acknowledgement state and blocks release until acknowledged", async () => {
    const result = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [],
      pendingChangeCount: 0,
      validationGate: {
        ok: true,
        mode: "warn",
        requiresConfirmation: true,
        diagnostics: [{ file: "board.dts", severity: "warning", message: "dtc unavailable" }],
        compiler: "unavailable"
      }
    });
    expect(result.level).toBe("warning");
    expect(result.canCreateBaseline).toBe(true);
    expect(result.canRelease).toBe(false);
    expect(result.warnings[0]).toMatchObject({
      code: "toolchain-warning",
      acknowledgementRequired: true,
      acknowledged: false,
      remediation: { kind: "acknowledge-warning" }
    });

    const warningId = result.warnings[0].id;
    const acknowledged = await evaluateReleaseReadiness(
      createFakeDb(),
      adminAuth(),
      { configSetId: "cs-1", acknowledgedWarningIds: [warningId] },
      {
        openConflicts: [],
        pendingChangeCount: 0,
        validationGate: {
          ok: true,
          mode: "warn",
          requiresConfirmation: true,
          diagnostics: [{ file: "board.dts", severity: "warning", message: "dtc unavailable" }],
          compiler: "unavailable"
        }
      }
    );
    expect(acknowledged.level).toBe("ready");
    expect(acknowledged.canRelease).toBe(true);
    expect(acknowledged.warnings[0].acknowledged).toBe(true);
  });

  it("assertReleaseGateAllows rejects missing, stale, and blocked tokens", async () => {
    const ready = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [],
      pendingChangeCount: 0,
      validationGate: {
        ok: true,
        mode: "block",
        requiresConfirmation: false,
        diagnostics: [],
        compiler: "dtc"
      }
    });

    await expect(
      assertReleaseGateAllows(createFakeDb(), adminAuth(), { configSetId: "cs-1", action: "create" }, {
        openConflicts: [],
        pendingChangeCount: 0,
        validationGate: {
          ok: true,
          mode: "block",
          requiresConfirmation: false,
          diagnostics: [],
          compiler: "dtc"
        }
      })
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-gate-required" }) });

    await expect(
      assertReleaseGateAllows(
        createFakeDb(),
        adminAuth(),
        { configSetId: "cs-1", gateToken: "stale-token", action: "create" },
        {
          openConflicts: [],
          pendingChangeCount: 0,
          validationGate: {
            ok: true,
            mode: "block",
            requiresConfirmation: false,
            diagnostics: [],
            compiler: "dtc"
          }
        }
      )
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-gate-stale" }) });

    await expect(
      assertReleaseGateAllows(
        createFakeDb(),
        adminAuth(),
        { configSetId: "cs-1", gateToken: ready.gateToken, action: "create" },
        {
          openConflicts: [],
          pendingChangeCount: 0,
          validationGate: {
            ok: true,
            mode: "block",
            requiresConfirmation: false,
            diagnostics: [],
            compiler: "dtc"
          }
        }
      )
    ).resolves.toMatchObject({ level: "ready" });

    listMembersMock.mockResolvedValue([
      {
        configSetId: "cs-1",
        fileId: "file-base",
        fileName: "board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0
      }
    ]);
    const blocked = await evaluateReleaseReadiness(createFakeDb(), adminAuth(), { configSetId: "cs-1" }, {
      openConflicts: [],
      pendingChangeCount: 0,
      validationGate: {
        ok: true,
        mode: "block",
        requiresConfirmation: false,
        diagnostics: [],
        compiler: "dtc"
      }
    });
    await expect(
      assertReleaseGateAllows(
        createFakeDb(),
        adminAuth(),
        { configSetId: "cs-1", gateToken: blocked.gateToken, action: "release" },
        {
          openConflicts: [],
          pendingChangeCount: 0,
          validationGate: {
            ok: true,
            mode: "block",
            requiresConfirmation: false,
            diagnostics: [],
            compiler: "dtc"
          }
        }
      )
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-blocked" }) });
  });
});
