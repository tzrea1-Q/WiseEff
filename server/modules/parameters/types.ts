import type { ParameterChangeStatus, ParameterImportBatchStatus, ParameterRiskLevel } from "./status";

export type ProjectDto = {
  id: string;
  name: string;
  code: string;
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

export type ChangeRequestDto = {
  id: string;
  submissionRoundId?: string;
  projectId?: string;
  parameterId: string;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  createdAt: string;
  createdAtTs: string;
  updatedAt: string;
  status: ParameterChangeStatus;
  aiSummary: string;
  rejectReason?: string;
  waitingHours: number;
  assignedTo?: string;
  fastTrack?: boolean;
  reviewerNote?: string;
};

export type ParameterSubmissionRoundDto = {
  id: string;
  projectId: string;
  projectName: string;
  submitter: string;
  createdAt: string;
  status: ParameterChangeStatus;
  summary: string;
};

export type ParameterImportSummaryDto = {
  added: number;
  updated: number;
  unchanged: number;
  conflict: number;
  highRisk: number;
};

export type ParameterImportSourceItemDto = {
  id?: string;
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

export type ParameterImportBatchDto = {
  id: string;
  projectId: string;
  sourceName: string;
  status: ParameterImportBatchStatus;
  createdAt: string;
  appliedAt?: string;
  summary: ParameterImportSummaryDto;
  items: ParameterImportSourceItemDto[];
};
