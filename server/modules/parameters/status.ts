export const parameterChangeStatuses = [
  "submitted",
  "hardware_review",
  "software_review",
  "software_merge",
  "merged",
  "rejected",
  "withdrawn",
  "stashed"
] as const;

export const parameterReviewDecisions = ["advance", "reject"] as const;

export const parameterRiskLevels = ["high", "medium", "low"] as const;

export const parameterImportBatchStatuses = ["previewed", "applied"] as const;

export type ParameterChangeStatus = (typeof parameterChangeStatuses)[number];
export type ParameterReviewDecision = (typeof parameterReviewDecisions)[number];
export type ParameterRiskLevel = (typeof parameterRiskLevels)[number];
export type ParameterImportBatchStatus = (typeof parameterImportBatchStatuses)[number];
