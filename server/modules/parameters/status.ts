export const parameterChangeStatuses = [
  "hardware_review",
  "software_review",
  "software_user_merge",
  "pending_review",
  "auto_check_passed",
  "waiting_merge",
  "merged",
  "rejected",
  "withdrawn",
  "draft"
] as const;

export const parameterReviewDecisions = ["advance", "reject"] as const;

export const parameterRiskLevels = ["high", "medium", "low"] as const;

export const parameterImportBatchStatuses = ["previewed", "applied"] as const;

export type ParameterChangeStatus = (typeof parameterChangeStatuses)[number];
export type ParameterReviewDecision = (typeof parameterReviewDecisions)[number];
export type ParameterRiskLevel = (typeof parameterRiskLevels)[number];
export type ParameterImportBatchStatus = (typeof parameterImportBatchStatuses)[number];
