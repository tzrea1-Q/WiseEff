import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

vi.mock("../projects/repository", () => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn()
}));

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined)
}));

import { createAuditEvent } from "../audit/repository";
import * as repository from "../projects/repository";
import { deleteProjectForAuth, updateProjectForAuth } from "./projectService";

const mockedCreateAuditEvent = vi.mocked(createAuditEvent);
const mockedUpdateProject = vi.mocked(repository.updateProject);
const mockedDeleteProject = vi.mocked(repository.deleteProject);

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
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
    permissions: ["admin:access"],
    ...overrides
  };
}

/** Fake Database whose transaction() actually runs the callback on a distinct tx handle. */
function makeDb(): { db: Database; tx: Database } {
  const tx: Database = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: async (fn) => fn(tx)
  };
  const db: Database = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: vi.fn(async (fn) => fn(tx))
  };
  return { db, tx };
}

describe("updateProjectForAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a project and writes the audit event on the same transaction handle", async () => {
    const { db, tx } = makeDb();
    const item = {
      id: "nova",
      name: "Nova Renamed",
      code: "NOVA",
      status: "initialized",
      moduleCount: 0,
      parameterCount: 0,
      openConflictCount: 0,
      releasedBaselineCount: 0,
      updatedAt: "2026-08-05T00:00:00.000Z"
    };
    mockedUpdateProject.mockResolvedValue(item);

    const result = await updateProjectForAuth(
      db,
      adminAuth(),
      { projectId: "nova", name: "Nova Renamed" },
      { requestId: "req-update-1" }
    );

    expect(result).toEqual(item);
    // Domain write and audit write share the transaction handle (ADR-0027).
    expect(mockedUpdateProject).toHaveBeenCalledWith(tx, {
      organizationId: "org-1",
      projectId: "nova",
      name: "Nova Renamed",
      code: undefined,
      status: undefined
    });
    expect(mockedCreateAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "nova",
        actorUserId: "user-1",
        app: "parameter-admin",
        kind: "project-updated",
        action: "已更新项目「Nova Renamed」",
        targetType: "project",
        targetId: "nova",
        traceId: "req-update-1"
      })
    );
  });

  it("rejects callers without admin:access before mutating", async () => {
    const { db } = makeDb();

    await expect(
      updateProjectForAuth(
        db,
        adminAuth({ permissions: ["parameter:view"] }),
        { projectId: "nova", name: "Nope" },
        { requestId: "req-update-2" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ApiError>);

    expect(mockedUpdateProject).not.toHaveBeenCalled();
    expect(mockedCreateAuditEvent).not.toHaveBeenCalled();
  });

  it("does not write audit when the project is missing", async () => {
    const { db } = makeDb();
    mockedUpdateProject.mockResolvedValue(null);

    const result = await updateProjectForAuth(
      db,
      adminAuth(),
      { projectId: "missing", name: "Missing" },
      { requestId: "req-update-3" }
    );

    expect(result).toBeNull();
    expect(mockedCreateAuditEvent).not.toHaveBeenCalled();
  });
});

describe("deleteProjectForAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a project and writes the audit event on the same transaction handle", async () => {
    const { db, tx } = makeDb();
    mockedDeleteProject.mockResolvedValue({ deleted: true });

    const result = await deleteProjectForAuth(
      db,
      adminAuth(),
      { projectId: "nova", projectName: "Nova" },
      { requestId: "req-delete-1" }
    );

    expect(result).toEqual({ deleted: true });
    expect(mockedDeleteProject).toHaveBeenCalledWith(tx, {
      organizationId: "org-1",
      projectId: "nova"
    });
    expect(mockedCreateAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "nova",
        app: "parameter-admin",
        kind: "project-deleted",
        action: "已删除项目「Nova」",
        targetType: "project",
        targetId: "nova",
        traceId: "req-delete-1"
      })
    );
  });

  it("does not write audit when the project is missing", async () => {
    const { db } = makeDb();
    mockedDeleteProject.mockResolvedValue({ deleted: false, reason: "not_found" });

    const result = await deleteProjectForAuth(
      db,
      adminAuth(),
      { projectId: "missing", projectName: "Missing" },
      { requestId: "req-delete-2" }
    );

    expect(result).toEqual({ deleted: false, reason: "not_found" });
    expect(mockedCreateAuditEvent).not.toHaveBeenCalled();
  });
});
