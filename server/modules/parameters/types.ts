import type {
  ImportPreviewClassification,
  ParameterChangeRequestStatus,
  ParameterImportBatchStatus,
  ParameterRiskLevel,
  ParameterSubmissionRoundStatus
} from "./status";

export type ProjectDto = {
  id: string;
  name: string;
  code: string;
};

export type ProjectAdminSummaryDto = {
  id: string;
  name: string;
  code: string;
  status: string;
  moduleCount: number;
  parameterCount: number;
  updatedAt: string;
};

export type ProjectAdminDetailDto = ProjectAdminSummaryDto & {
  modules: ProjectModuleDto[];
};

export type ProjectModuleDto = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
};

export type ParameterHistoryEntryDto = {
  version: string;
  value: string;
  changedAt: string;
  changedBy: string;
  requestId?: string;
};

export type ParameterRecordDto = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  valueKind?: "scalar" | "complex";
  module: string;
  projectId: string;
  currentValue: string;
  recommendedValue: string;
  range: string;
  unit: string;
  risk: ParameterRiskLevel;
  updatedAt: string;
  updatedAtTs: string;
  history: ParameterHistoryEntryDto[];
};

export type ParameterDraftDto = {
  id: string;
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
  updatedAt: string;
};

export type ParameterWorkflowAssigneesDto = {
  hardwareCommitterId: string;
  softwareCommitterId: string;
  softwareUserId: string;
};

export type AIConfidenceDto = "high" | "mid" | "low";

export type AIRecommendationDto = "advance" | "needs-review" | "reject";

export type AIReviewSuggestionDto = {
  recommendation: AIRecommendationDto;
  confidence: AIConfidenceDto;
  summary: string;
  reasons: string[];
  similarRequests: string[];
};

export type ImpactItemDto = {
  kind: "module" | "test" | "parameter";
  name: string;
  note: string;
  risk: ParameterRiskLevel;
};

export type ChangeRequestDto = {
  id: string;
  submissionRoundId?: string;
  projectId?: string;
  parameterId: string;
  baseVersion?: number;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  submitterUserId?: string;
  createdAt: string;
  createdAtTs: string;
  updatedAt: string;
  status: ParameterChangeRequestStatus;
  aiSummary: string;
  rejectReason?: string;
  waitingHours: number;
  aiSuggestion: AIReviewSuggestionDto;
  impact: ImpactItemDto[];
  assignedTo?: string;
  workflowAssignees?: ParameterWorkflowAssigneesDto;
  fastTrack?: boolean;
  reviewerNote?: string;
};

export type ParameterSubmissionItemDto = {
  requestId: string;
  parameterId: string;
  name: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  risk: ParameterRiskLevel;
  reason: string;
};

export type ParameterSubmissionRoundDto = {
  id: string;
  projectId: string;
  projectName: string;
  submitter: string;
  createdAt: string;
  status: ParameterSubmissionRoundStatus;
  summary: string;
  workflowAssignees?: ParameterWorkflowAssigneesDto;
  workflowTrail?: SubmissionWorkflowStageDetailDto[];
  items: ParameterSubmissionItemDto[];
};

export type SubmissionWorkflowStageDetailDto = {
  key: "hardware_review" | "software_review" | "software_merge";
  stepIndex: number;
  label: string;
  assigneeName: string;
  executorName?: string;
  executorLabel: "执行人" | "当前处理";
  state: "pending" | "active" | "completed" | "skipped";
};

export type ParameterImportSummaryDto = {
  added: number;
  updated: number;
  unchanged: number;
  conflict: number;
  highRisk: number;
};

export type ParameterImportSourceItemDto = {
  name: string;
  module: string;
  risk: ParameterRiskLevel;
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
};

export type ParameterImportBatchItemDto = ParameterImportSourceItemDto & {
  id: string;
  classification: ImportPreviewClassification;
  riskFlag?: boolean;
};

export type ParameterImportBatchDto = {
  id: string;
  projectId: string;
  sourceName: string;
  status: ParameterImportBatchStatus;
  createdAt: string;
  appliedAt?: string;
  summary: ParameterImportSummaryDto;
  items: ParameterImportBatchItemDto[];
};
