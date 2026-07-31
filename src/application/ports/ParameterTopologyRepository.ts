import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ParameterSpecCutoverSummary,
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
  ParameterSpecCutoverSummary,
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

export type CreateNodeEnablementDraftInput = {
  logicalNodeId: string;
  baseRevisionId: string;
  target: "force-enabled" | "force-disabled" | "unstated";
  reason: string;
  acknowledgeNonstandard?: boolean;
  spellingOverride?: "ok" | "okay";
};

export type NodeEnablementDraftResult = {
  draftId: string;
  candidateRevisionId: string;
  workingCandidateRevisionId?: string;
  rebasedDraftIds?: string[];
  rawText: string;
  action: "set" | "delete";
  logicalNodeId: string;
  target: "force-enabled" | "force-disabled" | "unstated";
  previousRaw?: string | null;
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
  coverageClaim?: {
    kind: "overlay-property" | "pinned-schema-property";
    overlayId?: string;
    overlayPropertyId?: string;
    upsertOverlay?: {
      compatible: string;
      displayName?: string;
      createPropertyLink: true;
    };
  };
};

export type CreateParameterSpecInput = {
  attributionSubjectId: string;
  propertyKey: string;
  reason: string;
  displayName?: string;
  description?: string;
  documentation?: string;
  valueShape?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  units?: string | null;
  exampleValue?: unknown;
  overridePlatform?: boolean;
};

export type UpdateParameterSpecInput = {
  valueShape?: Record<string, unknown>;
  constraints: Record<string, unknown>;
  documentation: string;
  reason: string;
  displayName?: string;
  description?: string;
  units?: string | null;
  exampleValue?: unknown;
  policyTarget?: unknown;
};

export interface ParameterTopologyRepository {
  listSpecs(query: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
  createParameterSpec(input: CreateParameterSpecInput): Promise<ParameterSpecDetail>;
  activateParameterSpec(specId: string, input: ActivateParameterSpecInput): Promise<ParameterSpecDetail>;
  updateParameterSpec(specId: string, input: UpdateParameterSpecInput): Promise<ParameterSpecDetail>;
  deprecateParameterSpec(specId: string, input: { reason: string }): Promise<ParameterSpecDetail>;
  restoreParameterSpec(specId: string, input: { reason: string }): Promise<ParameterSpecDetail>;
  getSpecVersionCutoverImpact(specId: string): Promise<ParameterSpecCutoverSummary>;
  prepareSpecVersionCutover(
    specId: string,
    input?: { reason?: string }
  ): Promise<ParameterSpecDetail>;
  finalizeSpecVersionCutover(specId: string, input: { reason: string }): Promise<ParameterSpecDetail>;
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
  createNodeEnablementDraft(
    projectId: string,
    input: CreateNodeEnablementDraftInput
  ): Promise<NodeEnablementDraftResult>;
}
