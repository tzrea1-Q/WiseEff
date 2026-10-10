import type { ParameterDraftDto } from "./ParameterRepository";
import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  ConfigRevisionSummary,
  TopologyTree,
  TopologyView,
  ValidationRun,
  DtsValue,
} from "@/domain/parameter-topology/types";

export type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  ConfigRevisionSummary,
  TopologyTree,
  TopologyView,
  ValidationRun,
};

export type CreateBindingDraftInput = {
  baseRevisionId: string;
  targetValue?: DtsValue;
  sourceTarget?: { format: "json"; sourceText: string };
  action?: "set" | "delete";
  reason: string;
};

export type BindingDraftResult = {
  draftId: string;
  pending?: boolean;
  currentValueId?: string | null;
  parameterId: string;
  candidateRevisionId: string;
  workingCandidateRevisionId?: string;
  rebasedDraftIds?: string[];
  rawText: string;
  action: "set" | "delete";
  sourceFormat?: "dts" | "json";
  sourceTarget?: { format: "json"; sourceText: string };
  baseRevisionId?: string;
  sourcePinId?: string | null;
  candidateId?: string | null;
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
  displayName?: string | null;
  description?: string | null;
  units?: string | null;
  exampleValue?: unknown;
  coverageClaim?: {
    kind: "overlay-property";
    overlayId?: string;
    overlayPropertyId?: string;
    upsertOverlay?: {
      compatible: string;
      displayName?: string;
      createPropertyLink: true;
    };
  };
};

export type UpdateParameterSpecInput = {
  valueShape?: Record<string, unknown>;
  constraints: Record<string, unknown>;
  documentation: string;
  reason: string;
  displayName?: string | null;
  description?: string | null;
  units?: string | null;
  exampleValue?: unknown;
};

export type DeprecateParameterSpecInput = {
  reason: string;
};

export type RestoreParameterSpecInput = {
  reason: string;
};

export type NodeEnablementDraft = Omit<ParameterDraftDto, "parameterId"> & {
  editSubjectKind: "node-enablement";
  logicalNodeId: string;
};

export type ReattributeParameterSpecInput = {
  attributionSubjectId: string;
  reason: string;
};

export interface ParameterTopologyRepository {
  listBindings(
    projectId: string,
    revisionId: string,
  ): Promise<ProjectParameterBinding[]>;
  /** Optional: per-binding revision history (Task 6). Absent implementations degrade to no history. */
  listBindingHistory?(
    projectId: string,
    bindingId: string,
  ): Promise<BindingHistoryEntry[]>;
  /** Optional: cross-project compare peers (Task 7). Absent implementations degrade to no compare. */
  listBindingCompare?(
    projectId: string,
    bindingId: string,
  ): Promise<BindingCompareEntry[]>;
  listConfigRevisions(
    projectId: string,
    configSetId: string,
  ): Promise<ConfigRevisionSummary[]>;
  getTopology(
    projectId: string,
    configSetId: string,
    revisionId: string,
    view: TopologyView,
  ): Promise<TopologyTree>;
  listMappingTasks(projectId?: string): Promise<IdentityMappingTask[]>;
  validateRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ValidationRun>;
  createBindingDraft(
    projectId: string,
    bindingId: string,
    input: CreateBindingDraftInput,
  ): Promise<BindingDraftResult>;
  createNodeEnablementDraft(
    projectId: string,
    input: CreateNodeEnablementDraftInput,
  ): Promise<NodeEnablementDraftResult>;
  listNodeEnablementDrafts(projectId: string): Promise<NodeEnablementDraft[]>;
}
