export const parameterChangeRequestStatuses = [
  "submitted",
  "hardware_review",
  "software_review",
  "software_merge",
  "merged",
  "rejected"
] as const;

export type ParameterChangeRequestStatus = (typeof parameterChangeRequestStatuses)[number];
