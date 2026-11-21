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
import { toUserErrorMessage } from "@/infrastructure/http/userErrorMessage";
import { parameterRecordFromBinding } from "@/infrastructure/http/parameterCatalogDtos";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";

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
  return `参数「${parameterName}」已有进行中的变更请求，请先在「变更审阅」中处理后再提交。`;
}

export function formatParameterRuntimeError(error: unknown): string {
  if (error instanceof WiseEffApiError) {
    if (error.code === "CONFLICT") {
      const parameterId = typeof error.details.parameterId === "string" ? error.details.parameterId : undefined;
      if (parameterId && error.message.toLowerCase().includes("open change request")) {
        return formatOpenChangeRequestBlockerMessage(parameterId);
      }
      return toUserErrorMessage(error);
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
        return toUserErrorMessage(error);
      }
      return "导入预览校验失败，请检查逐条核对中的字段是否完整。";
    }
    return toUserErrorMessage(error, parameterRuntimeFailureNotification);
  }
  return parameterRuntimeFailureNotification;
}

export type HydrateParameterRuntimeAction = {
  type: "HYDRATE_PARAMETER_RUNTIME";
  projects: ProjectSummary[];
  parameters: ParameterRecord[];
  changeRequests: ChangeRequest[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  parameterDrafts?: ParameterDraftDto[];
};

export type ProjectParameterStatus = "idle" | "loading" | "ready" | "error";

export type ProjectParameterRuntimeAction =
  | { type: "HYDRATE_PARAMETER_PROJECTS"; projects: ProjectSummary[] }
  | {
      type: "UPDATE_PROJECT_PARAMETER_CACHE";
      projectId: string;
      status?: ProjectParameterStatus;
      parameters?: ParameterRecord[];
      drafts?: ParameterDraftDto[];
    };

export type ParameterRuntimeActionFailure = {
  notification: string;
  alreadyNotified?: boolean;
};

export type ParameterRuntimeVoidResult = void | ParameterRuntimeActionFailure;
export type ParameterRuntimeRefreshResult = { projects: ProjectSummary[] } | ParameterRuntimeVoidResult;
export type ParameterRuntimeRefreshOptions = {
  notifyOnFailure?: boolean;
};

type ParameterRuntimeDispatchAction =
  | HydrateParameterRuntimeAction
  | ProjectParameterRuntimeAction
  | { type: "CLEAR_API_RUNTIME_DOMAIN"; domain: "parameters" }
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
  | { type: "ADD_NOTIFICATION"; message: string };

export type ParameterRuntimeActions = {
  submitChanges(input: SubmitParameterChangesInput): Promise<ParameterRuntimeVoidResult>;
  stashChanges(items: ParameterDraftItem[]): Promise<ParameterRuntimeVoidResult>;
  discardDrafts(input: DiscardParameterDraftsInput): Promise<ParameterRuntimeVoidResult>;
  withdrawSubmissionRound(roundId: string): Promise<ParameterRuntimeVoidResult>;
  reviewChange(input: ReviewParameterChangeInput, options?: ParameterRuntimeRefreshOptions): Promise<ParameterRuntimeVoidResult>;
  listWorkflowAssignees(projectId: string): ReturnType<ParameterRepository["listWorkflowAssignees"]>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto | ParameterRuntimeActionFailure>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterImportBatchDto | ParameterRuntimeVoidResult>;
  parseDtsImport(input: ParseDtsImportInput): Promise<DtsImportParseResult>;
  refresh(options?: ParameterRuntimeRefreshOptions): Promise<ParameterRuntimeRefreshResult>;
  loadProjectParameters(projectId: string, options?: { force?: boolean }): ProjectParameterRead;
  ensureProjectParameters(projectIds: readonly string[], options?: ProjectParameterLoadOptions): Promise<ParameterRuntimeVoidResult>;
};

type ProjectParameterLoadOptions = ParameterRuntimeRefreshOptions & { force?: boolean };

type ProjectParameterRead = {
  bindings: ReturnType<NonNullable<ParameterCatalogRepository["listProtectedProjectBindings"]>>;
  drafts: Promise<ParameterDraftDto[]>;
  settled: Promise<ParameterRuntimeVoidResult>;
};

type ParameterRuntimeOptions = {
  runtimeMode: WiseEffRuntimeMode;
  dispatch: (action: ParameterRuntimeDispatchAction) => void;
  repository?: ParameterRepository;
  canonicalRepository?: Pick<ParameterCatalogRepository, "listProtectedProjectBindings">;
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
  canonicalRepository,
  getParameterProjectId
}: ParameterRuntimeOptions): ParameterRuntimeActions {
  let refreshGeneration = 0;
  // Entry identity is the generation for both reads. A forced load supersedes
  // in-flight work for this project alone.
  const projectReads = new Map<string, ProjectParameterRead>();
  let visibleProjectIds: Set<string> | undefined;

  const loadProjectParameters: ParameterRuntimeActions["loadProjectParameters"] = (projectId, options) => {
    if (runtimeMode !== "api" || !projectId || (visibleProjectIds && !visibleProjectIds.has(projectId))) {
      const unavailable = Promise.reject(new Error("Project parameters are unavailable in this scope."));
      return { bindings: unavailable, drafts: unavailable, settled: unavailable.catch(() => undefined) };
    }
    const cached = projectReads.get(projectId);
    if (cached && !options?.force) return cached;

    const readProject = async <T,>(
      read: () => Promise<T>,
      latest: (read: ProjectParameterRead) => Promise<T>,
      publish: (value?: T) => void
    ): Promise<T> => {
      try {
        const value = await read();
        if (projectReads.get(projectId) === entry) {
          publish(value);
          return value;
        }
      } catch (error) {
        if (projectReads.get(projectId) === entry) {
          if (error instanceof WiseEffApiError && (error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED")) publish();
          throw error;
        }
      }
      const current = projectReads.get(projectId);
      if (!current) throw new Error("Parameter project scope changed.");
      return latest(current);
    };

    const entry: ProjectParameterRead = {
      bindings: readProject(async () => {
        if (!canonicalRepository?.listProtectedProjectBindings) throw new Error("Canonical Binding repository is required in api runtime mode.");
        return canonicalRepository.listProtectedProjectBindings(projectId);
      }, (current) => current.bindings, (response) => dispatch({
        type: "UPDATE_PROJECT_PARAMETER_CACHE",
        projectId,
        parameters: (response?.items ?? [])
          .filter((binding) => !binding.projectId || binding.projectId === projectId)
          .map((binding) => parameterRecordFromBinding(projectId, binding))
      })),
      drafts: readProject(async () => requireRepository(repository).listDrafts(projectId),
        (current) => current.drafts, (drafts) => dispatch({
          type: "UPDATE_PROJECT_PARAMETER_CACHE",
          projectId,
          drafts: (drafts ?? []).filter((draft) => draft.projectId === projectId)
        })),
      settled: Promise.resolve()
    };
    projectReads.set(projectId, entry);
    dispatch({ type: "UPDATE_PROJECT_PARAMETER_CACHE", projectId, status: "loading" });
    entry.settled = Promise.allSettled([entry.bindings, entry.drafts]).then((results) => {
      if (projectReads.get(projectId) !== entry) return projectReads.get(projectId)?.settled;
      const failure = results.find((result) => result.status === "rejected");
      dispatch({ type: "UPDATE_PROJECT_PARAMETER_CACHE", projectId, status: failure ? "error" : "ready" });
      if (failure) return { notification: formatParameterRuntimeError(failure.reason) };
    });
    return entry;
  };

  const ensureProjectParameters: ParameterRuntimeActions["ensureProjectParameters"] = async (projectIds, options) => {
    if (runtimeMode !== "api") return;
    const results = await Promise.all([...new Set(projectIds)]
      .filter((projectId) => projectId && (!visibleProjectIds || visibleProjectIds.has(projectId)))
      .map((projectId) => loadProjectParameters(projectId, options).settled));
    const failure = results.find((result) => result?.notification);
    if (failure) return notifyFailure(dispatch, { notifyOnFailure: false, ...options }, failure.notification);
  };

  const refresh = async (options: ParameterRuntimeRefreshOptions = {}): Promise<ParameterRuntimeRefreshResult> => {
    if (runtimeMode !== "api") {
      return undefined;
    }
    const generation = ++refreshGeneration;

    try {
      const projects = await requireRepository(repository).listProjects();
      if (generation !== refreshGeneration) return undefined;
      visibleProjectIds = new Set(projects.map((project) => project.id));
      for (const projectId of projectReads.keys()) {
        if (!visibleProjectIds.has(projectId)) projectReads.delete(projectId);
      }
      dispatch({ type: "HYDRATE_PARAMETER_PROJECTS", projects });
      return { projects };
    } catch (error) {
      if (generation !== refreshGeneration) return undefined;
      projectReads.clear();
      visibleProjectIds = new Set();
      dispatch({ type: "CLEAR_API_RUNTIME_DOMAIN", domain: "parameters" });
      return notifyFailure(dispatch, options, formatParameterRuntimeError(error));
    }
  };

  const runApiMutation = async <T,>(
    mutation: (api: ParameterRepository) => Promise<T>,
    affectedProjects: (result: T) => readonly string[],
    options: ParameterRuntimeRefreshOptions = {}
  ): Promise<ParameterRuntimeVoidResult> => {
    try {
      const result = await mutation(requireRepository(repository));
      return await ensureProjectParameters(affectedProjects(result), { notifyOnFailure: true, ...options, force: true });
    } catch (error) {
      return notifyFailure(dispatch, options, formatParameterRuntimeError(error));
    }
  };

  return {
    async listWorkflowAssignees(projectId) {
      if (runtimeMode !== "api") {
        return { hardwareCommitters: [], softwareCommitters: [], softwareUsers: [] };
      }
      return requireRepository(repository).listWorkflowAssignees(projectId);
    },
    async submitChanges(input) {
      if (runtimeMode !== "api") {
        if (input.items.some((item) => "draftId" in item)) {
          throw new Error("Binding draft submission is only available in API runtime mode.");
        }
        const items = input.items.map((item) => {
          if ("draftId" in item) throw new Error("Binding draft submission is only available in API runtime mode.");
          return item;
        });
        dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items, reason: input.reason, assignees: input.assignees });
        return undefined;
      }

      return runApiMutation((api) => api.submitParameterChanges(input), () => [input.projectId]);
    },
    async stashChanges(items) {
      if (runtimeMode !== "api") {
        dispatch({ type: "STASH_PARAMETER_SUBMISSION_ROUND", items });
        return undefined;
      }

      const drafts = items.map((item) => ({ ...item, projectId: getParameterProjectId?.(item.parameterId) }));
      if (drafts.some((draft) => !draft.projectId)) return notifyFailure(dispatch);
      const projectIds = drafts.map((draft) => draft.projectId!);
      return runApiMutation(async (api) => {
        const results = await Promise.allSettled(drafts.map((draft) => api.saveDraft({ ...draft, projectId: draft.projectId! })));
        const failure = results.find((result) => result.status === "rejected");
        if (failure) {
          await ensureProjectParameters(projectIds, { force: true });
          throw failure.reason;
        }
      }, () => projectIds);
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
        const results = await Promise.allSettled(draftsToDelete.map((draft) => api.deleteDraft(draft.id, input.projectId)));
        const failure = results.find((result) => result.status === "rejected");
        if (failure) {
          await ensureProjectParameters([input.projectId], { force: true });
          throw failure.reason;
        }
      }, () => [input.projectId]);
    },
    async withdrawSubmissionRound(roundId) {
      if (runtimeMode !== "api") {
        dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId });
        return undefined;
      }

      return runApiMutation((api) => api.withdrawSubmissionRound(roundId), (round) => [round.projectId]);
    },
    async reviewChange(input, options) {
      if (runtimeMode !== "api") {
        if (input.decision === "reject") {
          dispatch({ type: "REJECT_REVIEW", requestId: input.requestId, reason: input.note ?? "Rejected" });
        } else {
          dispatch({ type: "ADVANCE_REVIEW", requestId: input.requestId, note: input.note });
        }
        return undefined;
      }

      return runApiMutation((api) => api.reviewChange(input), (request) => [
        request.projectId ?? getParameterProjectId?.(request.parameterId) ?? ""
      ], options);
    },
    async createImportPreview(input) {
      if (runtimeMode !== "api") {
        if (repository) {
          try {
            return await repository.createImportPreview(input);
          } catch (error) {
            return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
          }
        }
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
        const result = await ensureProjectParameters([input.projectId], { force: true, notifyOnFailure: true });
        return result ?? preview;
      } catch (error) {
        return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
      }
    },
    async applyImportBatch(input) {
      if (runtimeMode !== "api") {
        if (!repository) {
          return notifyFailure(dispatch, {}, "参数导入未完成：mock 运行时未接入参数仓库。");
        }
        try {
          const applied = await repository.applyImportBatch(input);
          const projects = await repository.listProjects();
          const [parameterGroups, changeRequests, parameterSubmissionRounds, parameterDrafts] = await Promise.all([
            Promise.all(projects.map((project) => repository.listParameters({ projectId: project.id, limit: 500 }))),
            repository.listChangeRequests(),
            repository.listSubmissionRounds(),
            repository.listDrafts()
          ]);
          dispatch({
            type: "HYDRATE_PARAMETER_RUNTIME",
            projects,
            parameters: parameterGroups.flat(),
            changeRequests,
            parameterSubmissionRounds,
            parameterDrafts
          });
          dispatch({
            type: "ADD_NOTIFICATION",
            message: `项目值批量导入完成：新增 ${applied.summary.added} 项，更新 ${applied.summary.updated} 项，冲突 ${applied.summary.conflict} 项`
          });
          return undefined;
        } catch (error) {
          return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
        }
      }

      try {
        const staged = await requireRepository(repository).applyImportBatch(input);
        const result = await ensureProjectParameters([staged.projectId], { force: true, notifyOnFailure: true });
        return result ?? staged;
      } catch (error) {
        return notifyFailure(dispatch, {}, formatParameterRuntimeError(error));
      }
    },
    async parseDtsImport(input) {
      if (runtimeMode !== "api") {
        return mockParseDtsImportContent(input);
      }
      return requireRepository(repository).parseDtsImport(input);
    },
    refresh,
    loadProjectParameters,
    ensureProjectParameters
  };
}
