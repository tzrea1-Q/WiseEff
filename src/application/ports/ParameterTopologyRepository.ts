import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveMappingInput,
  ResolveSpecReviewInput,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  TopologyTree,
  TopologyView,
  ValidationRun,
  DtsValue
} from "@/domain/parameter-topology/types";

export type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveMappingInput,
  ResolveSpecReviewInput,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  TopologyTree,
  TopologyView,
  ValidationRun
};

export type CreateBindingDraftInput = {
  baseRevisionId: string;
  targetValue?: DtsValue;
  action?: "set" | "delete";
  reason: string;
};

export type BindingDraftResult = {
  draftId: string;
  parameterId: string;
  candidateRevisionId: string;
  workingCandidateRevisionId?: string;
  rebasedDraftIds?: string[];
  rawText: string;
  action: "set" | "delete";
  parameterSpecId: string;
  projectParameterBindingId: string;
  writeTarget: {
    role: string;
    propertyKey: string;
    targetRef?: string | null;
  };
  overlayFileId: string;
  overlayFileName: string;
};

export type ActivateParameterSpecInput = {
  valueShape: Record<string, unknown>;
  constraints: Record<string, unknown>;
  documentation: string;
  reason: string;
  displayName?: string;
  description?: string;
};

export interface ParameterTopologyRepository {
  listSpecs(query: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
  activateParameterSpec(specId: string, input: ActivateParameterSpecInput): Promise<ParameterSpecDetail>;
  listSpecReviewTasks(query?: SpecReviewTaskQuery): Promise<SpecReviewTaskListResult>;
  resolveSpecReviewTask(taskId: string, input: ResolveSpecReviewInput): Promise<void>;
  listBindings(projectId: string, revisionId: string): Promise<ProjectParameterBinding[]>;
  /** Optional: per-binding revision history (Task 6). Absent implementations degrade to no history. */
  listBindingHistory?(projectId: string, bindingId: string): Promise<BindingHistoryEntry[]>;
  /** Optional: cross-project compare peers (Task 7). Absent implementations degrade to no compare. */
  listBindingCompare?(projectId: string, bindingId: string): Promise<BindingCompareEntry[]>;
  getTopology(
    projectId: string,
    configSetId: string,
    revisionId: string,
    view: TopologyView
  ): Promise<TopologyTree>;
  listMappingTasks(projectId?: string): Promise<IdentityMappingTask[]>;
  resolveMapping(taskId: string, input: ResolveMappingInput): Promise<void>;
  validateRevision(projectId: string, revisionId: string): Promise<ValidationRun>;
  createBindingDraft(
    projectId: string,
    bindingId: string,
    input: CreateBindingDraftInput
  ): Promise<BindingDraftResult>;
}
