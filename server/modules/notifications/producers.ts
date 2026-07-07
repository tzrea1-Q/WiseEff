import type { Queryable } from "../../shared/database/client";
import { notifyUsers } from "./service";

function reviewQueueUrl(projectId: string) {
  return `/parameter-review?project=${encodeURIComponent(projectId)}`;
}

function parameterAdminUrl(projectId: string) {
  return `/parameter-admin?project=${encodeURIComponent(projectId)}`;
}

function nodeDebuggingUrl() {
  return "/node-debugging";
}

function logsUrl() {
  return "/logs";
}

function userPermissionsUrl() {
  return "/user-permissions";
}

const backendRoleLabels: Record<string, string> = {
  guest: "访客",
  "hardware-user": "硬件工程师",
  "software-user": "软件工程师",
  "hardware-committer": "硬件合入",
  "software-committer": "软件合入",
  admin: "管理员"
};

function formatRoleLabel(roleId: string) {
  return backendRoleLabels[roleId] ?? roleId;
}

export async function notifyParameterReviewSubmitted(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectName?: string;
    roundId: string;
    itemCount: number;
    submitterName: string;
    reviewerUserIds: string[];
  }
) {
  const projectLabel = input.projectName?.trim() || input.projectId;
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: input.reviewerUserIds,
    category: "parameter.review.submitted",
    title: `参数审阅 · ${projectLabel}`,
    body: `${input.submitterName} 提交了 ${input.itemCount} 项修改，等待审阅。`,
    severity: "info",
    actionUrl: reviewQueueUrl(input.projectId),
    sourceKind: "parameter-submission-round",
    sourceId: input.roundId,
    metadata: {
      projectId: input.projectId,
      itemCount: input.itemCount,
      submitterName: input.submitterName
    }
  });
}

export async function notifyParameterReviewRejected(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectName?: string;
    requestId: string;
    parameterName: string;
    submitterUserId: string;
    reviewerName: string;
    note?: string;
  }
) {
  const projectLabel = input.projectName?.trim() || input.projectId;
  const noteSuffix = input.note?.trim() ? `：${input.note.trim()}` : "";
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.submitterUserId],
    category: "parameter.review.rejected",
    title: `审阅打回 · ${input.parameterName}`,
    body: `${input.reviewerName} 打回了 ${projectLabel} 的参数变更${noteSuffix}`,
    severity: "warning",
    actionUrl: reviewQueueUrl(input.projectId),
    sourceKind: "parameter-change-request",
    sourceId: input.requestId,
    metadata: {
      projectId: input.projectId,
      parameterName: input.parameterName,
      reviewerName: input.reviewerName
    }
  });
}

export async function notifyParameterReviewAdvanced(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectName?: string;
    requestId: string;
    parameterName: string;
    submitterUserId: string;
    reviewerName: string;
    toStatus: string;
    assigneeUserIds?: string[];
  }
) {
  const projectLabel = input.projectName?.trim() || input.projectId;
  const recipients = uniqueRecipients([input.submitterUserId, ...(input.assigneeUserIds ?? [])]);
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: recipients,
    category: "parameter.review.advanced",
    title: `审阅推进 · ${input.parameterName}`,
    body: `${input.reviewerName} 将 ${projectLabel} 的参数变更推进至 ${input.toStatus}。`,
    severity: "info",
    actionUrl: reviewQueueUrl(input.projectId),
    sourceKind: "parameter-change-request",
    sourceId: `${input.requestId}:${input.toStatus}`,
    metadata: {
      projectId: input.projectId,
      parameterName: input.parameterName,
      reviewerName: input.reviewerName,
      toStatus: input.toStatus
    }
  });
}

export async function notifyParameterImportCompleted(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectName?: string;
    batchId: string;
    recipientUserId: string;
    added: number;
    updated: number;
  }
) {
  const projectLabel = input.projectName?.trim() || input.projectId;
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.recipientUserId],
    category: "parameter.import.completed",
    title: `参数导入完成 · ${projectLabel}`,
    body: `导入批次已应用：新增 ${input.added} 项，更新 ${input.updated} 项。`,
    severity: "success",
    actionUrl: parameterAdminUrl(input.projectId),
    sourceKind: "parameter-import-batch",
    sourceId: input.batchId,
    metadata: {
      projectId: input.projectId,
      added: input.added,
      updated: input.updated
    }
  });
}

export async function notifyParameterMergeCompleted(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    projectName?: string;
    requestId: string;
    parameterName: string;
    submitterUserId: string;
    mergerName: string;
    reviewerUserIds: string[];
  }
) {
  const projectLabel = input.projectName?.trim() || input.projectId;
  const recipients = uniqueRecipients([input.submitterUserId, ...input.reviewerUserIds]);
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: recipients,
    category: "parameter.merge.completed",
    title: `参数已合入 · ${input.parameterName}`,
    body: `${input.mergerName} 已将 ${projectLabel} 的参数变更合入基线。`,
    severity: "success",
    actionUrl: parameterAdminUrl(input.projectId),
    sourceKind: "parameter-change-request",
    sourceId: input.requestId,
    metadata: {
      projectId: input.projectId,
      parameterName: input.parameterName,
      mergerName: input.mergerName
    }
  });
}

