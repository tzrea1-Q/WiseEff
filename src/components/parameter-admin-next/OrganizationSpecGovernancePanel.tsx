import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParameterSpecDetail } from "@/domain/parameter-topology/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import {
  sortParameterSpecRows,
  toParameterAdminFilters
} from "@/application/parameters/parameterAdminUrl";
import {
  auditKindForResolveDecision
} from "@/application/parameters/parameterAdminState";
import type { ParameterAdminAuditHint } from "@/application/parameters/parameterAdminState";
import {
  mapParameterSpecToLibraryRow,
  ParameterSpecLibrary,
  type ParameterSpecLibraryFilters,
  type ParameterSpecLibraryRow
} from "@/components/parameter-topology/ParameterSpecLibrary";
import type { ParameterSpecDetailView } from "@/components/parameter-topology/ParameterSpecDetail";
import { SpecReviewQueue, type SpecReviewTaskView } from "@/components/parameter-topology/SpecReviewQueue";
import {
  SpecCreateDialog,
  subjectsFromModules
} from "@/components/parameter-topology/SpecCreateDialog";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useParameterAdminUrl } from "./useParameterAdminUrl";

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
      businessCategory: libraryRow?.businessCategory
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
    usage: [],
    schemaHistory: detail.currentVersion
      ? [{ version: detail.currentVersion, source: detail.schemaNamespace ?? detail.sourceKind }]
      : []
  };
}

function formatReviewActionError(error: unknown): string {
  if (error instanceof WiseEffApiError) {
    if (error.code === "CONFLICT" && error.details.confirmRequired === true) {
      return "所选规格属性键与任务不一致，请勾选确认后再批准。";
    }
    if (error.code === "VALIDATION_FAILED") {
      return error.message || "审核请求校验失败。";
    }
    if (error.code === "CONFLICT") {
      return error.message || "审核冲突，请刷新队列后重试。";
    }
  }
  return "审核操作失败，请重试。";
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
  /** Which organization sub-view to render; defaults to both for backward-compatible tests. */
  focus?: "library" | "review";
};

