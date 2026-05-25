import type { ChangeRequest, ParameterHistoryEntry, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string;
};

export type ParameterListQuery = {
  projectId?: string;
  module?: string;
  risk?: Array<ParameterRecord["risk"]>;
};

export type ChangeRequestListQuery = {
  projectId?: string;
  status?: Array<ChangeRequest["status"]>;
  assignedTo?: string;
};

export type SubmissionRoundListQuery = {
  projectId?: string;
  status?: Array<ParameterSubmissionRound["status"]>;
};

export type SaveParameterDraftInput = {
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
};

export type ParameterDraftDto = {
  id: string;
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
  updatedAt: string;
};

export type SubmitParameterChangesInput = {
  projectId?: string;
  items: Array<{ parameterId: string; targetValue: string; reason: string }>;
  reason?: string;
};

export type ReviewParameterChangeInput = {
  requestId: string;
  decision: "advance" | "reject";
  note?: string;
  expectedVersion?: number;
};

export type ParameterImportSourceItem = {
  name: string;
  module: string;
  risk: ParameterRecord["risk"];
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
};

export type ParameterImportPreviewInput = {
  projectId: string;
  sourceName: string;
  items: ParameterImportSourceItem[];
};

export type ParameterImportBatchDto = {
  id: string;
  projectId: string;
  sourceName: string;
  status: "previewed" | "applied";
  createdAt: string;
  appliedAt?: string;
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    conflict: number;
    highRisk: number;
  };
  items: ParameterImportSourceItem[];
};

export type ApplyParameterImportBatchInput = {
  batchId: string;
  selectedItemIds?: string[];
  expectedVersion?: number;
};

export interface ParameterRepository {
  listProjects(): Promise<ProjectSummary[]>;
  listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]>;
  getParameter?(parameterId: string): Promise<ParameterRecord>;
  listParameterHistory?(parameterId: string): Promise<ParameterHistoryEntry[]>;
  listDrafts?(projectId?: string): Promise<ParameterDraftDto[]>;
  saveDraft?(input: SaveParameterDraftInput): Promise<ParameterDraftDto>;
  deleteDraft?(draftId: string): Promise<void>;
  listChangeRequests(query?: ChangeRequestListQuery): Promise<ChangeRequest[]>;
  listSubmissionRounds(query?: SubmissionRoundListQuery): Promise<ParameterSubmissionRound[]>;
  submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound>;
  reviewChange?(input: ReviewParameterChangeInput): Promise<ChangeRequest>;
  createImportPreview?(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto>;
  applyImportBatch?(input: ApplyParameterImportBatchInput): Promise<ParameterImportBatchDto>;
}