export async function notifyLogAnalysisCompleted(
  db: Queryable,
  input: {
    organizationId: string;
    logId: string;
    runId: string;
    fileName: string;
    recipientUserId: string;
    conclusion?: string;
  }
) {
  const summary = input.conclusion?.trim() || "分析报告已生成，可在日志分析页查看。";
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.recipientUserId],
    category: "log.analysis.completed",
    title: `日志分析完成 · ${input.fileName}`,
    body: summary,
    severity: "success",
    actionUrl: logsUrl(),
    sourceKind: "log-analysis-run",
    sourceId: input.runId,
    metadata: {
      logId: input.logId,
      fileName: input.fileName
    }
  });
}

export async function notifyLogAnalysisFailed(
  db: Queryable,
  input: {
    organizationId: string;
    logId: string;
    runId: string;
    fileName: string;
    recipientUserId: string;
    failureReason?: string;
  }
) {
  const reason = input.failureReason?.trim() || "日志分析未能完成，请稍后重试或联系管理员。";
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.recipientUserId],
    category: "log.analysis.failed",
    title: `日志分析失败 · ${input.fileName}`,
    body: reason,
    severity: "danger",
    actionUrl: logsUrl(),
    sourceKind: "log-analysis-run",
    sourceId: input.runId,
    metadata: {
      logId: input.logId,
      fileName: input.fileName
    }
  });
}

export async function notifyDebugSnapshotRollback(
  db: Queryable,
  input: {
    organizationId: string;
    sessionId: string;
    snapshotId: string;
    recipientUserId: string;
    succeeded: boolean;
    operationCount?: number;
  }
) {
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.recipientUserId],
    category: "debug.snapshot.rollback",
    title: input.succeeded ? "调试快照已回滚" : "调试快照回滚失败",
    body: input.succeeded
      ? `已成功回滚 ${input.operationCount ?? 0} 项节点写入。`
      : "部分节点未能恢复，请在调试页检查会话事件。",
    severity: input.succeeded ? "success" : "danger",
    actionUrl: nodeDebuggingUrl(),
    sourceKind: "debug-snapshot",
    sourceId: `${input.snapshotId}:${input.succeeded ? "succeeded" : "failed"}`,
    metadata: {
      sessionId: input.sessionId,
      snapshotId: input.snapshotId,
      succeeded: input.succeeded
    }
  });
}

export async function notifyUserRoleChanged(
  db: Queryable,
  input: {
    organizationId: string;
    userId: string;
    actorName: string;
    roles: Array<{ projectId?: string | null; roleId: string }>;
    adminUserIds?: string[];
  }
) {
  const roleSummary = input.roles.map((role) => formatRoleLabel(role.roleId)).join("、") || "未分配";
  const recipients = uniqueRecipients([input.userId, ...(input.adminUserIds ?? [])]);
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: recipients,
    category: "user.role.changed",
    title: "账号角色已更新",
    body: `${input.actorName} 更新了账号角色：${roleSummary}。`,
    severity: "info",
    actionUrl: userPermissionsUrl(),
    sourceKind: "user",
    sourceId: input.userId,
    metadata: {
      userId: input.userId,
      roles: input.roles
    }
  });
}

export async function notifyUserDeactivated(
  db: Queryable,
  input: {
    organizationId: string;
    userId: string;
    actorName: string;
    adminUserIds?: string[];
  }
) {
  const recipients = uniqueRecipients([input.userId, ...(input.adminUserIds ?? [])]);
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: recipients,
    category: "user.deactivated",
    title: "账号已停用",
    body: `${input.actorName} 已停用该账号，如需恢复请联系管理员。`,
    severity: "warning",
    actionUrl: userPermissionsUrl(),
    sourceKind: "user",
    sourceId: input.userId,
    metadata: {
      userId: input.userId
    }
  });
}

export async function notifyDebugNodeWriteFailed(
  db: Queryable,
  input: {
    organizationId: string;
    sessionId: string;
    operationId: string;
    recipientUserId: string;
    parameterName: string;
    failureReason?: string;
  }
) {
  const reason = input.failureReason?.trim() || "节点写入失败";
  await notifyUsers(db, {
    organizationId: input.organizationId,
    recipientUserIds: [input.recipientUserId],
    category: "debug.node.write.failed",
    title: `调试写入失败 · ${input.parameterName}`,
    body: reason,
    severity: "danger",
    actionUrl: nodeDebuggingUrl(),
    sourceKind: "debug-node-operation",
    sourceId: input.operationId,
    metadata: {
      sessionId: input.sessionId,
      parameterName: input.parameterName
    }
  });
}

function uniqueRecipients(userIds: string[]) {
  return [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
}