export function OrganizationSpecGovernancePanel({
  search,
  pathname = "/parameter-admin",
  focus
}: OrganizationSpecGovernancePanelProps) {
  const { application, dispatch, state } = useParameterAdmin();
  const { urlState, updateUrl } = useParameterAdminUrl(search, pathname);
  const filters = useMemo(() => toParameterAdminFilters(urlState), [urlState]);

  const [specRows, setSpecRows] = useState<ParameterSpecLibraryRow[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetailView | null>(null);
  const [reviewTasks, setReviewTasks] = useState<SpecReviewTaskView[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewNextCursor, setReviewNextCursor] = useState<string | null>(null);
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);
  const [reviewPendingTaskId, setReviewPendingTaskId] = useState<string | null>(null);
  const [reviewPendingAction, setReviewPendingAction] = useState<"approve" | "dismiss" | "create" | null>(
    null
  );
  const [activatePendingSpecId, setActivatePendingSpecId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubjects, setCreateSubjects] = useState<ReturnType<typeof subjectsFromModules>>([]);

  const reloadSpecs = useCallback(async () => {
    setSpecLoading(true);
    try {
      const [items] = await Promise.all([
        application.listSpecs({}),
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
          })
        )
      );
    } catch {
      setSpecRows([]);
    } finally {
      setSpecLoading(false);
    }
  }, [application]);

  const reloadReviewTasks = useCallback(async () => {
    setReviewLoading(true);
    try {
      const result = await application.listSpecReviewTasks({ status: "open", limit: 50 });
      const views = result.items.map(toReviewTaskView);
      setReviewTasks(views);
      setReviewNextCursor(result.nextCursor);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: views.length } });
    } catch {
      setReviewTasks([]);
      setReviewNextCursor(null);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: 0 } });
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
          setSpecDetail(toSpecDetailView(detail, libraryRow?.usageCount ?? 0, libraryRow));
        }
      })
      .catch(() => {
        if (!cancelled) {
          const row = specRows.find((item) => item.id === selectedId) ?? null;
          setSpecDetail(row);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [application, specRows, urlState.specId]);

  const sortedRows = useMemo(
    () => sortParameterSpecRows(specRows, urlState.sort),
    [specRows, urlState.sort]
  );

  const handleFiltersChange = useCallback(
    (next: ParameterSpecLibraryFilters) => {
      updateUrl({
        q: next.q,
        lifecycles: next.lifecycles,
        driverModules: next.driverModules,
        compatibles: next.compatibles,
        businessCategories: next.businessCategories,
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

  const pushAudit = useCallback(
    (kind: ParameterAdminAuditHint["kind"], reason: string, summary: string) => {
      dispatch({
        type: "PUSH_AUDIT_HINT",
        hint: {
          kind,
          reason,
          summary,
          recordedAt: new Date().toISOString()
        }
      });
    },
    [dispatch]
  );

  const handleApproveReview = useCallback(
    async (input: {
      taskId: string;
      parameterSpecId: string;
      reason: string;
      confirmPropertyMismatch?: boolean;
    }) => {
      setReviewActionError(null);
      setReviewActionSuccess(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("approve");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "resolved",
          parameterSpecId: input.parameterSpecId,
          reason: input.reason,
          confirmPropertyMismatch: input.confirmPropertyMismatch
        });
        pushAudit(auditKindForResolveDecision("resolved"), input.reason, "定义匹配审核已批准");
        setReviewActionSuccess("定义匹配审核已批准。");
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, pushAudit, reloadReviewTasks, reloadSpecs]
  );

  const handleDismissReview = useCallback(
    async (input: { taskId: string; reason: string }) => {
      setReviewActionError(null);
      setReviewActionSuccess(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("dismiss");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "dismissed",
          reason: input.reason
        });
        pushAudit(auditKindForResolveDecision("dismissed"), input.reason, "定义匹配审核已驳回");
        setReviewActionSuccess("定义匹配审核已驳回。");
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, pushAudit, reloadReviewTasks, reloadSpecs]
  );

  const handleCreateSpecReview = useCallback(
    async (input: {
      taskId: string;
      propertyKey: string;
      driverModule: string | null;
      reason: string;
    }) => {
      setReviewActionError(null);
      setReviewActionSuccess(null);
      setReviewPendingTaskId(input.taskId);
      setReviewPendingAction("create");
      try {
        await application.resolveSpecReviewTask(input.taskId, {
          decision: "resolved",
          createSpec: true,
          reason: input.reason
        });
        pushAudit(
          auditKindForResolveDecision("resolved", true),
          input.reason,
          `草稿规格「${input.propertyKey}」已创建`
        );
        setReviewActionSuccess(
          `草稿规格「${input.propertyKey}」已创建；请补齐类型/约束并激活后再批准绑定。`
        );
        await Promise.all([reloadReviewTasks(), reloadSpecs()]);
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setReviewPendingTaskId(null);
        setReviewPendingAction(null);
      }
    },
    [application, pushAudit, reloadReviewTasks, reloadSpecs]
  );

  const handleSaveSpec = useCallback(
    async (payload: {
      specId: string;
      mode: "activate" | "update";
      valueShape: Record<string, unknown>;
      constraints: Record<string, unknown>;
      documentation: string;
      displayName: string;
      description: string;
      units: string | null;
      exampleValue: unknown;
      policyTarget: unknown;
      reason: string;
    }) => {
      setReviewActionError(null);
      setReviewActionSuccess(null);
      setActivatePendingSpecId(payload.specId);
      try {
        if (payload.mode === "activate") {
          await application.activateParameterSpec(payload.specId, {
            valueShape: payload.valueShape,
            constraints: payload.constraints,
            documentation: payload.documentation,
            displayName: payload.displayName,
            description: payload.description,
            reason: payload.reason
          });
          setReviewActionSuccess(`规格「${payload.displayName || payload.specId}」已激活，可在审核队列中批准绑定。`);
        } else {
          await application.updateParameterSpec(payload.specId, {
            valueShape: payload.valueShape,
            constraints: payload.constraints,
            documentation: payload.documentation,
            displayName: payload.displayName,
            description: payload.description,
            units: payload.units,
            exampleValue: payload.exampleValue,
            policyTarget: payload.policyTarget,
            reason: payload.reason
          });
          setReviewActionSuccess(`规格「${payload.displayName || payload.specId}」已保存。`);
        }
        pushAudit(
          payload.mode === "activate" ? "spec-activated" : "spec-updated",
          payload.reason,
          payload.mode === "activate"
            ? `激活定义 ${payload.specId}`
            : `更新规格 ${payload.specId}`
        );
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, pushAudit, reloadSpecs, updateUrl]
  );

  const handleDeprecateSpec = useCallback(
    async (input: { specId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.deprecateParameterSpec(input.specId, { reason: input.reason });
        setReviewActionSuccess("已废弃");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs, updateUrl]
  );

  const handleRestoreSpec = useCallback(
    async (input: { specId: string; reason: string }) => {
      setReviewActionError(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.restoreParameterSpec(input.specId, { reason: input.reason });
        setReviewActionSuccess("已恢复");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs, updateUrl]
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
        setReviewActionSuccess("已准备版本切换，可确认完成切换。");
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
        setReviewActionSuccess("版本切换已完成。");
        await reloadSpecs();
        updateUrl({ specId: null });
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs, updateUrl]
  );

  const showLibrary = focus !== "review";
  const showReview = focus !== "library";

  const reviewQueue = (
    <div>
      {reviewLoading && reviewTasks.length === 0 ? (
        <p className="form-hint">正在加载审核队列…</p>
      ) : null}
      <SpecReviewQueue
        tasks={reviewTasks}
        librarySpecs={specRows.map((row) => ({
          id: row.id,
          label: `${row.driverModule ?? "—"} / ${row.propertyKey}`,
          propertyKey: row.propertyKey,
          driverModule: row.driverModule
        }))}
        onApprove={handleApproveReview}
        onDismiss={handleDismissReview}
        onCreateSpec={handleCreateSpecReview}
        pendingTaskId={reviewPendingTaskId}
        pendingAction={reviewPendingAction}
        nextCursor={reviewNextCursor}
        onLoadMore={() => void loadMoreReviewTasks()}
        loadingMore={reviewLoadingMore}
      />
    </div>
  );

  return (
    <div className="param-admin-main">
      <div className="parameters-table-toolbar" style={{ marginBottom: "0.75rem" }}>
        <span className="parameters-table-count" aria-live="polite">
          待审核 {state.queueCounts.specReview}
        </span>
      </div>

      {reviewActionSuccess ? (
        <p className="form-hint" role="status">
          {reviewActionSuccess}
        </p>
      ) : null}
      {reviewActionError ? (
        <p className="form-error" role="alert">
          {reviewActionError}
        </p>
      ) : null}

      {showLibrary ? (
        <ParameterSpecLibrary
          specs={sortedRows}
          selectedSpecId={urlState.specId}
          detail={specDetail}
          loading={specLoading}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onSelectSpec={handleSelectSpec}
          onCloseSpec={handleCloseSpec}
          onSaveSpec={handleSaveSpec}
          onDeprecateSpec={handleDeprecateSpec}
          onRestoreSpec={handleRestoreSpec}
          onPrepareCutover={handlePrepareCutover}
          onFinalizeCutover={handleFinalizeCutover}
          savePending={activatePendingSpecId === urlState.specId}
          saveError={reviewActionError}
          onCreateSpec={() => {
            setCreateError(null);
            setCreateOpen(true);
            void application.getModuleRegistry().then((registry) => {
              setCreateSubjects(subjectsFromModules(registry.modules));
            });
          }}
          reviewQueueSlot={showReview ? reviewQueue : undefined}
        />
      ) : (
        reviewQueue
      )}

      {createOpen ? (
        <SpecCreateDialog
          subjects={createSubjects}
          busy={createBusy}
          error={createError}
          onCancel={() => {
            if (createBusy) return;
            setCreateOpen(false);
            setCreateError(null);
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
              setReviewActionSuccess(coverageCompatible ? "已创建并激活" : "已保存草稿");
              await reloadSpecs();
              updateUrl({ specId: created.id });
            } catch (error) {
              setCreateError(
                error instanceof WiseEffApiError
                  ? error.message || "创建失败"
                  : "创建失败，请重试。",
              );
            } finally {
              setCreateBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
