import type { ChangeRequest, ParameterHistoryEntry, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string;
};

export type ParameterModuleNode = FlatModuleNode;

export type ParameterListQuery = {
  projectId?: string;
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: Array<ParameterRecord["risk"]>;
  limit?: number;
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
  projectId: string;
  items: Array<
    | {
        parameterId: string;
        targetValue: string;
        reason: string;
      }
    | {
        draftId: string;
        projectParameterBindingId: string;
        parameterSpecId: string;
        targetValue: string;
        reason: string;
      }
  >;
  reason?: string;
  assignees?: {
    hardwareCommitterId: string;
    softwareCommitterId: string;
    softwareUserId: string;
  };
};

export type WorkflowAssigneeCandidate = { id: string; name: string };

export type WorkflowAssigneeCandidates = {
  hardwareCommitters: WorkflowAssigneeCandidate[];
  softwareCommitters: WorkflowAssigneeCandidate[];
  softwareUsers: WorkflowAssigneeCandidate[];
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

export type ParameterImportBatchItem = ParameterImportSourceItem & {
  id: string;
  classification: "added" | "updated" | "unchanged" | "conflict";
  riskFlag?: boolean;
};

export type ParameterImportPreviewInput = {
  projectId: string;
  sourceName: string;
  items: ParameterImportSourceItem[];
  reviewMetadata?: ParameterImportReviewMetadata;
};

export type ParameterImportReviewMetadata = {
  skippedRows?: Array<{ rowKey?: string; name?: string; module?: string; reason: string }>;
  notes?: string;
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
  items: ParameterImportBatchItem[];
};

export type ApplyParameterImportBatchInput = {
  batchId: string;
  selectedItemIds?: string[];
  expectedVersion?: number;
  reviewMetadata?: ParameterImportReviewMetadata;
};

export type DtsImportParseRow = {
  name: string;
  module: string;
  sourceNodePath: string;
  rawText: string;
  normalizedValue: string;
  valueType: string;
  skipSuggested?: boolean;
};

export type DtsImportParseResult = {
  format: "dts-full";
  rows: DtsImportParseRow[];
  diagnostics?: Array<{ severity: "error" | "warning" | "info"; message: string }>;
};

export type ParseDtsImportInput = {
  sourceName: string;
  content: string;
};

export type DiscardParameterDraftsInput = {
  projectId: string;
  parameterIds: string[];
};

export type CreateParameterModuleInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type UpdateParameterModuleInput = {
  name?: string;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type MoveParameterModuleInput = {
  parentId: string | null;
};

export interface ParameterRepository {
  listProjects(): Promise<ProjectSummary[]>;
  listParameterModules(): Promise<ParameterModuleNode[]>;
  listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]>;
  getParameter(parameterId: string): Promise<ParameterRecord>;
  listParameterHistory(parameterId: string): Promise<ParameterHistoryEntry[]>;
  listDrafts(projectId?: string): Promise<ParameterDraftDto[]>;
  saveDraft(input: SaveParameterDraftInput): Promise<ParameterDraftDto>;
  deleteDraft(draftId: string): Promise<void>;
  listChangeRequests(query?: ChangeRequestListQuery): Promise<ChangeRequest[]>;
  listSubmissionRounds(query?: SubmissionRoundListQuery): Promise<ParameterSubmissionRound[]>;
  listWorkflowAssignees(projectId: string): Promise<WorkflowAssigneeCandidates>;
  submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound>;
  withdrawSubmissionRound(roundId: string): Promise<ParameterSubmissionRound>;
  reviewChange(input: ReviewParameterChangeInput): Promise<ChangeRequest>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterImportBatchDto>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
}
