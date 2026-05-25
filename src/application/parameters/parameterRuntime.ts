import type {
  ApplyParameterImportBatchInput,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParameterRepository,
  ProjectSummary,
  ReviewParameterChangeInput,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import type {
  ChangeRequest,
  ParameterDraftItem,
  ParameterRecord,
  ParameterSubmissionRound
} from "@/domain/parameters/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export const parameterRuntimeFailureNotification = "参数操作未完成，请稍后重试。";

export type ParameterRuntimeSnapshot = {
  projects: ProjectSummary[];
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  parameterDrafts: ParameterDraftDto[];
};

export type HydrateParameterRuntimeAction = {
  type: "HYDRATE_PARAMETER_RUNTIME";
  projects: ProjectSummary[];
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  parameterDrafts?: ParameterDraftDto[];
};

export type ParameterRuntimeActionFailure = {
  notification: string;
};

export type ParameterRuntimeVoidResult = void | ParameterRuntimeActionFailure;
export type ParameterRuntimeRefreshResult = ParameterRuntimeSnapshot | ParameterRuntimeActionFailure | void;

type ParameterRuntimeDispatchAction =
  | HydrateParameterRuntimeAction
  | { type: "ADD_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[]; reason?: string }
  | { type: "STASH_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] }
  | { type: "ADVANCE_REVIEW"; requestId: string; note?: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string }
  | { type: "IMPORT_PARAMETERS" }
  | { type: "ADD_NOTIFICATION"; message: string };

export type ParameterRuntimeActions = {
  submitChanges(input: SubmitParameterChangesInput): Promise<ParameterRuntimeVoidResult>;
  stashChanges(items: ParameterDraftItem[]): Promise<ParameterRuntimeVoidResult>;
  reviewChange(input: ReviewParameterChangeInput): Promise<ParameterRuntimeVoidResult>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  refresh(): Promise<ParameterRuntimeRefreshResult>;
};

type ParameterRuntimeOptions = {
  runtimeMode: WiseEffRuntimeMode;
  dispatch: (action: ParameterRuntimeDispatchAction) => void;
  repository?: ParameterRepository;
  getParameterProjectId?: (parameterId: string) => string | undefined;
};

function notifyFailure(dispatch: ParameterRuntimeOptions["dispatch"]): ParameterRuntimeActionFailure {
  dispatch({ type: "ADD_NOTIFICATION", message: parameterRuntimeFailureNotification });
  return { notification: parameterRuntimeFailureNotification };
}

function requireRepository(repository?: ParameterRepository): ParameterRepository {
  if (!repository) {
    throw new Error("Parameter repository is required in api runtime mode.");
  }
  return repository;
}

export function createParameterRuntimeActions({
  runtimeMode,
  dispatch,
  repository,
  getParameterProjectId
}: ParameterRuntimeOptions): ParameterRuntimeActions {
  const refresh = async (): Promise<ParameterRuntimeRefreshResult> => {
    if (runtimeMode !== "api") {
      return undefined;
    }

    try {
      const api = requireRepository(repository);
      const [projects, parameters, changeRequests, parameterSubmissionRounds, parameterDrafts] = await Promise.all([
        api.listProjects(),
        api.listParameters(),
        api.listChangeRequests(),
        api.listSubmissionRounds(),
        api.listDrafts()
      ]);
      const snapshot = { projects, parameters, changeRequests, parameterSubmissionRounds, parameterDrafts };

      dispatch({ type: "HYDRATE_PARAMETER_RUNTIME", ...snapshot });
      return snapshot;
    } catch {
      return notifyFailure(dispatch);
    }
  };

  const runApiMutation = async (mutation: (api: ParameterRepository) => Promise<unknown>): Promise<ParameterRuntimeVoidResult> => {
    try {
      const api = requireRepository(repository);
      await mutation(api);
      const result = await refresh();
      return result && "notification" in result ? result : undefined;
    } catch {
      return notifyFailure(dispatch);
    }
  };

  return {
    async submitChanges(input) {
      if (runtimeMode !== "api") {
        dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: input.items, reason: input.reason });
        return undefined;
      }

      return runApiMutation((api) => api.submitParameterChanges(input));
    },
    async stashChanges(items) {
      if (runtimeMode !== "api") {
        dispatch({ type: "STASH_PARAMETER_SUBMISSION_ROUND", items });
        return undefined;
      }

      return runApiMutation(async (api) => {
        await Promise.all(
          items.map((item) => {
            const projectId = getParameterProjectId?.(item.parameterId);
            if (!projectId) {
              throw new Error(`Cannot resolve project for parameter ${item.parameterId}.`);
            }
            return api.saveDraft({
              projectId,
              parameterId: item.parameterId,
              targetValue: item.targetValue,
              reason: item.reason
            });
          })
        );
      });
    },
    async reviewChange(input) {
      if (runtimeMode !== "api") {
        if (input.decision === "reject") {
          dispatch({ type: "REJECT_REVIEW", requestId: input.requestId, reason: input.note ?? "Rejected" });
        } else {
          dispatch({ type: "ADVANCE_REVIEW", requestId: input.requestId, note: input.note });
        }
        return undefined;
      }

      return runApiMutation((api) => api.reviewChange(input));
    },
    async createImportPreview(input) {
      if (runtimeMode !== "api") {
        return {
          id: `mock-import-${Date.now()}`,
          projectId: input.projectId,
          sourceName: input.sourceName,
          status: "previewed",
          createdAt: new Date().toISOString(),
          summary: {
            added: input.items.length,
            updated: 0,
            unchanged: 0,
            conflict: 0,
            highRisk: input.items.filter((item) => item.risk === "High").length
          },
          items: input.items.map((item, index) => ({ ...item, id: `mock-import-item-${index + 1}` }))
        };
      }

      try {
        return await requireRepository(repository).createImportPreview(input);
      } catch {
        return notifyFailure(dispatch);
      }
    },
    async applyImportBatch(input) {
      if (runtimeMode !== "api") {
        dispatch({ type: "IMPORT_PARAMETERS" });
        return undefined;
      }

      return runApiMutation((api) => api.applyImportBatch(input));
    },
    refresh
  };
}
