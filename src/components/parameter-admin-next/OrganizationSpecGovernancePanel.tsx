import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParameterSpecDetail } from "@/domain/parameter-topology/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import {
  sortParameterSpecRows,
  toParameterAdminFilters
} from "@/application/parameters/parameterAdminUrl";
import {
  buildParameterSpecModuleTree,
  filterParameterSpecsByModuleNode
} from "@/application/parameters/buildParameterSpecModuleTree";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import {
  mapParameterSpecToLibraryRow,
  ParameterSpecLibrary,
  type ParameterSpecLibraryFilters,
  type ParameterSpecLibraryRow,
  formatSpecPrimaryLabel,
  isSpecSelectableForReview,
} from "@/components/parameter-topology/ParameterSpecLibrary";
import type { ParameterSpecDetailView } from "@/components/parameter-topology/ParameterSpecDetail";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
import { SpecReviewQueue, type SpecReviewTaskView } from "@/components/parameter-topology/SpecReviewQueue";
import {
  SpecCreateDialog
} from "@/components/parameter-topology/SpecCreateDialog";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useParameterAdminUrl } from "./useParameterAdminUrl";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import { useToast } from "@/components/common/toast/ToastProvider";

function toSpecDetailView(
  detail: ParameterSpecDetail,
  usageCount = 0,
  libraryRow?: ParameterSpecLibraryRow | null
): ParameterSpecDetailView {
  return {
    ...mapParameterSpecToLibraryRow({
      id: detail.id,
      organizationId: detail.organizationId ?? null,
      propertyKey: detail.propertyKey,
      specificationKey: detail.specificationKey,
      driverModule: detail.driverModule,
      lifecycle: detail.lifecycle,
      currentVersion: detail.currentVersion,
      compatiblePatterns: detail.compatiblePatterns,
      valueShape: detail.valueShape,
      exampleValue: detail.exampleValue,
      schemaNamespace: detail.schemaNamespace,
      usageCount,
      attributionModules: libraryRow?.attributionModules ?? detail.attributionModules ?? [],
      attributionSubjectId: detail.attributionSubjectId ?? libraryRow?.attributionSubjectId ?? null,
      declaredPlacement: detail.declaredPlacement ?? libraryRow?.declaredPlacement ?? null,
    }),
    displayName: detail.displayName,
    description: detail.description,
    documentation: detail.documentation,
    units: detail.units,
    constraints: detail.constraints,
    schemaNamespace: detail.schemaNamespace,
    sourceKind: detail.sourceKind,
    specificationKey: detail.specificationKey,
    compatiblePatterns: detail.compatiblePatterns,
    schemaDefault: detail.schemaDefault,
    policyTarget: detail.policyTarget,
    cutover: detail.cutover,
  };
}

function formatReviewActionError(error: unknown): string {
  if (error instanceof WiseEffApiError) {
    if (
      error.code === "CONFLICT" &&
      (error.details.code === "semantic-edit-requires-successor" ||
        error.details.reason === "semantic-edit-requires-successor")
    ) {
      return presentError(error, "语义字段需通过激活后继版本修改，不能直接保存。");
    }
    if (error.code === "CONFLICT" && error.details.confirmRequired === true) {
      return "所选规格属性键与任务不一致，请勾选确认后再批准。";
    }
    if (
      error.code === "CONFLICT" &&
      typeof error.details.parameterSpecId === "string" &&
      "lifecycle" in error.details
    ) {
      return presentError(error, "目标身份已被占用，无法覆盖。");
    }
    if (error.code === "VALIDATION_FAILED") {
      return presentErrorMessage(error.message, "审核请求校验失败。");
    }
    if (error.code === "CONFLICT") {
      return presentErrorMessage(error.message, "审核冲突，请刷新队列后重试。");
    }
  }
  return presentError(error, "审核操作失败，请重试。");
}

