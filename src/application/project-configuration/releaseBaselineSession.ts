import type {
  DtsCompareBaselineResult,
  DtsReleaseBaseline,
  DtsReleaseBaselineResult,
  DtsReleaseReadiness,
  DtsRestorePreviewResult,
  DtsRollbackBaselineResult,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import {
  releaseReadinessAllowsCreate,
  releaseReadinessAllowsRelease
} from "@/application/project-configuration/releaseReadinessGates";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";

/**
 * Every command failure must land in `actionError` — repo throws (network,
 * stale gateToken, 409) included, not only the local pre-flight gates.
 * Copy goes through the presentError layer so raw backend text never renders.
 */
function describeBaselineActionError(error: unknown, fallback: string): string {
  if (error instanceof WiseEffApiError) {
    const detailCode = typeof error.details?.code === "string" ? error.details.code : "";
    if (detailCode.startsWith("readiness-")) {
      return "就绪状态已变化，请重新查看就绪问题后再操作。";
    }
  }
  return presentError(error, fallback);
}

export type ReleaseBaselineRepository = Pick<
  DtsStructuredRepository,
  | "listBaselines"
  | "getBaseline"
  | "getReleaseReadiness"
  | "createBaseline"
  | "compareBaseline"
  | "previewRestoreBaseline"
  | "rollbackBaseline"
  | "releaseBaseline"
>;

export type ReleaseBaselineSessionSnapshot = {
  baselines: DtsReleaseBaseline[];
  baselinesLoading: boolean;
  baselinesError: string;
  readiness: DtsReleaseReadiness | null;
  readinessLoading: boolean;
  readinessError: string;
  acknowledgedWarningIds: ReadonlySet<string>;
  selectedBaselineId: string | null;
  pinnedMembers: Array<{ fileId: string; fileVersionId: string; versionNumber: number }>;
  compareResult: DtsCompareBaselineResult | null;
  compareAgainst: "working" | "released";
  restorePreview: DtsRestorePreviewResult | null;
  actionError: string;
  releasedTip: DtsReleaseBaseline | null;
};

export type ReleaseBaselineSession = ReleaseBaselineSessionSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReleaseBaselineSessionSnapshot;
  loadBaselines(
    projectId: string,
    configSetId: string | null,
    repo: Pick<DtsStructuredRepository, "listBaselines">
  ): Promise<void>;
  refreshReadiness(
    projectId: string,
    configSetId: string | null,
    opts: { canAdmin: boolean },
    repo: Pick<DtsStructuredRepository, "getReleaseReadiness">
  ): Promise<void>;
  acknowledgeWarning(issueId: string): void;
  selectBaseline(baselineId: string | null): void;
  loadPinnedMembers(
    projectId: string,
    repo: Pick<DtsStructuredRepository, "getBaseline">
  ): Promise<void>;
  create(
    projectId: string,
    configSetId: string,
    input: { name: string; localSessionDirty: boolean },
    repo: Pick<DtsStructuredRepository, "getReleaseReadiness" | "createBaseline">
  ): Promise<DtsReleaseBaseline>;
  compare(
    projectId: string,
    against: "working" | "released",
    repo: Pick<DtsStructuredRepository, "compareBaseline">
  ): Promise<DtsCompareBaselineResult>;
  clearCompare(): void;
  clearActionError(): void;
  release(
    projectId: string,
    configSetId: string,
    input: { localSessionDirty: boolean },
    repo: Pick<DtsStructuredRepository, "getReleaseReadiness" | "releaseBaseline">
  ): Promise<DtsReleaseBaselineResult>;
  previewRestore(
    projectId: string,
    repo: Pick<DtsStructuredRepository, "previewRestoreBaseline">
  ): Promise<DtsRestorePreviewResult>;
  clearRestorePreview(): void;
  restore(
    projectId: string,
    configSetId: string,
    repo: Pick<DtsStructuredRepository, "rollbackBaseline" | "listBaselines">
  ): Promise<{ result: DtsRollbackBaselineResult; tipUnchanged: boolean }>;
};

function emptySnapshot(): ReleaseBaselineSessionSnapshot {
  return {
    baselines: [],
    baselinesLoading: false,
    baselinesError: "",
    readiness: null,
    readinessLoading: false,
    readinessError: "",
    acknowledgedWarningIds: new Set(),
    selectedBaselineId: null,
    pinnedMembers: [],
    compareResult: null,
    compareAgainst: "working",
    restorePreview: null,
    actionError: "",
    releasedTip: null
  };
}

