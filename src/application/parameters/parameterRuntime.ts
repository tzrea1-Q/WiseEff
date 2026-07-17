import type {
  ApplyParameterImportBatchInput,
  DiscardParameterDraftsInput,
  DtsImportParseResult,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParameterRepository,
  ParseDtsImportInput,
  ProjectSummary,
  ReviewParameterChangeInput,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { mockParseDtsImportContent } from "@/infrastructure/mock/mockDtsImportParse";
import type {
  ChangeRequest,
  ParameterDraftItem,
  ParameterRecord,
  ParameterSubmissionRound
} from "@/domain/parameters/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export const parameterRuntimeFailureNotification = "参数操作未完成，请稍后重试。";

const closedChangeRequestStatuses = new Set<ChangeRequest["status"]>(["已合入", "已打回"]);

export function isOpenChangeRequest(request: Pick<ChangeRequest, "status">): boolean {
  return !closedChangeRequestStatuses.has(request.status);
}

export function findOpenChangeRequestForParameter(
  changeRequests: ChangeRequest[],
  projectId: string,
  parameterId: string
): ChangeRequest | undefined {
  return changeRequests.find(
    (request) =>
      request.parameterId === parameterId &&
      (request.projectId === undefined || request.projectId === projectId) &&
      isOpenChangeRequest(request)
  );
}

export function formatOpenChangeRequestBlockerMessage(parameterName: string): string {
  return `参数「${parameterName}」已有进行中的变更请求，请先在「参数审阅」中处理后再提交。`;
}

export function formatParameterRuntimeError(error: unknown): string {
  if (error instanceof WiseEffApiError) {
    if (error.code === "CONFLICT") {
      const parameterId = typeof error.details.parameterId === "string" ? error.details.parameterId : undefined;
      if (parameterId && error.message.toLowerCase().includes("open change request")) {
        return formatOpenChangeRequestBlockerMessage(parameterId);
      }
      if (error.message) {
        return error.message;
      }
    }
    if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") {
      return "当前账号无权执行此操作，请重新登录或切换角色。";
    }
    if (error.code === "VALIDATION_FAILED") {
      const issues = error.details.issues;
      if (Array.isArray(issues) && issues.length > 0) {
        const firstIssue = issues[0] as { message?: string; path?: Array<string | number> };
        const path = Array.isArray(firstIssue.path) ? firstIssue.path.filter((segment) => segment !== "items").join(".") : "";
        const detail = firstIssue.message ?? error.message;
        return path ? `导入预览校验失败（${path}）：${detail}` : detail || "导入预览校验失败，请检查逐条核对中的字段是否完整。";
      }
      if (error.message && error.message !== "Invalid parameter route input.") {
        return error.message;
      }
      return "导入预览校验失败，请检查逐条核对中的字段是否完整。";
    }
    if (error.message) {
      return error.message;
    }
  }
  return parameterRuntimeFailureNotification;
}

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
  alreadyNotified?: boolean;
};

export type ParameterRuntimeVoidResult = void | ParameterRuntimeActionFailure;
export type ParameterRuntimeRefreshResult = ParameterRuntimeSnapshot | ParameterRuntimeActionFailure | void;
export type ParameterRuntimeRefreshOptions = {
  notifyOnFailure?: boolean;
};

