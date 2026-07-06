import type { Queryable } from "../../shared/database/client";
import { notifyUsers } from "./service";

function reviewQueueUrl(projectId: string) {
  return `/parameter-review?project=${encodeURIComponent(projectId)}`;
}

function parameterAdminUrl(projectId: string) {
  return `/parameter-admin?project=${encodeURIComponent(projectId)}`;
}

function nodeDebuggingUrl(projectId: string) {
  return `/node-debugging?project=${encodeURIComponent(projectId)}`;
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

export async function notifyDebugNodeWriteFailed(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
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
    actionUrl: nodeDebuggingUrl(input.projectId),
    sourceKind: "debug-node-operation",
    sourceId: input.operationId,
    metadata: {
      projectId: input.projectId,
      sessionId: input.sessionId,
      parameterName: input.parameterName
    }
  });
}

function uniqueRecipients(userIds: string[]) {
  return [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
}
