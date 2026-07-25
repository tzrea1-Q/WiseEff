import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParameterSpecDetail } from "@/domain/parameter-topology/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import {
  sortParameterSpecRows,
  toParameterAdminFilters
} from "@/application/parameters/parameterAdminUrl";
import {
  auditKindForResolveDecision,
  auditKindLabel
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
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useParameterAdminUrl } from "./useParameterAdminUrl";

function toSpecDetailView(detail: ParameterSpecDetail, usageCount = 0): ParameterSpecDetailView {
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
      usageCount
    }),
    schemaDefault: detail.schemaDefault,
    policyTarget: detail.policyTarget,
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
};

export function OrganizationSpecGovernancePanel({
  search,
  pathname = "/parameter-admin-next"
}: OrganizationSpecGovernancePanelProps) {
  const { application, dispatch, state } = useParameterAdmin();
  const { urlState, updateUrl } = useParameterAdminUrl(search, pathname);
  const filters = useMemo(() => toParameterAdminFilters(urlState), [urlState]);

  const [specRows, setSpecRows] = useState<ParameterSpecLibraryRow[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetailView | null>(null);
  const [reviewTasks, setReviewTasks] = useState<SpecReviewTaskView[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);
  const [reviewPendingTaskId, setReviewPendingTaskId] = useState<string | null>(null);
  const [reviewPendingAction, setReviewPendingAction] = useState<"approve" | "dismiss" | "create" | null>(
    null
  );
  const [activatePendingSpecId, setActivatePendingSpecId] = useState<string | null>(null);

  const reloadSpecs = useCallback(async () => {
    setSpecLoading(true);
    try {
      const items = await application.listSpecs({});
      setSpecRows(
        items.map((item) =>
          mapParameterSpecToLibraryRow({
            id: item.id,
            organizationId: item.organizationId ?? null,
            propertyKey: item.propertyKey,
            specificationKey: item.specificationKey,
            driverModule: item.driverModule,
            lifecycle: item.lifecycle,
            currentVersion: item.currentVersion
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
      const result = await application.listSpecReviewTasks({ status: "open" });
      const views = result.items.map(toReviewTaskView);
      setReviewTasks(views);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: views.length } });
    } catch {
      setReviewTasks([]);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { specReview: 0 } });
    } finally {
      setReviewLoading(false);
    }
  }, [application, dispatch]);

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
          const usageCount = specRows.find((row) => row.id === selectedId)?.usageCount ?? 0;
          setSpecDetail(toSpecDetailView(detail, usageCount));
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
        lifecycle: next.lifecycle,
        driverModule: next.driverModule,
        compatible: next.compatible,
        businessCategory: next.businessCategory,
        schemaSource: next.schemaSource
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
        pushAudit(auditKindForResolveDecision("resolved"), input.reason, "规格审核已批准");
        setReviewActionSuccess("规格审核已批准。");
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
        pushAudit(auditKindForResolveDecision("dismissed"), input.reason, "规格审核已驳回");
        setReviewActionSuccess("规格审核已驳回。");
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

  const handleActivateDraftSpec = useCallback(
    async (input: {
      specId: string;
      valueShape: Record<string, unknown>;
      constraints: Record<string, unknown>;
      documentation: string;
      reason: string;
    }) => {
      setReviewActionError(null);
      setReviewActionSuccess(null);
      setActivatePendingSpecId(input.specId);
      try {
        await application.activateParameterSpec(input.specId, {
          valueShape: input.valueShape,
          constraints: input.constraints,
          documentation: input.documentation,
          reason: input.reason
        });
        setReviewActionSuccess(`规格「${input.specId}」已激活，可在审核队列中批准绑定。`);
        await reloadSpecs();
      } catch (error) {
        setReviewActionError(formatReviewActionError(error));
      } finally {
        setActivatePendingSpecId(null);
      }
    },
    [application, reloadSpecs]
  );

  const latestAudit = state.auditHints[0] ?? null;

  return (
    <div className="param-admin-main">
      <div className="parameters-table-toolbar" style={{ marginBottom: "0.75rem" }}>
        <label>
          排序
          <select
            aria-label="排序"
            value={urlState.sort}
            onChange={(event) => updateUrl({ sort: event.target.value })}
          >
            <option value="propertyKey-asc">属性键 A→Z</option>
            <option value="propertyKey-desc">属性键 Z→A</option>
            <option value="driverModule-asc">驱动模块</option>
            <option value="lifecycle-asc">生命周期</option>
          </select>
        </label>
        <span className="parameters-table-count" aria-live="polite">
          待审核 {state.queueCounts.specReview}
        </span>
      </div>

      {latestAudit ? (
        <p className="form-hint" role="status" aria-label="治理审计">
          治理审计已记录：{auditKindLabel(latestAudit.kind)} — {latestAudit.summary}
          {latestAudit.reason ? `（${latestAudit.reason}）` : ""}
          <span className="sr-only"> {latestAudit.kind}</span>
        </p>
      ) : null}
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

      <ParameterSpecLibrary
        specs={sortedRows}
        selectedSpecId={urlState.specId}
        detail={specDetail}
        loading={specLoading}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onSelectSpec={handleSelectSpec}
        onActivateDraftSpec={handleActivateDraftSpec}
        activatePending={activatePendingSpecId === urlState.specId}
        reviewQueueSlot={
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
            />
          </div>
        }
      />
    </div>
  );
}
