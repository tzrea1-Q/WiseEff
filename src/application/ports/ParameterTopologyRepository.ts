import type {
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
  candidateRevisionId: string;
  rawText: string;
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
