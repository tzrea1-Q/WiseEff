import type {
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveMappingInput,
  SpecQuery,
  TopologyTree,
  TopologyView,
  ValidationRun
} from "@/domain/parameter-topology/types";

export type {
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveMappingInput,
  SpecQuery,
  TopologyTree,
  TopologyView,
  ValidationRun
};

export interface ParameterTopologyRepository {
  listSpecs(query: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
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
}