function toReviewTaskView(task: {
  id: string;
  propertyKey: string | null;
  driverModule: string | null;
  evidence: string[];
  candidates: Array<{
    id: string;
    label: string;
    propertyKey?: string | null;
    driverModule?: string | null;
  }>;
  ambiguous: boolean;
  projectCount: number;
}): SpecReviewTaskView {
  return {
    id: task.id,
    propertyKey: task.propertyKey ?? "",
    driverModule: task.driverModule,
    evidence: task.evidence,
    candidates: task.candidates,
    ambiguous: task.ambiguous,
    projectCount: task.projectCount
  };
}

export type OrganizationSpecGovernancePanelProps = {
  search: string;
  pathname?: string;
  /** Platform super admin may deprecate/restore platform-global definitions. */
  isPlatformSuperAdmin?: boolean;
  /** Optional deep-link into nested identity mapping when open tasks exist (ADR-0015). */
  onOpenIdentityMapping?: () => void;
  identityMappingOpenCount?: number;
  identityMappingCountError?: string | null;
  onNavigate?: (path: string) => void;
};

export function OrganizationSpecGovernancePanel({
  search,
  pathname = "/parameter-admin",
  isPlatformSuperAdmin = false,
  onOpenIdentityMapping,
  identityMappingOpenCount,
  identityMappingCountError = null,
  onNavigate,
}: OrganizationSpecGovernancePanelProps) {
  const { application, dispatch, state, relatedKnowledge } = useParameterAdmin();
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits();
  const { urlState, updateUrl } = useParameterAdminUrl(search, pathname);
  const filters = useMemo(() => toParameterAdminFilters(urlState), [urlState]);

  const [specRows, setSpecRows] = useState<ParameterSpecLibraryRow[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [specLoadError, setSpecLoadError] = useState<string | null>(null);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetailView | null>(null);
  const [reviewTasks, setReviewTasks] = useState<SpecReviewTaskView[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewLoadError, setReviewLoadError] = useState<string | null>(null);
  const [reviewCountKnown, setReviewCountKnown] = useState(false);
  const [reviewNextCursor, setReviewNextCursor] = useState<string | null>(null);
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewPendingTaskId, setReviewPendingTaskId] = useState<string | null>(null);
  const [reviewPendingAction, setReviewPendingAction] = useState<"approve" | "dismiss" | "create" | null>(
    null
  );
  const [activatePendingSpecId, setActivatePendingSpecId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createModules, setCreateModules] = useState<ParameterModule[]>([]);
  const [createSubjectsLoading, setCreateSubjectsLoading] = useState(false);
  const { toast } = useToast();
  const showToast = useCallback((message: string) => toast({ tone: "success", message }), [toast]);

  const reloadSpecs = useCallback(async () => {
    setSpecLoading(true);
    setSpecLoadError(null);
    try {
      const [items] = await Promise.all([
        application.listSpecs({ view: "governance" }),
      ]);
      setSpecRows(
        items.map((item) =>
          mapParameterSpecToLibraryRow({
            id: item.id,
            organizationId: item.organizationId ?? null,
            propertyKey: item.propertyKey,
            specificationKey: item.specificationKey,
            driverModule: item.driverModule,
            lifecycle: item.lifecycle,
            currentVersion: item.currentVersion,
            compatiblePatterns: item.compatiblePatterns,
            valueShape: item.valueShape,
            attributionModules: item.attributionModules,
            attributionSubjectId: item.attributionSubjectId ?? null,
            declaredPlacement: item.declaredPlacement ?? null,
            usageCount: item.referenceCount ?? 0
          })
        )
      );
    } catch (error) {
      // A failed library load is an error state — keep the last known rows
      // instead of masquerading as an empty library.
      setSpecLoadError(presentError(error, "参数定义库加载失败，请重试。"));
    } finally {
      setSpecLoading(false);
    }
  }, [application]);

  const reloadReviewTasks = useCallback(async () => {
    setReviewLoading(true);
    setReviewLoadError(null);
    try {
      const result = await application.listSpecReviewTasks({ status: "open", limit: 50 });
      const views = result.items.map(toReviewTaskView);
      setReviewTasks(views);
      setReviewNextCursor(result.nextCursor);
      setReviewCountKnown(true);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: views.length } });
    } catch (error) {
      // IA-R2: do not treat a failed count load as an empty queue — keep the
      // last known tasks/count and surface an explicit error with retry.
      setReviewLoadError(presentError(error, "审核队列加载失败，请重试。"));
    } finally {
      setReviewLoading(false);
    }
  }, [application, dispatch]);

  const loadMoreReviewTasks = useCallback(async () => {
    if (!reviewNextCursor || reviewLoadingMore) {
      return;
    }
    setReviewLoadingMore(true);
    try {
      const result = await application.listSpecReviewTasks({
        status: "open",
        limit: 50,
        cursor: reviewNextCursor
      });
      const views = result.items.map(toReviewTaskView);
      setReviewTasks((current) => {
        const merged = [...current, ...views];
        dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: merged.length } });
        return merged;
      });
      setReviewNextCursor(result.nextCursor);
    } catch {
      // Keep existing page; surface via empty nextCursor only on full reload.
    } finally {
      setReviewLoadingMore(false);
    }
  }, [application, dispatch, reviewLoadingMore, reviewNextCursor]);

  useEffect(() => {
    void reloadSpecs();
    void reloadReviewTasks();
  }, [reloadReviewTasks, reloadSpecs]);

  useEffect(() => {
    const selectedId = urlState.specId;
    if (!selectedId) {
      setSpecDetail(null);
      return undefined;
    }

    let cancelled = false;
    application
      .getSpec(selectedId)
      .then((detail) => {
        if (!cancelled) {
          const libraryRow = specRows.find((row) => row.id === selectedId) ?? null;
          setSpecDetail(toSpecDetailView(detail, detail.referenceCount ?? libraryRow?.usageCount ?? 0, libraryRow));
        }
      })
      .catch(() => {
        if (!cancelled) {
          const row = specRows.find((item) => item.id === selectedId) ?? null;
          setSpecDetail(row);
        }
      });

    if (createModules.length === 0) {
      void application
        .getModuleRegistry()
        .then((registry) => {
          if (!cancelled) setCreateModules(registry.modules);
        })
        .catch(() => {
          /* picker stays empty; create dialog still can retry */
        });
    }

    return () => {
      cancelled = true;
    };
  }, [application, createModules.length, specRows, urlState.specId]);

  const sortedRows = useMemo(
    () => sortParameterSpecRows(specRows, urlState.sort),
    [specRows, urlState.sort]
  );
  const moduleTree = useMemo(
    () => buildParameterSpecModuleTree(sortedRows),
    [sortedRows]
  );
  const moduleScopedRows = useMemo(
    () => filterParameterSpecsByModuleNode(sortedRows, moduleTree, urlState.moduleNodeId),
    [moduleTree, sortedRows, urlState.moduleNodeId]
  );

  const handleFiltersChange = useCallback(
    (next: ParameterSpecLibraryFilters) => {
      updateUrl({
        q: next.q,
        lifecycles: next.lifecycles,
        driverModules: next.driverModules,
        compatibles: next.compatibles,
        schemaSources: next.schemaSources,
        moduleNames: next.moduleNames
      });
    },
    [updateUrl]
  );

  const handleSelectSpec = useCallback(
    (specId: string) => {
      updateUrl({ specId });
    },
    [updateUrl]
  );

  const handleCloseSpec = useCallback(() => {
    updateUrl({ specId: null });
  }, [updateUrl]);


  const handleApproveReview = useCallback(
    async (input: {
      taskId: string;
      parameterSpecId: string;
      reason: string;
      confirmPropertyMismatch?: boolean;
    }) => {
      setReviewActionError(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("approve");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "resolved",
          parameterSpecId: input.parameterSpecId,
          reason: input.reason,
          confirmPropertyMismatch: input.confirmPropertyMismatch
        });
        await refreshRecentAudits();
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, refreshRecentAudits, reloadReviewTasks, reloadSpecs]
  );

  const handleDismissReview = useCallback(
    async (input: { taskId: string; reason: string }) => {
      setReviewActionError(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("dismiss");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "dismissed",
          reason: input.reason
        });
        await refreshRecentAudits();
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, refreshRecentAudits, reloadReviewTasks, reloadSpecs]
  );

  const handleCreateSpecReview = useCallback(
    async (input: {
      taskId: string;
      propertyKey: string;
      driverModule: string | null;
      reason: string;
    }) => {
      setReviewActionError(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("create");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "resolved",
          createSpec: true,
          reason: input.reason
        });
        await refreshRecentAudits();
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, refreshRecentAudits, reloadReviewTasks, reloadSpecs]
  );

  const handleSaveSpec = useCallback(
    async (payload: {
      specId: string;
      mode: "activate" | "update";
      valueShape: Record<string, unknown>;
      constraints: Record<string, unknown>;
      documentation: string;
      displayName: string | null;
      description: string;
      units: string | null;
      exampleValue: unknown;
      reason: string;
    }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(payload.specId);
      try {
        if (payload.mode === "activate") {
          await application.activateParameterSpec(payload.specId, {
            valueShape: payload.valueShape,
            constraints: payload.constraints,
            documentation: payload.documentation,
            displayName: payload.displayName,
            description: payload.description,
            units: payload.units,
            exampleValue: payload.exampleValue,
            reason: payload.reason
          });
          showToast("已激活");
        } else {
          await application.updateParameterSpec(payload.specId, {
            valueShape: payload.valueShape,
            constraints: payload.constraints,
            documentation: payload.documentation,
            displayName: payload.displayName,
            description: payload.description,
            units: payload.units,
            exampleValue: payload.exampleValue,
            reason: payload.reason
          });
        }
        await refreshRecentAudits();
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        // Rethrow so the dialog keeps its audit-reason confirm layer open.
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, refreshRecentAudits, reloadSpecs, showToast, updateUrl]
  );

  const handleDeprecateSpec = useCallback(
    async (input: { specId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.deprecateParameterSpec(input.specId, { reason: input.reason });
        await refreshRecentAudits();
        showToast("已废弃（仍参与解析，默认库视图已隐藏）");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, refreshRecentAudits, reloadSpecs, showToast, updateUrl]
  );

  const handleRestoreSpec = useCallback(
    async (input: { specId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.restoreParameterSpec(input.specId, { reason: input.reason });
        await refreshRecentAudits();
        showToast("已恢复");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, refreshRecentAudits, reloadSpecs, showToast, updateUrl]
  );

  const handleReattributeSpec = useCallback(
    async (input: { specId: string; attributionSubjectId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        const detail = await application.reattributeParameterSpec(input.specId, {
          attributionSubjectId: input.attributionSubjectId,
          reason: input.reason,
        });
        await refreshRecentAudits();
        showToast("已修正归属主体");
        const libraryRow = specRows.find((row) => row.id === input.specId) ?? null;
        setSpecDetail(toSpecDetailView(detail, libraryRow?.usageCount ?? 0, libraryRow));
        await reloadSpecs();
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, refreshRecentAudits, reloadSpecs, showToast, specRows]
  );

  const handleRenamePropertyKey = useCallback(
    async (input: { specId: string; propertyKey: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        const detail = await application.renameParameterSpecPropertyKey(input.specId, {
          propertyKey: input.propertyKey,
          reason: input.reason,
        });
        await refreshRecentAudits();
        showToast("已修正属性键");
        const libraryRow = specRows.find((row) => row.id === input.specId) ?? null;
        setSpecDetail(toSpecDetailView(detail, libraryRow?.usageCount ?? 0, libraryRow));
        await reloadSpecs();
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, refreshRecentAudits, reloadSpecs, showToast, specRows]
  );

  const handlePrepareCutover = useCallback(
    async (specId: string) => {
      setReviewActionError(null);
      setActivatePendingSpecId(specId);
      try {
        const detail = await application.prepareSpecVersionCutover(specId, {
          reason: "prepare version cutover",
        });
        const libraryRow = specRows.find((row) => row.id === specId) ?? null;
        setSpecDetail(toSpecDetailView(detail, libraryRow?.usageCount ?? 0, libraryRow));
        await reloadSpecs();
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs, specRows]
  );

  const handleFinalizeCutover = useCallback(
    async (input: { specId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.finalizeSpecVersionCutover(input.specId, { reason: input.reason });
        showToast("版本切换已完成");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
        throw error;
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs, showToast, updateUrl]
  );

  const reviewLibrarySpecs = useMemo(
    () =>
      specRows
        .filter((row) => isSpecSelectableForReview(row))
        .map((row) => ({
          id: row.id,
          label: formatSpecPrimaryLabel(row),
          propertyKey: row.propertyKey,
          driverModule: row.driverModule,
        })),
    [specRows],
  );

  const reviewCount = state.queueCounts.specReview;
  const reviewQueue = (
    <details className="param-admin-review-queue" open={(reviewCount > 0 && reviewCount <= 5) || Boolean(reviewLoadError)}>
      <summary className="param-admin-review-queue__summary">
        {PARAMETER_ADMIN_UI.specReviewQueueToggle}
        <span className="param-admin-review-queue__count" aria-live="polite">
          {reviewLoadError && !reviewCountKnown ? "待审核 计数不可用" : `待审核 ${reviewCount}`}
        </span>
      </summary>
      <div className="param-admin-review-queue__body">
        {reviewLoading && reviewTasks.length === 0 ? (
          <p className="form-hint">正在加载审核队列…</p>
        ) : null}
        {reviewLoadError ? (
          <p className="form-error" role="alert">
            {reviewLoadError}
            <button
              type="button"
              className="button subtle"
              disabled={reviewLoading}
              onClick={() => void reloadReviewTasks()}
            >
              重试
            </button>
          </p>
        ) : null}
        <SpecReviewQueue
          tasks={reviewTasks}
          librarySpecs={reviewLibrarySpecs}
          onApprove={handleApproveReview}
          onDismiss={handleDismissReview}
          onCreateSpec={handleCreateSpecReview}
          pendingTaskId={reviewPendingTaskId}
          pendingAction={reviewPendingAction}
          actionError={reviewActionError}
          nextCursor={reviewNextCursor}
          onLoadMore={() => void loadMoreReviewTasks()}
          loadingMore={reviewLoadingMore}
        />
      </div>
    </details>
  );

  return (
    <div className="param-admin-main">
      {reviewActionError ? (
        <p className="form-error" role="alert">
          {reviewActionError}
        </p>
      ) : null}

      {identityMappingCountError ? (
        <p className="form-error" role="alert">
          {identityMappingCountError}
        </p>
      ) : null}

      {onOpenIdentityMapping && (identityMappingOpenCount ?? 0) > 0 ? (
        <div className="param-admin-queue-banner" role="status">
          <p>
            <strong>{PARAMETER_ADMIN_UI.identityMapping}</strong>
            <span>待处理 {identityMappingOpenCount} 项。可在上方子导航或此处进入。</span>
          </p>
          <button type="button" className="button" onClick={onOpenIdentityMapping}>
            {PARAMETER_ADMIN_UI.identityMapping}
          </button>
        </div>
      ) : null}

      <div
        className="dts-parameter-workbench parameter-admin-specs-workbench"
        role="region"
        aria-label="参数定义模块工作台"
      >
        <div className="dts-parameter-workbench__body">
          <div
            className="dts-parameter-workbench__navigator dts-workbench-topology"
            role="region"
            aria-label="模块导航"
          >
            <div className="dts-parameter-workbench__navigator-header">
              <h3 className="dts-parameter-workbench__navigator-title">模块导航</h3>
            </div>
            <DtsTopologyNavigator
              view="effective"
              nodes={moduleTree}
              selectedNodeId={urlState.moduleNodeId}
              defaultExpandDepth={2}
              labelKind="text"
              countUnit="定义"
              emptyMessage={specLoading ? "正在加载模块…" : "暂无模块归属"}
              ariaLabel="参数定义模块树"
              onSelectNode={(nodeId) => {
                updateUrl({
                  moduleNodeId: urlState.moduleNodeId === nodeId ? null : nodeId,
                  specId: null
                });
              }}
            />
          </div>
          <div className="parameter-admin-specs-workbench__results">
            <ParameterSpecLibrary
              specs={moduleScopedRows}
              selectedSpecId={urlState.specId}
              detail={specDetail}
              loading={specLoading}
              loadError={specLoadError}
              onRetryLoad={() => void reloadSpecs()}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onSelectSpec={handleSelectSpec}
              onCloseSpec={handleCloseSpec}
              onSaveSpec={handleSaveSpec}
              onDeprecateSpec={handleDeprecateSpec}
              onRestoreSpec={handleRestoreSpec}
              onReattributeSpec={handleReattributeSpec}
              onRenamePropertyKey={handleRenamePropertyKey}
              identityModules={createModules}
              onPrepareCutover={handlePrepareCutover}
              onFinalizeCutover={handleFinalizeCutover}
              propertyKeyCutover={
                urlState.specId &&
                application.previewPropertyKeyCutover &&
                application.startPropertyKeyCutover &&
                application.preparePropertyKeyCutover &&
                application.finalizePropertyKeyCutover
                  ? {
                      preview: (input) =>
                        application.previewPropertyKeyCutover!(urlState.specId!, input),
                      start: (input) =>
                        application.startPropertyKeyCutover!(urlState.specId!, input),
                      prepare: (input) =>
                        application.preparePropertyKeyCutover!(urlState.specId!, input),
                      finalize: async (input) => {
                        const result = await application.finalizePropertyKeyCutover!(
                          urlState.specId!,
                          input
                        );
                        showToast("属性键切换已完成");
                        await reloadSpecs();
                        return result;
                      },
                      loadOpenRun: application.getPropertyKeyCutover
                        ? async () => application.getPropertyKeyCutover!(urlState.specId!)
                        : undefined
                    }
                  : undefined
              }
              onNavigate={onNavigate}
              canDeprecateGlobal={isPlatformSuperAdmin}
              relatedKnowledge={relatedKnowledge}
              savePending={activatePendingSpecId === urlState.specId}
              saveError={reviewActionError}
              onCreateSpec={() => {
                setCreateError(null);
                setCreateModules([]);
                setCreateSubjectsLoading(true);
                setCreateOpen(true);
                void application
                  .getModuleRegistry()
                  .then((registry) => {
                    setCreateModules(registry.modules);
                  })
                  .catch(() => {
                    setCreateModules([]);
                    setCreateError("无法加载归属主体列表，请重试。");
                  })
                  .finally(() => {
                    setCreateSubjectsLoading(false);
                  });
              }}
              reviewQueueSlot={reviewQueue}
            />
          </div>
        </div>
      </div>

      {createOpen ? (
        <SpecCreateDialog
          modules={createModules}
          subjectsLoading={createSubjectsLoading}
          busy={createBusy}
          error={createError}
          onCancel={() => {
            if (createBusy) return;
            setCreateOpen(false);
            setCreateError(null);
            setCreateSubjectsLoading(false);
          }}
          onConfirm={async (input) => {
            setCreateBusy(true);
            setCreateError(null);
            try {
              const { coverageCompatible, ...createInput } = input;
              const created = await application.createParameterSpec(createInput);
              if (coverageCompatible) {
                await application.activateParameterSpec(created.id, {
                  valueShape: (created.valueShape as Record<string, unknown>) ?? {
                    kind: "cells",
                    bits: 32,
                    groups: 1,
                    cellsPerGroup: 1,
                  },
                  constraints: created.constraints ?? { cells: 1 },
                  documentation: created.documentation || createInput.documentation || "docs",
                  reason: "activate after library create",
                  coverageClaim: {
                    kind: "overlay-property",
                    upsertOverlay: {
                      compatible: coverageCompatible,
                      displayName: `${coverageCompatible} coverage overlay`,
                      createPropertyLink: true,
                    },
                  },
                });
              }
              setCreateOpen(false);
              showToast(coverageCompatible ? "已创建并激活" : "已保存草稿");
              await reloadSpecs();
              updateUrl({ specId: created.id });
            } catch (error) {
              setCreateError(presentError(error, "创建失败，请重试。"));
            } finally {
              setCreateBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
