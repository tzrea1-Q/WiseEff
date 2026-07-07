import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import * as service from "./service";
import {
  notifyDebugSnapshotRollback,
  notifyLogAnalysisCompleted,
  notifyLogAnalysisFailed,
  notifyParameterMergeCompleted,
  notifyUserDeactivated,
  notifyUserRoleChanged
} from "./producers";

describe("notification producers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies merge participants", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyParameterMergeCompleted(db, {
      organizationId: "org-1",
      projectId: "aurora",
      projectName: "Aurora",
      requestId: "req-1",
      parameterName: "cpu.freq",
      submitterUserId: "u-submitter",
      mergerName: "Merger",
      reviewerUserIds: ["u-reviewer-1", "u-reviewer-1"]
    });

    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        category: "parameter.merge.completed",
        recipientUserIds: ["u-submitter", "u-reviewer-1"]
      })
    );
  });

  it("notifies log analysis terminal states", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyLogAnalysisCompleted(db, {
      organizationId: "org-1",
      logId: "log-1",
      runId: "run-1",
      fileName: "boot.log",
      recipientUserId: "u-uploader",
      conclusion: "Root cause identified."
    });
    await notifyLogAnalysisFailed(db, {
      organizationId: "org-1",
      logId: "log-2",
      runId: "run-2",
      fileName: "fail.log",
      recipientUserId: "u-uploader",
      failureReason: "Parse error"
    });

    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(notifyUsers.mock.calls[0]?.[1]).toMatchObject({
      category: "log.analysis.completed",
      actionUrl: "/logs"
    });
    expect(notifyUsers.mock.calls[1]?.[1]).toMatchObject({
      category: "log.analysis.failed",
      severity: "danger",
      actionUrl: "/logs"
    });
  });

  it("notifies rollback and user governance events", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyDebugSnapshotRollback(db, {
      organizationId: "org-1",
      sessionId: "session-1",
      snapshotId: "snapshot-1",
      recipientUserId: "u-operator",
      succeeded: true,
      operationCount: 2
    });
    await notifyUserRoleChanged(db, {
      organizationId: "org-1",
      userId: "u-target",
      actorName: "Admin",
      roles: [{ projectId: null, roleId: "admin" }],
      adminUserIds: ["u-admin"]
    });
    await notifyUserDeactivated(db, {
      organizationId: "org-1",
      userId: "u-target",
      actorName: "Admin",
      adminUserIds: ["u-admin"]
    });

    expect(notifyUsers).toHaveBeenCalledTimes(3);
    expect(notifyUsers.mock.calls[0]?.[1]).toMatchObject({
      category: "debug.snapshot.rollback",
      actionUrl: "/node-debugging"
    });
    expect(notifyUsers.mock.calls[1]?.[1]).toMatchObject({ category: "user.role.changed" });
    expect(notifyUsers.mock.calls[2]?.[1]).toMatchObject({ category: "user.deactivated" });
  });
});