type ParameterRuntimeDispatchAction =
  | HydrateParameterRuntimeAction
  | {
      type: "ADD_PARAMETER_SUBMISSION_ROUND";
      items: ParameterDraftItem[];
      reason?: string;
      assignees?: {
        hardwareCommitterId: string;
        softwareCommitterId: string;
        softwareUserId: string;
      };
    }
  | { type: "STASH_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] }
  | { type: "DISCARD_STASHED_PARAMETER_DRAFTS"; projectId: string; parameterIds: string[] }
  | { type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND"; roundId: string }
  | { type: "ADVANCE_REVIEW"; requestId: string; note?: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string }
  | { type: "IMPORT_PARAMETERS" }
  | { type: "ADD_NOTIFICATION"; message: string };

export type ParameterRuntimeActions = {
  getParameter(parameterId: string): Promise<ParameterRecord>;
  submitChanges(input: SubmitParameterChangesInput): Promise<ParameterRuntimeVoidResult>;
  stashChanges(items: ParameterDraftItem[]): Promise<ParameterRuntimeVoidResult>;
  discardDrafts(input: DiscardParameterDraftsInput): Promise<ParameterRuntimeVoidResult>;
  withdrawSubmissionRound(roundId: string): Promise<ParameterRuntimeVoidResult>;
  reviewChange(input: ReviewParameterChangeInput): Promise<ParameterRuntimeVoidResult>;
  listWorkflowAssignees(projectId: string): ReturnType<ParameterRepository["listWorkflowAssignees"]>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
  refresh(options?: ParameterRuntimeRefreshOptions): Promise<ParameterRuntimeRefreshResult>;
};

type ParameterRuntimeOptions = {
  runtimeMode: WiseEffRuntimeMode;
  dispatch: (action: ParameterRuntimeDispatchAction) => void;
  repository?: ParameterRepository;
  getParameterProjectId?: (parameterId: string) => string | undefined;
};

function notifyFailure(
  dispatch: ParameterRuntimeOptions["dispatch"],
  options: ParameterRuntimeRefreshOptions = {},
  message: string = parameterRuntimeFailureNotification
): ParameterRuntimeActionFailure {
  if (options.notifyOnFailure !== false) {
    dispatch({ type: "ADD_NOTIFICATION", message });
    return { notification: message, alreadyNotified: true };
  }
  return { notification: message };
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
  const refresh = async (options: ParameterRuntimeRefreshOptions = {}): Promise<ParameterRuntimeRefreshResult> => {
    if (runtimeMode !== "api") {
      return undefined;
    }

    try {
      const api = requireRepository(repository);
      const projectsPromise = api.listProjects();
      const changeRequestsPromise = api.listChangeRequests();
      const submissionRoundsPromise = api.listSubmissionRounds();
      const draftsPromise = api.listDrafts();
      const projects = await projectsPromise;
      const [parameterGroups, changeRequests, parameterSubmissionRounds, parameterDrafts] = await Promise.all([
        Promise.all(projects.map((project) => api.listParameters({ projectId: project.id, limit: 500 }))),
        changeRequestsPromise,
        submissionRoundsPromise,
        draftsPromise
      ]);
      const parameters = parameterGroups.flat();
      const snapshot = { projects, parameters, changeRequests, parameterSubmissionRounds, parameterDrafts };

      dispatch({ type: "HYDRATE_PARAMETER_RUNTIME", ...snapshot });
      return snapshot;
    } catch (error) {
      return notifyFailure(dispatch, options, formatParameterRuntimeError(error));
    }
  };

  const runApiMutation = async (mutation: (api: ParameterRepository) => Promise<unknown>): Promise<ParameterRuntimeVoidResult> => {
    try {
      const api = requireRepository(repository);
      await mutation(api);
      const result = await refresh();
      return result && "notification" in result ? result : undefined;
    } catch (error) {
      return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
    }
  };

  return {
    async listWorkflowAssignees(projectId) {
      if (runtimeMode !== "api") {
        return { hardwareCommitters: [], softwareCommitters: [], softwareUsers: [] };
      }
      return requireRepository(repository).listWorkflowAssignees(projectId);
    },
    async getParameter(parameterId) {
      if (runtimeMode !== "api") {
        throw new Error("Parameter detail loading is only available in api runtime mode.");
      }

      try {
        return await requireRepository(repository).getParameter(parameterId);
      } catch (error) {
        const message = formatParameterRuntimeError(error);
        notifyFailure(dispatch, {}, message);
        throw new Error(message);
      }
    },
    async submitChanges(input) {
      if (runtimeMode !== "api") {
        dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: input.items, reason: input.reason, assignees: input.assignees });
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
    async discardDrafts(input) {
      if (runtimeMode !== "api") {
        dispatch({ type: "DISCARD_STASHED_PARAMETER_DRAFTS", ...input });
        return undefined;
      }

      if (input.parameterIds.length === 0) {
        return undefined;
      }

      return runApiMutation(async (api) => {
        const drafts = await api.listDrafts(input.projectId);
        const parameterIds = new Set(input.parameterIds);
        const draftsToDelete = drafts.filter((draft) => parameterIds.has(draft.parameterId));
        await Promise.all(draftsToDelete.map((draft) => api.deleteDraft(draft.id)));
      });
    },
    async withdrawSubmissionRound(roundId) {
      if (runtimeMode !== "api") {
        dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId });
        return undefined;
      }

      return runApiMutation((api) => api.withdrawSubmissionRound(roundId));
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
          items: input.items.map((item, index) => ({
            ...item,
            id: `mock-import-item-${index + 1}`,
            classification: "added",
            riskFlag: item.risk === "High"
          }))
        };
      }

      try {
        const preview = await requireRepository(repository).createImportPreview(input);
        const result = await refresh();
        return result && "notification" in result ? result : preview;
      } catch (error) {
        return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
      }
    },
    async applyImportBatch(input) {
      if (runtimeMode !== "api") {
        dispatch({ type: "IMPORT_PARAMETERS" });
        return undefined;
      }

      return runApiMutation((api) => api.applyImportBatch(input));
    },
    async parseDtsImport(input) {
      if (runtimeMode !== "api") {
        return mockParseDtsImportContent(input);
      }
      return requireRepository(repository).parseDtsImport(input);
    },
    refresh
  };
}
