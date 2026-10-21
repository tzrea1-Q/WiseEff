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
      return "检查结果已变化，请重新查看版本检查问题后再操作。";
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

export function baselineRestoreBlockedReason(preview: DtsRestorePreviewResult | null, baselineId: string | null): string {
  if (!preview || preview.baselineId !== baselineId) return "请先加载当前版本的恢复预览。";
  if (preview.canonical) return preview.canonical.canRestore && preview.canonical.proofToken ? "" : preview.canonical.missingInformation.join(" ");
  if (preview.members.some((member) => member.canonicalOwned !== false)) {
    return "此快照涉及规范源，不能整源恢复。需要已准备并批准的规范源事务；此预览仅用于查看版本差异，不会改变工作配置。";
  }
  return "";
}

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
  pinnedMembersLoading: boolean;
  pinnedMembersError: string;
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
    repo: Pick<DtsStructuredRepository, "previewRestoreBaseline">,
    input?: { sourceConfigRevisionId: string }
  ): Promise<DtsRestorePreviewResult>;
  clearRestorePreview(): void;
  restore(
    projectId: string,
    configSetId: string,
    repo: Pick<DtsStructuredRepository, "rollbackBaseline" | "listBaselines">,
    input?: { reason: string; confirmCompositionChanges: boolean }
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
    pinnedMembersLoading: false,
    pinnedMembersError: "",
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
  let baselinesProjectId: string | null = null;
  let baselinesConfigSetId: string | null = null;
  let readiness: DtsReleaseReadiness | null = null;
  let readinessLoading = false;
  let readinessError = "";
  let acknowledgedWarningIds = new Set<string>();
  let selectedBaselineId: string | null = null;
  let pinnedMembers: ReleaseBaselineSessionSnapshot["pinnedMembers"] = [];
  let pinnedMembersLoading = false;
  let pinnedMembersError = "";
  let pinnedMembersGeneration = 0;
  let compareResult: DtsCompareBaselineResult | null = null;
  let compareAgainst: "working" | "released" = "working";
  let compareGeneration = 0;
  let restorePreview: DtsRestorePreviewResult | null = null;
  let restorePreviewGeneration = 0;
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
      pinnedMembersLoading,
      pinnedMembersError,
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
    get pinnedMembersLoading() {
      return cached.pinnedMembersLoading;
    },
    get pinnedMembersError() {
      return cached.pinnedMembersError;
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
      if (baselinesProjectId !== projectId || baselinesConfigSetId !== configSetId) {
        baselinesProjectId = projectId;
        baselinesConfigSetId = configSetId;
        baselines = [];
        session.selectBaseline(null);
        session.clearCompare();
        session.clearRestorePreview();
        actionError = "";
      }
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
        baselinesError = presentError(err, "配置版本加载失败。");
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
        readinessError = presentError(err, "版本检查失败。");
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
      pinnedMembersGeneration += 1;
      pinnedMembers = [];
      pinnedMembersLoading = false;
      pinnedMembersError = "";
      compareResult = null;
      compareGeneration += 1;
      restorePreview = null;
      restorePreviewGeneration += 1;
      emit();
    },

    async loadPinnedMembers(projectId, repo) {
      const generation = ++pinnedMembersGeneration;
      const baselineId = selectedBaselineId;
      pinnedMembers = [];
      pinnedMembersError = "";
      pinnedMembersLoading = Boolean(baselineId);
      emit();
      if (!baselineId) return;
      try {
        const detail = await repo.getBaseline(projectId, baselineId);
        if (generation !== pinnedMembersGeneration || selectedBaselineId !== baselineId) return;
        pinnedMembers = detail.members.map((member) => ({
          fileId: member.fileId,
          fileVersionId: member.fileVersionId,
          versionNumber: member.versionNumber
        }));
      } catch {
        if (generation !== pinnedMembersGeneration || selectedBaselineId !== baselineId) return;
        pinnedMembersError = "快照文件读取失败，请重试。";
      } finally {
        if (generation === pinnedMembersGeneration && selectedBaselineId === baselineId) {
          pinnedMembersLoading = false;
          emit();
        }
      }
    },

    async create(projectId, configSetId, input, repo) {
      const name = input.name.trim();
      if (!name) {
        actionError = "请先填写版本名称。";
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
            ? "还有未保存的本机会话变更，不能保存版本快照。"
            : presentErrorMessage(nextReadiness.unavailableReason, "版本检查未通过，不能保存快照。");
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
          actionError = describeBaselineActionError(error, "保存版本快照失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    async compare(projectId, against, repo) {
      if (!selectedBaselineId) {
        actionError = "请先选择版本。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      const generation = ++compareGeneration;
      const baselineId = selectedBaselineId;
      try {
        const result = await repo.compareBaseline(projectId, baselineId, { against });
        if (generation !== compareGeneration || selectedBaselineId !== baselineId) {
          throw new Error("版本选择已变化，请重新对比。");
        }
        compareResult = result;
        compareAgainst = against;
        emit();
        return result;
      } catch (error) {
        if (generation === compareGeneration && selectedBaselineId === baselineId) {
          actionError = describeBaselineActionError(error, "对比版本失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    clearCompare() {
      compareGeneration += 1;
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
        actionError = "请先选择版本。";
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
            ? "还有未保存的本机会话变更，不能设为正式版本。"
            : presentErrorMessage(nextReadiness.unavailableReason, "版本检查未通过，不能设为正式版本。");
          emit();
          throw new Error(actionError);
        }
        const unacked = nextReadiness.warnings.filter(
          (item) => item.acknowledgementRequired && !acknowledgedWarningIds.has(item.id)
        );
        if (unacked.length > 0) {
          actionError = "请先确认策略允许的警告，再设为正式版本。";
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
          actionError = describeBaselineActionError(error, "设为正式版本失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    async previewRestore(projectId, repo, input) {
      const generation = ++restorePreviewGeneration;
      if (!selectedBaselineId) {
        actionError = "请先选择版本。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      restorePreview = null;
      emit();
      const baselineId = selectedBaselineId;
      try {
        const preview = await repo.previewRestoreBaseline(projectId, baselineId, input);
        if (generation !== restorePreviewGeneration || selectedBaselineId !== baselineId || preview.baselineId !== baselineId) {
          throw new Error("版本选择已变化，请重新加载恢复预览。");
        }
        restorePreview = preview;
        emit();
        return preview;
      } catch (error) {
        if (generation === restorePreviewGeneration) {
          actionError = describeBaselineActionError(error, "加载恢复预览失败，请重试。");
          emit();
        }
        throw error;
      }
    },

    clearRestorePreview() {
      restorePreviewGeneration += 1;
      restorePreview = null;
      emit();
    },

    async restore(projectId, configSetId, repo, input) {
      if (!selectedBaselineId) {
        actionError = "请先选择版本。";
        emit();
        throw new Error(actionError);
      }
      const blockedReason = baselineRestoreBlockedReason(restorePreview, selectedBaselineId);
      if (blockedReason || restorePreview?.configSetId !== configSetId) {
        actionError = blockedReason || "配置选择已变化，请重新加载恢复预览。";
        emit();
        throw new Error(actionError);
      }
      actionError = "";
      emit();
      try {
        const tipBefore = latestReleased(baselines)?.id;
        const canonical = restorePreview?.canonical;
        const result = canonical ? await repo.rollbackBaseline(projectId, selectedBaselineId, {
          sourceConfigRevisionId: canonical.sourceConfigRevisionId,proofToken: canonical.proofToken!,
          reason: input?.reason ?? "",confirmCompositionChanges: input?.confirmCompositionChanges ?? false,
          clientMutationId: `baseline-restore-${selectedBaselineId}-${canonical.proofToken}`
        }) : await repo.rollbackBaseline(projectId, selectedBaselineId);
        restorePreview = null;
        const refreshed = await repo.listBaselines(projectId, configSetId);
        baselines = refreshed;
        const tipAfter = latestReleased(refreshed)?.id;
        emit();
        return { result, tipUnchanged: Boolean(tipBefore && tipAfter && tipBefore === tipAfter) };
      } catch (error) {
        actionError = describeBaselineActionError(error, "恢复版本失败，请重试。");
        emit();
        throw error;
      }
    }
  };

  cached = rebuild();
  return session;
}
