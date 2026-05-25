export const parameterChangeRequestStatuses = [
  "submitted",
  "hardware_review",
  "software_review",
  "software_merge",
  "merged",
  "rejected"
] as const;

export const parameterSubmissionRoundStatuses = [
  ...parameterChangeRequestStatuses,
  "withdrawn",
  "stashed"
] as const;

export const parameterReviewDecisions = ["advance", "reject"] as const;

export const parameterRiskLevels = ["High", "Medium", "Low"] as const;

export const parameterImportBatchStatuses = ["previewed", "applied"] as const;

export type ParameterChangeRequestStatus = (typeof parameterChangeRequestStatuses)[number];
export type ParameterChangeStatus = ParameterChangeRequestStatus;
export type ParameterSubmissionRoundStatus = (typeof parameterSubmissionRoundStatuses)[number];
export type ParameterReviewDecision = (typeof parameterReviewDecisions)[number];
export type ParameterRiskLevel = (typeof parameterRiskLevels)[number];
export type ParameterImportBatchStatus = (typeof parameterImportBatchStatuses)[number];

export const parameterStatusLabels = {
  submitted: "待审阅",
  hardware_review: "硬件Committer检视",
  software_review: "软件Committer检视",
  software_merge: "软件User合入",
  merged: "已合入",
  rejected: "已打回",
  withdrawn: "已撤回",
  stashed: "已暂存"
} as const;

export function getNextParameterStatus(status: ParameterChangeStatus) {
  if (status === "submitted" || status === "hardware_review") return "software_review";
  if (status === "software_review") return "software_merge";
  if (status === "software_merge") return "merged";
  return status;
}
