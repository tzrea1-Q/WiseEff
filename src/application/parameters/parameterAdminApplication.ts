import type {
  ActivateParameterSpecInput,
  ParameterTopologyRepository,
  ResolveSpecReviewInput
} from "@/application/ports/ParameterTopologyRepository";
import type {
  ParameterSpecDetail,
  ParameterSpecSummary,
  SpecQuery,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery
} from "@/domain/parameter-topology/types";

/**
 * Single application facade for the parameter admin surface.
 * Panels depend on this seam only — never on multiple HTTP/mock clients.
 */
export type ParameterAdminApplication = {
  listSpecs(query?: SpecQuery): Promise<ParameterSpecSummary[]>;
  getSpec(specId: string): Promise<ParameterSpecDetail>;
  listSpecReviewTasks(query?: SpecReviewTaskQuery): Promise<SpecReviewTaskListResult>;
  resolveSpecReviewTask(taskId: string, input: ResolveSpecReviewInput): Promise<void>;
  activateParameterSpec(specId: string, input: ActivateParameterSpecInput): Promise<ParameterSpecDetail>;
};

export type CreateParameterAdminApplicationOptions = {
  topology: ParameterTopologyRepository;
};

export function createParameterAdminApplication({
  topology
}: CreateParameterAdminApplicationOptions): ParameterAdminApplication {
  return {
    listSpecs(query = {}) {
      return topology.listSpecs(query);
    },
    getSpec(specId) {
      return topology.getSpec(specId);
    },
    listSpecReviewTasks(query = {}) {
      return topology.listSpecReviewTasks(query);
    },
    resolveSpecReviewTask(taskId, input) {
      return topology.resolveSpecReviewTask(taskId, input);
    },
    activateParameterSpec(specId, input) {
      return topology.activateParameterSpec(specId, input);
    }
  };
}
