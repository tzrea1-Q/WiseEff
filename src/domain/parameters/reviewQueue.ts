import { getPlatformRole, roleSupportsWorkflowSlot, type PlatformRoleId } from "@/domain/users/types";

import type { ChangeRequest, RequestStatus } from "./types";

const activeReviewStatuses = new Set<RequestStatus>([
  "硬件Committer检视",
  "软件Committer检视",
  "软件User合入",
  "待审阅",
  "自动检查通过",
  "等待合入"
]);

const terminalReviewStatuses = new Set<RequestStatus>(["已合入", "已打回"]);

export function getWorkflowStageRank(status: RequestStatus): number {
  switch (status) {
    case "待审阅":
    case "硬件Committer检视":
      return 1;
    case "自动检查通过":
    case "软件Committer检视":
      return 2;
    case "等待合入":
    case "软件User合入":
      return 3;
    case "已合入":
    case "已打回":
      return 4;
    default:
      return 0;
  }
}

export function getRoleWorkflowStageRank(roleId: PlatformRoleId): number | null {
  // Admin can act across every workflow slot; do not collapse that to a single stage
  // or actionable requests will also be classified as history (and bounce the pending tab).
  if (getPlatformRole(roleId).level === "admin") {
    return null;
  }
  if (roleSupportsWorkflowSlot(roleId, "hardwareCommitter")) {
    return 1;
  }
  if (roleSupportsWorkflowSlot(roleId, "softwareCommitter")) {
    return 2;
  }
  if (roleSupportsWorkflowSlot(roleId, "softwareUser")) {
    return 3;
  }
  return null;
}

export function canActOnReviewRequest(roleId: PlatformRoleId, request: ChangeRequest): boolean {
  if (request.status === "硬件Committer检视") {
    return roleSupportsWorkflowSlot(roleId, "hardwareCommitter");
  }
  if (request.status === "软件Committer检视") {
    return roleSupportsWorkflowSlot(roleId, "softwareCommitter");
  }
  if (request.status === "软件User合入") {
    return roleSupportsWorkflowSlot(roleId, "softwareUser");
  }
  if (activeReviewStatuses.has(request.status)) {
    return getPlatformRole(roleId).level === "committer";
  }
  return false;
}

export function isReviewHistoryForRole(roleId: PlatformRoleId, request: ChangeRequest): boolean {
  if (terminalReviewStatuses.has(request.status)) {
    return getRoleWorkflowStageRank(roleId) !== null || getPlatformRole(roleId).level === "admin";
  }

  // Multi-slot roles (admin, software-committer+user) can still act on later stages.
  // Those requests must stay out of history so pending/history queues stay disjoint.
  if (canActOnReviewRequest(roleId, request)) {
    return false;
  }

  const roleStage = getRoleWorkflowStageRank(roleId);
  if (roleStage === null) {
    return false;
  }

  const requestStage = getWorkflowStageRank(request.status);
  return requestStage > roleStage;
}

export function splitChangeRequestsForReviewQueue(roleId: PlatformRoleId, requests: ChangeRequest[]) {
  const roleStage = getRoleWorkflowStageRank(roleId);

  if (roleStage === null) {
    return {
      pending: requests.filter((request) => !terminalReviewStatuses.has(request.status)),
      history: requests.filter((request) => terminalReviewStatuses.has(request.status))
    };
  }

  return {
    pending: requests.filter(
      (request) => !terminalReviewStatuses.has(request.status) && canActOnReviewRequest(roleId, request)
    ),
    history: requests.filter((request) => isReviewHistoryForRole(roleId, request))
  };
}
