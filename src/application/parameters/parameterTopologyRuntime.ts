import type {
  BindingDraftResult,
  CreateBindingDraftInput,
  ParameterTopologyRepository
} from "@/application/ports/ParameterTopologyRepository";
import type {
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveMappingInput,
  ResolveSpecReviewInput,
  SpecQuery,
  SpecReviewTask,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  TopologyTree,
  TopologyView,
  ValidationRun
} from "@/domain/parameter-topology/types";
import {
  mapParameterTopologyError,
  type ParameterTopologyMappedError
} from "@/infrastructure/http/parameterTopologyClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export type ParameterTopologyRuntimeAction =
  | { type: "TOPOLOGY_SPECS_READY"; specs: ParameterSpecSummary[] }
  | { type: "TOPOLOGY_SPEC_READY"; spec: ParameterSpecDetail }
  | { type: "TOPOLOGY_SPEC_REVIEW_TASKS_READY"; tasks: SpecReviewTask[]; nextCursor: string | null }
  | { type: "TOPOLOGY_SPEC_REVIEW_RESOLVED"; taskId: string }
  | { type: "TOPOLOGY_BINDINGS_READY"; projectId: string; revisionId: string; bindings: ProjectParameterBinding[] }
  | { type: "TOPOLOGY_TREE_READY"; tree: TopologyTree }
  | { type: "TOPOLOGY_MAPPING_TASKS_READY"; tasks: IdentityMappingTask[] }
  | { type: "TOPOLOGY_MAPPING_RESOLVED"; taskId: string }
  | { type: "TOPOLOGY_VALIDATION_READY"; run: ValidationRun }
  | { type: "TOPOLOGY_DRAFT_READY"; draft: BindingDraftResult }
  | { type: "TOPOLOGY_ERROR"; error: ParameterTopologyMappedError }
  | { type: "TOPOLOGY_CANCELLED" };

export type ParameterTopologyRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ParameterTopologyMappedError };

type Options = {
  runtimeMode: WiseEffRuntimeMode;
  dispatch: (action: ParameterTopologyRuntimeAction) => void;
  repository?: ParameterTopologyRepository;
};

function requireRepository(repository?: ParameterTopologyRepository): ParameterTopologyRepository {
  if (!repository) {
    throw new Error("Parameter topology repository is required in api runtime mode.");
  }
  return repository;
}

function isCancelled(error: ParameterTopologyMappedError): boolean {
  return error.kind === "cancelled";
}

/**
 * Runtime seam for semantic topology APIs.
 * Structured diagnostics and 409 stale-revision stay as mapped objects — never generic strings.
 */
export function createParameterTopologyRuntime({ runtimeMode, dispatch, repository }: Options) {
  async function run<T>(
    work: (api: ParameterTopologyRepository) => Promise<T>,
    onSuccess: (value: T) => ParameterTopologyRuntimeAction
  ): Promise<ParameterTopologyRuntimeResult<T>> {
    if (runtimeMode !== "api") {
      const error: ParameterTopologyMappedError = {
        kind: "unknown",
        message: "Parameter topology APIs require api runtime mode.",
        cause: undefined
      };
      dispatch({ type: "TOPOLOGY_ERROR", error });
      return { ok: false, error };
    }

    try {
      const value = await work(requireRepository(repository));
      dispatch(onSuccess(value));
      return { ok: true, value };
    } catch (cause) {
      const error = mapParameterTopologyError(cause);
      if (isCancelled(error)) {
        dispatch({ type: "TOPOLOGY_CANCELLED" });
      } else {
        dispatch({ type: "TOPOLOGY_ERROR", error });
      }
      return { ok: false, error };
    }
  }

  return {
    listSpecs(query: SpecQuery = {}) {
      return run((api) => api.listSpecs(query), (specs) => ({ type: "TOPOLOGY_SPECS_READY", specs }));
    },
    getSpec(specId: string) {
      return run((api) => api.getSpec(specId), (spec) => ({ type: "TOPOLOGY_SPEC_READY", spec }));
    },
    listSpecReviewTasks(query: SpecReviewTaskQuery = {}) {
      return run(
        (api) => api.listSpecReviewTasks(query),
        (result: SpecReviewTaskListResult) => ({
          type: "TOPOLOGY_SPEC_REVIEW_TASKS_READY",
          tasks: result.items,
          nextCursor: result.nextCursor
        })
      );
    },
    resolveSpecReviewTask(taskId: string, input: ResolveSpecReviewInput) {
      return run(
        async (api) => {
          await api.resolveSpecReviewTask(taskId, input);
          return taskId;
        },
        (resolvedTaskId) => ({ type: "TOPOLOGY_SPEC_REVIEW_RESOLVED", taskId: resolvedTaskId })
      );
    },
    listBindings(projectId: string, revisionId: string) {
      return run(
        (api) => api.listBindings(projectId, revisionId),
        (bindings) => ({ type: "TOPOLOGY_BINDINGS_READY", projectId, revisionId, bindings })
      );
    },
    getTopology(projectId: string, configSetId: string, revisionId: string, view: TopologyView) {
      return run(
        (api) => api.getTopology(projectId, configSetId, revisionId, view),
        (tree) => ({ type: "TOPOLOGY_TREE_READY", tree })
      );
    },
    listMappingTasks(projectId?: string) {
      return run(
        (api) => api.listMappingTasks(projectId),
        (tasks) => ({ type: "TOPOLOGY_MAPPING_TASKS_READY", tasks })
      );
    },
    resolveMapping(taskId: string, input: ResolveMappingInput) {
      return run(
        async (api) => {
          await api.resolveMapping(taskId, input);
          return taskId;
        },
        (resolvedTaskId) => ({ type: "TOPOLOGY_MAPPING_RESOLVED", taskId: resolvedTaskId })
      );
    },
    validateRevision(projectId: string, revisionId: string) {
      return run(
        (api) => api.validateRevision(projectId, revisionId),
        (runResult) => ({ type: "TOPOLOGY_VALIDATION_READY", run: runResult })
      );
    },
    createBindingDraft(projectId: string, bindingId: string, input: CreateBindingDraftInput) {
      return run(
        (api) => api.createBindingDraft(projectId, bindingId, input),
        (draft) => ({ type: "TOPOLOGY_DRAFT_READY", draft })
      );
    }
  };
}

export type ParameterTopologyRuntime = ReturnType<typeof createParameterTopologyRuntime>;
