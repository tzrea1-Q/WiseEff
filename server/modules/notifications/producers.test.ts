import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import * as service from "./service";
import { createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import {
  notifyDebugNodeReadbackFailed,
  notifyDebugSnapshotRollback,
  notifyLogAnalysisCompleted,
  notifyLogAnalysisFailed,
  notifyParameterMergeCompleted,
  notifyUserDeactivated,
  notifyUserRoleChanged
} from "./producers";

describe("notification producers", () => {
  const userInvocation = createUserInvocation({
    user: {
      id: "u-merger",
      organizationId: "org-1",
      name: "Merger",
      email: "merger@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [],
    permissions: []
  });

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
      reviewerUserIds: ["u-reviewer-1", "u-reviewer-1"],
      execution: userInvocation
    });

    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        category: "parameter.merge.completed",
        recipientUserIds: ["u-submitter", "u-reviewer-1"]
      })
    );
  });

  it("keeps a System merge notification free of user attribution", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyParameterMergeCompleted(db, {
      organizationId: "org-1",
      projectId: "aurora",
      requestId: "req-system-1",
      parameterName: "cpu.freq",
      submitterUserId: null,
      reviewerUserIds: ["u-reviewer-1"],
      execution: createSystemInvocation({ kind: "job", name: "parameter-merge-job" }),
    });

    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        recipientUserIds: ["u-reviewer-1"],
        body: "WiseEff System job 已将 aurora 的参数变更合入基线。",
        metadata: expect.objectContaining({
          mergerName: "WiseEff System job",
          initiatorType: "system",
          executionLabel: "WiseEff System job",
        }),
      }),
    );
    const payload = notifyUsers.mock.calls[0]?.[1];
    expect(payload?.body).not.toContain("parameter-merge-job");
    expect(payload?.metadata).not.toHaveProperty("initiatorSystemName");
    expect(payload?.metadata).not.toHaveProperty("initiatorSessionId");
    expect(payload?.metadata).not.toHaveProperty("initiatorToolCallId");
    expect(payload?.metadata).not.toHaveProperty("initiatorApprovalId");
  });

  it("keeps merge notifications free of internal trusted correlation", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyParameterMergeCompleted(db, {
      organizationId: "org-1",
      projectId: "aurora",
      requestId: "req-red-public-projection",
      parameterName: "cpu.freq",
      submitterUserId: null,
      reviewerUserIds: ["u-reviewer-1"],
      execution: createSystemInvocation({ kind: "job", name: "internal-red-system-name" }),
    });

    const payload = notifyUsers.mock.calls[0]?.[1];
    expect(payload?.body).not.toContain("internal-red-system-name");
    expect(payload?.body).not.toContain("session-red-public-projection");
    expect(payload?.metadata).not.toHaveProperty("initiatorSessionId");
    expect(payload?.metadata).not.toHaveProperty("initiatorToolCallId");
    expect(payload?.metadata).not.toHaveProperty("initiatorApprovalId");
    expect(payload?.metadata).not.toHaveProperty("initiatorSystemName");
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

  it("warns when a write executed but its post-write readback failed", async () => {
    const notifyUsers = vi.spyOn(service, "notifyUsers").mockResolvedValue(undefined);
    const db = {} as Queryable;

    await notifyDebugNodeReadbackFailed(db, {
      organizationId: "org-1",
      sessionId: "session-1",
      operationId: "operation-1",
      recipientUserId: "u-operator",
      parameterName: "Cycle count",
      failureReason: "read timed out"
    });

    expect(notifyUsers).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        category: "debug.node.readback.failed",
        severity: "warning",
        title: "写入已执行，回读失败 · Cycle count",
        body: "read timed out",
        actionUrl: "/node-debugging"
      })
    );
  });
});