function latestReleased(baselines: DtsReleaseBaseline[]): DtsReleaseBaseline | null {
  const released = baselines.filter((item) => item.status === "released");
  if (released.length === 0) return null;
  return [...released].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function createReleaseBaselineSession(): ReleaseBaselineSession {
  const listeners = new Set<() => void>();
  let baselines: DtsReleaseBaseline[] = [];
  let baselinesLoading = false;
  let baselinesError = "";
  let readiness: DtsReleaseReadiness | null = null;
  let readinessLoading = false;
  let readinessError = "";
  let acknowledgedWarningIds = new Set<string>();
  let selectedBaselineId: string | null = null;
  let pinnedMembers: ReleaseBaselineSessionSnapshot["pinnedMembers"] = [];
  let compareResult: DtsCompareBaselineResult | null = null;
  let compareAgainst: "working" | "released" = "working";
  let restorePreview: DtsRestorePreviewResult | null = null;
  let actionError = "";
  let readinessGeneration = 0;
  let baselinesGeneration = 0;
  let emitScheduled = false;
  let cached = emptySnapshot();

  function rebuild(): ReleaseBaselineSessionSnapshot {
    return {
      baselines,
      baselinesLoading,
      baselinesError,
      readiness,
      readinessLoading,
      readinessError,
      acknowledgedWarningIds,
      selectedBaselineId,
      pinnedMembers,
      compareResult,
      compareAgainst,
      restorePreview,
      actionError,
      releasedTip: latestReleased(baselines)
    };
  }

  function emit(): void {
    cached = rebuild();
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      cached = rebuild();
      for (const listener of listeners) listener();
    });
  }

  const session: ReleaseBaselineSession = {
    get baselines() {
      return cached.baselines;
    },
    get baselinesLoading() {
      return cached.baselinesLoading;
    },
    get baselinesError() {
      return cached.baselinesError;
    },
    get readiness() {
      return cached.readiness;
    },
    get readinessLoading() {
      return cached.readinessLoading;
    },
    get readinessError() {
      return cached.readinessError;
    },
    get acknowledgedWarningIds() {
      return cached.acknowledgedWarningIds;
    },
    get selectedBaselineId() {
      return cached.selectedBaselineId;
    },
    get pinnedMembers() {
      return cached.pinnedMembers;
    },
    get compareResult() {
      return cached.compareResult;
    },
    get compareAgainst() {
      return cached.compareAgainst;
    },
    get restorePreview() {
      return cached.restorePreview;
    },
    get actionError() {
      return cached.actionError;
    },
    get releasedTip() {
      return cached.releasedTip;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cached;
    },

    async loadBaselines(projectId, configSetId, repo) {
      const generation = ++baselinesGeneration;
      if (!configSetId) {
        baselines = [];
        baselinesError = "";
        baselinesLoading = false;
        emit();
        return;
      }
      baselinesLoading = true;
      baselinesError = "";
      emit();
      try {
        const items = await repo.listBaselines(projectId, configSetId);
        if (generation !== baselinesGeneration) return;
        baselines = items;
      } catch (err: unknown) {
        if (generation !== baselinesGeneration) return;
        baselines = [];
        baselinesError = presentError(err, "发布基线加载失败。");
      } finally {
        if (generation === baselinesGeneration) {
          baselinesLoading = false;
          emit();
        }
      }
    },

    async refreshReadiness(projectId, configSetId, opts, repo) {
      const generation = ++readinessGeneration;
      if (!configSetId || !opts.canAdmin) {
        readiness = null;
        readinessError = "";
        readinessLoading = false;
        emit();
        return;
      }
      readinessLoading = true;
      readinessError = "";
      emit();
      try {
        const item = await repo.getReleaseReadiness(projectId, configSetId, {
          acknowledgedWarningIds: [...acknowledgedWarningIds]
        });
        if (generation !== readinessGeneration) return;
        readiness = item;
      } catch (err: unknown) {
        if (generation !== readinessGeneration) return;
        readiness = null;
        readinessError = presentError(err, "发布就绪评估失败。");
      } finally {
        if (generation === readinessGeneration) {
          readinessLoading = false;
          emit();
        }
      }
    },

    acknowledgeWarning(issueId) {
      const next = new Set(acknowledgedWarningIds);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      acknowledgedWarningIds = next;
      emit();
    },

    selectBaseline(baselineId) {
      if (selectedBaselineId === baselineId) return;
      selectedBaselineId = baselineId;
      compareResult = null;
      emit();
    },

    async loadPinnedMembers(projectId, repo) {
      if (!selectedBaselineId) {
        if (pinnedMembers.length > 0) {
          pinnedMembers = [];
          emit();
        }
        return;
      }
      try {
        const detail = await repo.getBaseline(projectId, selectedBaselineId);
        pinnedMembers = detail.members.map((member) => ({
          fileId: member.fileId,
          fileVersionId: member.fileVersionId,
          versionNumber: member.versionNumber
        }));
        emit();
      } catch {
        pinnedMembers = [];
        emit();
      }
    },

    async create(projectId, configSetId, input, repo) {
      const name = input.name.trim();
      if (!name) {
        actionError = "请先填写基线名称。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const nextReadiness = await repo.getReleaseReadiness(projectId, configSetId, {
          acknowledgedWarningIds: [...acknowledgedWarningIds]
        });
        readiness = nextReadiness;
        emit();
        if (!releaseReadinessAllowsCreate(nextReadiness, input.localSessionDirty)) {
          actionError = input.localSessionDirty
            ? "还有未保存的本机会话变更，不能创建基线。"
            : presentErrorMessage(nextReadiness.unavailableReason, "发布就绪门禁阻止创建基线。");
          emit();
          throw new Error(actionError);
        }
        const created = await repo.createBaseline(projectId, configSetId, {
          name,
          gateToken: nextReadiness.gateToken,
          acknowledgedWarningIds: [...acknowledgedWarningIds]
        });
        baselines = [created, ...baselines.filter((item) => item.id !== created.id)];
        actionError = "";
        emit();
        return created;
      } catch (error) {
        if (!actionError) {
          actionError = describeBaselineActionError(error, "创建基线失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    async compare(projectId, against, repo) {
      if (!selectedBaselineId) {
        actionError = "请先选择基线。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const result = await repo.compareBaseline(projectId, selectedBaselineId, { against });
        compareResult = result;
        compareAgainst = against;
        emit();
        return result;
      } catch (error) {
        actionError = describeBaselineActionError(error, "对比基线失败，请重试。");
        emit();
        throw error;
      }
    },

    clearCompare() {
      compareResult = null;
      emit();
    },

    clearActionError() {
      if (!actionError) return;
      actionError = "";
      emit();
    },

    async release(projectId, configSetId, input, repo) {
      if (!selectedBaselineId) {
        actionError = "请先选择基线。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const nextReadiness = await repo.getReleaseReadiness(projectId, configSetId, {
          acknowledgedWarningIds: [...acknowledgedWarningIds]
        });
        readiness = nextReadiness;
        emit();
        if (!releaseReadinessAllowsRelease(nextReadiness, input.localSessionDirty)) {
          actionError = input.localSessionDirty
            ? "还有未保存的本机会话变更，不能发布基线。"
            : presentErrorMessage(nextReadiness.unavailableReason, "发布就绪门禁阻止发布基线。");
          emit();
          throw new Error(actionError);
        }
        const unacked = nextReadiness.warnings.filter(
          (item) => item.acknowledgementRequired && !acknowledgedWarningIds.has(item.id)
        );
        if (unacked.length > 0) {
          actionError = "请先在 Issues 坞确认策略允许的警告，再发布。";
          emit();
          throw new Error(actionError);
        }
        const result = await repo.releaseBaseline(projectId, selectedBaselineId, {
          gateToken: nextReadiness.gateToken,
          acknowledgedWarningIds: [...acknowledgedWarningIds]
        });
        baselines = baselines.map((item) => {
          if (item.id === result.item.id) return result.item;
          if (item.configSetId === configSetId && item.status === "released") {
            return { ...item, status: "historical" as const };
          }
          return item;
        });
        actionError = "";
        emit();
        return result;
      } catch (error) {
        if (!actionError) {
          actionError = describeBaselineActionError(error, "发布基线失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    async previewRestore(projectId, repo) {
      if (!selectedBaselineId) {
        actionError = "请先选择基线。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const preview = await repo.previewRestoreBaseline(projectId, selectedBaselineId);
        restorePreview = preview;
        emit();
        return preview;
      } catch (error) {
        actionError = describeBaselineActionError(error, "加载恢复预览失败，请重试。");
        emit();
        throw error;
      }
    },

    clearRestorePreview() {
      restorePreview = null;
      emit();
    },

    async restore(projectId, configSetId, repo) {
      if (!selectedBaselineId) {
        actionError = "请先选择基线。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const tipBefore = latestReleased(baselines)?.id;
        const result = await repo.rollbackBaseline(projectId, selectedBaselineId);
        restorePreview = null;
        const refreshed = await repo.listBaselines(projectId, configSetId);
        baselines = refreshed;
        const tipAfter = latestReleased(refreshed)?.id;
        emit();
        return { result, tipUnchanged: Boolean(tipBefore && tipAfter && tipBefore === tipAfter) };
      } catch (error) {
        actionError = describeBaselineActionError(error, "恢复基线失败，请重试。");
        emit();
        throw error;
      }
    }
  };

  cached = rebuild();
  return session;
}
