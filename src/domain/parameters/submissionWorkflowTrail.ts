import type {
  ParameterReviewDecisionRecord,
  ParameterSubmissionRound,
  ParameterWorkflowAssignees,
  RequestStatus,
  SubmissionWorkflowStageDetail
} from "./types";

export type { ParameterReviewDecisionRecord, SubmissionWorkflowStageDetail };
export type SubmissionWorkflowStageKey = SubmissionWorkflowStageDetail["key"];

const WORKFLOW_STAGE_CONFIG: Array<{
  key: SubmissionWorkflowStageKey;
  stepIndex: number;
  label: string;
  assigneeKey: keyof ParameterWorkflowAssignees;
  fromStatus: string;
  toStatus: string;
}> = [
  {
    key: "hardware_review",
    stepIndex: 2,
    label: "硬件Committer检视",
    assigneeKey: "hardwareCommitterId",
    fromStatus: "hardware_review",
    toStatus: "software_review"
  },
  {
    key: "software_review",
    stepIndex: 3,
    label: "软件Committer检视",
    assigneeKey: "softwareCommitterId",
    fromStatus: "software_review",
    toStatus: "software_merge"
  },
  {
    key: "software_merge",
    stepIndex: 4,
    label: "软件User合入",
    assigneeKey: "softwareUserId",
    fromStatus: "software_merge",
    toStatus: "merged"
  }
];

const frontendToBackendStatus: Partial<Record<ParameterSubmissionRound["status"], string>> = {
  待审阅: "submitted",
  "硬件Committer检视": "hardware_review",
  "软件Committer检视": "software_review",
  "软件User合入": "software_merge",
  等待合入: "software_merge",
  已合入: "merged",
  已打回: "rejected",
  已撤回: "withdrawn",
  已暂存: "stashed"
};

export function requestStatusToBackend(status: RequestStatus | ParameterSubmissionRound["status"] | string): string | undefined {
  return frontendToBackendStatus[status as ParameterSubmissionRound["status"]];
}

function formatExecutorNames(names: string[]): string | undefined {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (uniqueNames.length === 0) {
    return undefined;
  }
  if (uniqueNames.length === 1) {
    return uniqueNames[0];
  }
  return `${uniqueNames[0]} 等 ${uniqueNames.length} 人`;
}

function resolveStageExecutors(
  reviewDecisions: ParameterReviewDecisionRecord[],
  requestIds: string[],
  fromStatus: string,
  toStatus: string,
  resolveUserName: (userId?: string) => string
) {
  const reviewerIds = reviewDecisions
    .filter(
      (decision) =>
        requestIds.includes(decision.requestId) &&
        decision.decision === "advance" &&
        decision.fromStatus === fromStatus &&
        decision.toStatus === toStatus
    )
    .map((decision) => decision.reviewerUserId);

  return formatExecutorNames(reviewerIds.map((reviewerId) => resolveUserName(reviewerId)));
}

function resolveActiveHandler(
  changeRequests: Array<{ id: string; assignedTo?: string; status: RequestStatus | "已撤回" | "已暂存" | string }>,
  requestIds: string[],
  stageBackendStatus: string,
  resolveUserName: (userId?: string) => string
) {
  const activeRequest = changeRequests.find(
    (request) =>
      requestIds.includes(request.id) && requestStatusToBackend(request.status) === stageBackendStatus
  );

  if (!activeRequest?.assignedTo) {
    return undefined;
  }

  return resolveUserName(activeRequest.assignedTo);
}

function resolveStageState(stepIndex: number, activeIndex: number, skipped: boolean) {
  if (skipped) {
    return "skipped" as const;
  }
  if (stepIndex < activeIndex) {
    return "completed" as const;
  }
  if (stepIndex === activeIndex) {
    return "active" as const;
  }
  return "pending" as const;
}

function isHardwareStageSkipped(
  reviewDecisions: ParameterReviewDecisionRecord[],
  requestIds: string[],
  activeIndex: number,
  stepIndex: number
) {
  if (stepIndex !== 2 || activeIndex <= 2) {
    return false;
  }

  const hasHardwareDecision = reviewDecisions.some(
    (decision) =>
      requestIds.includes(decision.requestId) &&
      decision.decision === "advance" &&
      decision.fromStatus === "hardware_review" &&
      decision.toStatus === "software_review"
  );

  if (hasHardwareDecision) {
    return false;
  }

  return reviewDecisions.some(
    (decision) =>
      requestIds.includes(decision.requestId) &&
      decision.decision === "advance" &&
      decision.fromStatus === "submitted" &&
      decision.toStatus === "software_review"
  );
}

export type BuildSubmissionWorkflowTrailInput = {
  activeIndex: number;
  workflowAssignees?: ParameterWorkflowAssignees;
  requestIds: string[];
  changeRequests: Array<{ id: string; assignedTo?: string; status: RequestStatus | "已撤回" | "已暂存" | string }>;
  reviewDecisions: ParameterReviewDecisionRecord[];
  resolveUserName: (userId?: string) => string;
};

export function buildSubmissionWorkflowTrail(input: BuildSubmissionWorkflowTrailInput): SubmissionWorkflowStageDetail[] {
  return WORKFLOW_STAGE_CONFIG.map((stage) => {
    const assigneeName = input.resolveUserName(input.workflowAssignees?.[stage.assigneeKey]);
    const skipped = isHardwareStageSkipped(input.reviewDecisions, input.requestIds, input.activeIndex, stage.stepIndex);
    const executorFromDecision = resolveStageExecutors(
      input.reviewDecisions,
      input.requestIds,
      stage.fromStatus,
      stage.toStatus,
      input.resolveUserName
    );
    const state = resolveStageState(stage.stepIndex, input.activeIndex, skipped);
    const activeHandler =
      state === "active"
        ? resolveActiveHandler(input.changeRequests, input.requestIds, stage.fromStatus, input.resolveUserName)
        : undefined;
    const executorName = executorFromDecision ?? activeHandler;
    const executorLabel = state === "active" && !executorFromDecision ? "当前处理" : "执行人";

    return {
      key: stage.key,
      stepIndex: stage.stepIndex,
      label: stage.label,
      assigneeName,
      executorName,
      executorLabel,
      state
    };
  });
}
