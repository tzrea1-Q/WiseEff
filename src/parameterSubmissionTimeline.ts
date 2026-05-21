import type { ParameterSubmissionRound } from "./mockData";

export const SUBMISSION_TIMELINE_STEPS = [
  "选择参数",
  "填写目标值",
  "硬件Committer检视",
  "软件Committer检视",
  "软件User合入"
] as const;

export type SubmissionTimelineView = {
  steps: typeof SUBMISSION_TIMELINE_STEPS;
  activeIndex: number;
};

type DraftSubmissionRound = Omit<ParameterSubmissionRound, "status"> & {
  status: ParameterSubmissionRound["status"] | "草稿";
};

const reviewStageStatuses = new Set<ParameterSubmissionRound["status"] | "草稿">([
  "硬件Committer检视",
  "待审阅",
  "已打回",
  "已撤回"
]);

export function deriveSubmissionTimeline(round: ParameterSubmissionRound | DraftSubmissionRound | null): SubmissionTimelineView {
  if (!round) {
    return {
      steps: SUBMISSION_TIMELINE_STEPS,
      activeIndex: -1
    };
  }

  if (round.status === "已合入") {
    return {
      steps: SUBMISSION_TIMELINE_STEPS,
      activeIndex: 4
    };
  }

  if (round.status === "软件User合入" || round.status === "等待合入") {
    return {
      steps: SUBMISSION_TIMELINE_STEPS,
      activeIndex: 4
    };
  }

  if (round.status === "软件Committer检视" || round.status === "自动检查通过") {
    return {
      steps: SUBMISSION_TIMELINE_STEPS,
      activeIndex: 3
    };
  }

  if (reviewStageStatuses.has(round.status)) {
    return {
      steps: SUBMISSION_TIMELINE_STEPS,
      activeIndex: 2
    };
  }

  return {
    steps: SUBMISSION_TIMELINE_STEPS,
    activeIndex: round.items.length > 0 ? 1 : 0
  };
}
