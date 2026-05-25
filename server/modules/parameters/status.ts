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
export type ParameterSubmissionRoundStatus = (typeof parameterSubmissionRoundStatuses)[number];
export type ParameterReviewDecision = (typeof parameterReviewDecisions)[number];
export type ParameterRiskLevel = (typeof parameterRiskLevels)[number];
export type ParameterImportBatchStatus = (typeof parameterImportBatchStatuses)[number];
