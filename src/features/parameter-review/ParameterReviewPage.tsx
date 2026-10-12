import { canPerform } from "@/app/permissions";
import { type PageProps } from "@/app/routes";
import { toLegacyInitializationReview } from "@/application/parameters/initializationUiMappers";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { isValidMergeLink } from "@/domain/parameters/mergeLink";
import { presentError } from "@/infrastructure/http/presentError";
import { canActOnReviewRequest, isReviewHistoryForRole, splitChangeRequestsForReviewQueue } from "@/domain/parameters/reviewQueue";
import { type ProjectParameterInitializationDraft, type ProjectParameterInitializationReview } from "@/domain/parameters/types";
import { type ChangeRequest, type ParameterSubmissionRound } from "@/domain/prototype/types";
import { migrateLegacyRoleId } from "@/domain/users/types";
import {
  VerticalTimeline,
  findRetainedSubmissionRound,
  formatWorkflowDisplayText,
  getParameterInitializationReviewStatusLabel,
  getUserName,
  type VerticalTimelineItem
} from "@/features/parameter-review/reviewUi";
import {
  ReviewChangeValueSummary,
  ReviewDetailSummary,
  SubmissionHistoryDiffCard,
  isComplexSubmissionHistoryItem,
  shouldShowSubmissionRoundSummary
} from "@/features/parameter-review/submissionHistoryDiff";
import { shouldSummarizeReviewChange } from "@/parameterValueKind";
import { EmptyState, SectionLabel, WorkbenchLayout, getContextQuery } from "@/workbenchUi";
import { CheckCircle2, CircleOff, FileText, History, Link2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import "./parameter-review.css";
import { ReviewInbox, type ReviewInboxRow } from "./ReviewInbox";
import { ReviewProvenance } from "./ReviewProvenance";
import { StatusBadge } from "./reviewUi";
import { ReviewImpactList } from "@/components/parameters/ReviewImpactList";

type ParameterReviewMode = "pending" | "history";
type ParameterInitializationReviewRow = {
  kind: "initialization";
  review: ProjectParameterInitializationReview;
  draft: ProjectParameterInitializationDraft;
};
type ParameterReviewRow =
  | ParameterInitializationReviewRow
  | { kind: "change"; request: ChangeRequest };

function resolveRetainedUserName(
  users: ReadonlyArray<{ id: string; name: string }>,
  userId: string | null
) {
  if (userId === null) return "已注销用户";
  return users.find((user) => user.id === userId)?.name ?? userId;
}

export function ParameterReviewPage({
  state,
  dispatch,
  search,
  parameterActions,
  runtime,
  runtimeMode
}: PageProps) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [reviewProjection, setReviewProjection] = useState<{
    projectId: string;
    userId: string;
    requests: ChangeRequest[];
    rounds: ParameterSubmissionRound[];
    error: string | null;
  } | null>(null);
  const reviewProjectId = getContextQuery(search).projectId || state.activeProjectId;
  const parameterRepository = runtime?.parameterRepository;
  useEffect(() => {
    if (runtimeMode !== "api" || !parameterRepository || !reviewProjectId) return;
    let cancelled = false;
    setReviewProjection(null);
    void Promise.all([
      parameterRepository.listChangeRequests({ projectId: reviewProjectId }),
      parameterRepository.listSubmissionRounds({ projectId: reviewProjectId })
    ]).then(([requests, rounds]) => {
      if (!cancelled) setReviewProjection({ projectId: reviewProjectId, userId: state.currentUserId, requests, rounds, error: null });
    }).catch((error) => {
      if (!cancelled) {
        setReviewProjection({ projectId: reviewProjectId, userId: state.currentUserId, requests: [], rounds: [],
          error: presentError(error, "审阅记录加载失败，请稍后重试。") });
        dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "审阅记录加载失败，请稍后重试。") });
      }
    });
    return () => { cancelled = true; };
  }, [dispatch, reviewProjectId, parameterRepository, runtimeMode, refreshVersion, state.currentUserId]);
  const currentReviewProjection = reviewProjection?.projectId === reviewProjectId && reviewProjection.userId === state.currentUserId
    ? reviewProjection : null;
  if (runtimeMode === "api" && parameterRepository) {
    state = {
      ...state,
      changeRequests: currentReviewProjection?.requests ?? [],
      parameterSubmissionRounds: currentReviewProjection?.rounds ?? []
    };
  }
  const parameterInitializationRepository = runtime?.parameterInitializationRepository;
  const searchParams = new URLSearchParams(search);
  const requestedUrlRequestId = searchParams.get("request") ?? "";
  const requestedLegacyQueryId = searchParams.get("legacyRequest") ?? "";
  const reviewerRoleId = migrateLegacyRoleId(state.activeRoleId);
  const requestedLegacyStateId = requestedLegacyQueryId || (
    requestedUrlRequestId && (
      state.changeRequests.some((item) => item.id === requestedUrlRequestId)
      || state.parameterInitializationReviews.some((item) => item.id === requestedUrlRequestId)
    )
      ? requestedUrlRequestId
      : ""
  );
  const requestedLegacyRequest = state.changeRequests.find((request) => request.id === requestedLegacyStateId);
  const requestedLegacyInitialization = state.parameterInitializationReviews.find(
    (review) => review.id === requestedLegacyStateId
  );
  const requestedLegacyIsHistory = Boolean(
    (requestedLegacyRequest && (
      requestedLegacyRequest.status === "已合入"
      || requestedLegacyRequest.status === "已打回"
      || isReviewHistoryForRole(reviewerRoleId, requestedLegacyRequest)
    ))
    || Boolean(requestedLegacyInitialization && requestedLegacyInitialization.status !== "pending")
  );
  const [selectedId, setSelectedId] = useState(() => {
    // Legacy queue records use an explicit namespace in API mode. A retained
    // terminal request in the old state queue must never be offered to the
    // canonical panel as its initial request.
    const requested = requestedLegacyStateId || requestedUrlRequestId;
    if (requested && (state.changeRequests.some((item) => item.id === requested) || state.parameterInitializationReviews.some((item) => item.id === requested))) {
      return requested;
    }
    return state.parameterInitializationReviews[0]?.id ?? state.changeRequests[0]?.id ?? "";
  });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mergeLink, setMergeLink] = useState("");
  const [batchSelectedIds, setBatchSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [visibleLegacyIds, setVisibleLegacyIds] = useState<string[] | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [reviewMode, setReviewMode] = useState<ParameterReviewMode>(requestedLegacyIsHistory ? "history" : "pending");
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const reviewProjectionPending = runtimeMode === "api" && parameterRepository && !currentReviewProjection;
  const canonicalProjectId = contextQuery.projectId || state.activeProjectId;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const canReviewCanonical = Boolean(currentUser?.isActive && currentUser.roles?.some((role) =>
    (role.roleId === "software-committer" && role.projectId === canonicalProjectId)
      || (role.roleId === "admin" && role.projectId === null)
  ));
  const canReviewInitialization = canPerform(reviewerRoleId, "parameter.review");
  const { pending: pendingRequests, history: historyRequests } = useMemo(() => {
    // API mode's canonical panel owns project-value requests. Keeping the
    // legacy semantic queue here would duplicate pending work and expose its
    // old actions beside the canonical workflow. Initialization reviews have
    // a separate contract and remain visible below.
    if (runtimeMode === "api") {
      const nodes = state.changeRequests.filter((request) => request.editSubjectKind === "node-enablement"
        && (request.assignedTo === state.currentUserId || reviewerRoleId === "admin"));
      return {
        pending: splitChangeRequestsForReviewQueue(reviewerRoleId, nodes).pending,
        history: splitChangeRequestsForReviewQueue(reviewerRoleId, state.changeRequests).history
      };
    }
    return splitChangeRequestsForReviewQueue(reviewerRoleId, state.changeRequests);
  }, [reviewerRoleId, runtimeMode, state.changeRequests, state.currentUserId]);
  const pendingInitializationRows = useMemo(
    () =>
      canReviewInitialization
        ? state.parameterInitializationReviews
            .filter((review) => review.status === "pending")
            .flatMap((review): ParameterInitializationReviewRow[] => {
              const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
              return draft ? [{ kind: "initialization", review, draft }] : [];
            })
        : [],
    [canReviewInitialization, state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const historyInitializationRows = useMemo(
    () =>
      canReviewInitialization
        ? state.parameterInitializationReviews
            .filter((review) => review.status !== "pending")
            .flatMap((review): ParameterInitializationReviewRow[] => {
              const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
              return draft ? [{ kind: "initialization", review, draft }] : [];
            })
        : [],
    [canReviewInitialization, state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const visibleRequests = reviewMode === "history" ? historyRequests : pendingRequests;
  const visibleInitializationRows = reviewMode === "history" ? historyInitializationRows : pendingInitializationRows;

  const unfilteredReviewRows = useMemo<ParameterReviewRow[]>(
    () => [...visibleInitializationRows, ...visibleRequests.map((request) => ({ kind: "change" as const, request }))],
    [visibleInitializationRows, visibleRequests]
  );
  const getReviewRowField = useCallback((row: ParameterReviewRow, field: "id" | "projectId" | "project" | "module" | "submitter" | "change" | "status") => {
    if (row.kind === "initialization") {
      const submitter = resolveRetainedUserName(state.users, row.review.submittedBy);
      const modules = row.draft.parameterSnapshots.map((snapshot) => snapshot.module);
      const primaryModule = modules[0] ?? "参数初始化";
      const moduleText = modules.length > 1 ? `${primaryModule} 等 ${modules.length} 个模块` : primaryModule;
      const values = {
        id: row.review.id,
        projectId: row.draft.projectId,
        project: row.draft.projectName,
        module: moduleText,
        submitter,
        change: `${row.draft.projectName} → ${row.draft.parameterSnapshots.length} 项参数`,
        status: getParameterInitializationReviewStatusLabel(row.review.status)
      };
      return values[field];
    }

    const { request } = row;
    const parameter = state.parameters.find((item) => item.id === request.parameterId);
    const round = findRetainedSubmissionRound(state.parameterSubmissionRounds, request);
    const projectId = request.projectId ?? round?.projectId ?? parameter?.projectId;
    const project = state.configDraft.projects.find((item) => item.id === projectId);
    const values = {
      id: request.id,
      projectId: projectId ?? "",
      project: project?.name ?? round?.projectName ?? projectId ?? "未关联项目",
      module: request.module,
      submitter: request.submitter,
        change: `${request.currentValue} → ${request.targetValue}`,
        status: formatWorkflowDisplayText(request.status)
    };
    return values[field];
  }, [state.configDraft.projects, state.parameters, state.parameterSubmissionRounds, state.users]);
  const reviewRows = unfilteredReviewRows;
  const selectedRow = reviewRows.find((row) => (row.kind === "initialization" ? row.review.id : row.request.id) === selectedId) ?? reviewRows[0] ?? null;
  const selected = selectedRow?.kind === "change" ? selectedRow.request : null;
  const selectedInitialization = selectedRow?.kind === "initialization" ? selectedRow : null;
  const selectedCreatedAt = selected?.createdAtTs || selected?.createdAt || "";

  const selectedRound = useMemo(() => {
    if (!selected?.submissionRoundId) return null;
    return findRetainedSubmissionRound(state.parameterSubmissionRounds, selected);
  }, [selected, state.parameterSubmissionRounds]);
  const selectedDetailRound = useMemo((): ParameterSubmissionRound | null => {
    if (!selected) return null;
    if (selectedRound) return selectedRound;

    const parameter = state.parameters.find((item) => item.id === selected.parameterId);
    const row = { kind: "change" as const, request: selected };

    return {
      id: selected.submissionRoundId ?? selected.id,
      projectId: getReviewRowField(row, "projectId") || "unknown",
      projectName: getReviewRowField(row, "project"),
      submitter: selected.submitter,
      createdAt: selected.createdAt,
      status: selected.status,
      summary: selected.title,
      items: [
        {
          requestId: selected.id,
          parameterId: selected.parameterId,
          name: parameter?.name ?? selected.title,
          module: selected.module,
          currentValue: selected.currentValue,
          targetValue: selected.targetValue,
          unit: parameter?.unit ?? "",
          risk: parameter?.risk ?? "Medium",
          valueKind: selected.valueKind ?? parameter?.valueKind ?? "scalar",
          reason: ""
        }
      ]
    };
  }, [getReviewRowField, selected, selectedRound, state.parameters]);
  const selectedReviewParameter = useMemo(
    () => (selected ? state.parameters.find((item) => item.id === selected.parameterId) : undefined),
    [selected, state.parameters]
  );
  const historicalMetadataNotice = reviewMode === "history" && selected && selected.editSubjectKind !== "node-enablement" && !selectedReviewParameter && !selectedRound
    ? <p role="note">历史参数引用缺少精确的显示元数据，仅展示归档记录，不推测当前参数。</p>
    : null;
  const selectedModuleDescription = selected?.moduleDescription?.trim() || "";
  const selectedParameterDescription =
    selected?.parameterDescription?.trim() ||
    selectedReviewParameter?.description?.trim() ||
    selectedReviewParameter?.explanation?.trim() ||
    "";
  const selectedInitializationSubmitter = selectedInitialization
    ? resolveRetainedUserName(state.users, selectedInitialization.review.submittedBy)
    : "";
  const selectedProjectName = selected
    ? getReviewRowField({ kind: "change", request: selected }, "project")
    : "";
  const selectedInitializationPrimarySource = selectedInitialization
    ? state.configDraft.projects.find((project) => project.id === selectedInitialization.draft.primarySourceProjectId)
    : null;
  const selectedInitializationSupplementCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.sourceRole === "supplement").length ?? 0;
  const selectedInitializationConfirmationCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.needsRecommendedValueConfirmation).length ?? 0;

  useEffect(() => {
    setMergeLink("");
  }, [selectedId]);



  const dispatchParameterActionFailure = (result: Awaited<ReturnType<NonNullable<PageProps["parameterActions"]>["reviewChange"]>>) => {
    if (result && "notification" in result) {
      if (!result.alreadyNotified) {
        dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
      }
      return true;
    }
    return false;
  };

  const rejectSelected = async (reason: string) => {
    if (selectedInitialization) {
      if (runtimeMode === "api" && parameterInitializationRepository) {
        try {
          const review = await parameterInitializationRepository.reject(
            selectedInitialization.review.id,
            reason
          );
          dispatch({
            type: "HYDRATE_PARAMETER_INITIALIZATION",
            reviews: state.parameterInitializationReviews.map((item) =>
              item.id === review.id ? toLegacyInitializationReview(review) : item
            ),
            statuses: { [review.projectId]: "initialization_rejected" }
          });
          dispatch({ type: "ADD_NOTIFICATION", message: `参数初始化已驳回：${reason}` });
        } catch (error) {
          dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "参数初始化驳回失败，请稍后重试。") });
          return;
        }
      } else {
        dispatch({ type: "REJECT_PARAMETER_INITIALIZATION", reviewId: selectedInitialization.review.id, reason });
      }
      setRejectOpen(false);
      return;
    }
    if (!selected) {
      return;
    }
    const result = parameterActions
      ? await parameterActions.reviewChange({ requestId: selected.id, decision: "reject", note: reason })
      : await Promise.resolve(dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason }));
    if (dispatchParameterActionFailure(result)) {
      return;
    }
    setRefreshVersion((version) => version + 1);
    setRejectOpen(false);
  };
  const advanceSelected = async () => {
    if (!selected) {
      return;
    }
    const requiresMergeLink = selected.status === "软件User合入";
    const trimmedMergeLink = mergeLink.trim();
    if (requiresMergeLink && !isValidMergeLink(trimmedMergeLink)) {
      return;
    }
    const input = {
      requestId: selected.id,
      decision: "advance" as const,
      ...(selected.baseVersion !== undefined ? { expectedVersion: selected.baseVersion } : {}),
      ...(requiresMergeLink ? { note: trimmedMergeLink } : {})
    };
    const result = parameterActions
      ? await parameterActions.reviewChange(input)
      : await Promise.resolve(
          dispatch({
            type: "ADVANCE_REVIEW",
            requestId: selected.id,
            ...(requiresMergeLink ? { note: trimmedMergeLink } : {})
          })
        );
    if (!dispatchParameterActionFailure(result)) setRefreshVersion((version) => version + 1);
  };
  const openSubmissionDetail = (request: ChangeRequest) => {
    setSelectedId(request.id);
    setDetailOpen(true);
  };
  // Batch advance targets review stages only: the merge stage (软件User合入)
  // requires a per-request merge link and stays single-item.
  const batchableRequests = useMemo(
    () =>
      reviewMode === "pending"
        ? reviewRows.flatMap((row) =>
            row.kind === "change" &&
            (visibleLegacyIds === null || visibleLegacyIds.includes(row.request.id)) &&
            row.request.status !== "软件User合入" &&
            canActOnReviewRequest(reviewerRoleId, row.request)
              ? [row.request]
              : []
          )
        : [],
    [reviewMode, reviewRows, reviewerRoleId, visibleLegacyIds]
  );
  const batchableIds = useMemo(() => new Set(batchableRequests.map((request) => request.id)), [batchableRequests]);
  const selectedBatchRequests = batchableRequests.filter((request) => batchSelectedIds.has(request.id));
  const toggleBatchId = (requestId: string) => {
    setBatchSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };
  const toggleBatchAll = () => {
    setBatchSelectedIds((current) =>
      batchableRequests.every((request) => current.has(request.id))
        ? new Set()
        : new Set(batchableRequests.map((request) => request.id))
    );
  };
  const runBatchAdvance = async () => {
    const targets = selectedBatchRequests;
    if (targets.length === 0 || batchProgress) {
      return;
    }
    setBatchProgress({ done: 0, total: targets.length });
    const failures: Array<{ requestId: string; title: string; notification: string }> = [];
    try {
      for (const [index, request] of targets.entries()) {
        const result = parameterActions
          ? await parameterActions.reviewChange(
              {
                requestId: request.id,
                decision: "advance",
                ...(request.baseVersion !== undefined ? { expectedVersion: request.baseVersion } : {})
              },
              // Failures are summarized once below instead of one toast per item.
              { notifyOnFailure: false }
            )
          : await Promise.resolve(dispatch({ type: "ADVANCE_REVIEW", requestId: request.id }));
        if (result && "notification" in result) {
          failures.push({ requestId: request.id, title: request.title, notification: result.notification });
        }
        setBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setRefreshVersion((version) => version + 1);
      setBatchProgress(null);
      setBatchConfirmOpen(false);
    }
    const succeeded = targets.length - failures.length;
    if (succeeded > 0) {
      dispatch({ type: "ADD_NOTIFICATION", message: `已批量通过 ${succeeded} 项变更` });
    }
    if (failures.length > 0) {
      dispatch({
        type: "ADD_NOTIFICATION",
        message: `批量通过失败 ${failures.length} 项（${failures[0].title}：${failures[0].notification}）`
      });
    }
    // Failed rows stay selected so the reviewer can retry them after a look.
    const failedIds = new Set(failures.map((failure) => failure.requestId));
    setBatchSelectedIds(new Set(targets.filter((request) => failedIds.has(request.id)).map((request) => request.id)));
  };
  const canActOnSelectedReview = selected ? canActOnReviewRequest(reviewerRoleId, selected) : false;
  const canRejectSelectedReview = canPerform(reviewerRoleId, "parameter.review");
  const reviewPageTitle = canPerform(reviewerRoleId, "parameter.review") ? "参数管理员工作台" : "参数合入工作台";
  const selectLegacyRequest = useCallback((id: string | null, view: ParameterReviewMode) => {
    setSelectedId(id ?? "");
    setReviewMode(view);
    setRejectOpen(false);
  }, []);
  const inboxLegacyRows: ReviewInboxRow[] = [
    ...pendingInitializationRows.map((row) => ({ row, view: "pending" as const })),
    ...historyInitializationRows.map((row) => ({ row, view: "history" as const })),
    ...pendingRequests.map((request) => ({ row: { kind: "change" as const, request }, view: "pending" as const })),
    ...historyRequests.map((request) => ({ row: { kind: "change" as const, request }, view: "history" as const }))
  ].map(({ row, view }) => ({ id: getReviewRowField(row, "id"), kind: "legacy", view,
    projectId: getReviewRowField(row, "projectId"), project: getReviewRowField(row, "project"),
    module: getReviewRowField(row, "module"), title: row.kind === "change" ? row.request.title : `${row.draft.projectName} 初始化`,
    submitter: getReviewRowField(row, "submitter"), status: getReviewRowField(row, "status"),
    createdAt: row.kind === "change" ? row.request.createdAtTs || row.request.createdAt : row.review.submittedAt
  }));
  const mergeUrl =
    selected?.status === "已合入" && selected.reviewerNote && isValidMergeLink(selected.reviewerNote)
      ? selected.reviewerNote.trim()
      : null;
  const selectedWorkflowItems: VerticalTimelineItem[] = selected
    ? (() => {
        const softwareUserBody: ReactNode = mergeUrl ? (
          <>
            {formatWorkflowDisplayText(
              `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。合入链接：`
            )}
            <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
              {mergeUrl}
            </a>
          </>
        ) : (
          `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。`
        );
        const workflowItems: VerticalTimelineItem[] = [
          {
            time: "流程 1",
            title: "硬件Committer检视",
            body: `硬件 MDE：${getUserName(state.users, selected.workflowAssignees?.hardwareCommitterId)}。`
          },
          {
            time: "流程 2",
            title: "软件Committer检视",
            body: `软件 MDE：${getUserName(state.users, selected.workflowAssignees?.softwareCommitterId)}。`
          },
          {
            time: "流程 3",
            title: "软件User合入",
            body: softwareUserBody
          }
        ];
        const currentWorkflowIndex = workflowItems.findIndex((item) => item.title === selected.status);
        if (currentWorkflowIndex === -1) {
          return [
            {
              time: "当前",
              title: selected.status,
              body: selected.rejectReason ?? `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
              isCurrent: true,
              marker: "当前流程"
            },
            ...workflowItems
          ];
        }

        return workflowItems.map((item, index) =>
          index === currentWorkflowIndex
            ? {
                ...item,
                body: `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
                isCurrent: true,
                marker: "当前流程"
              }
            : item
        );
      })()
    : [];

  return (
    <WorkbenchLayout title={reviewPageTitle}>
      <ReviewInbox projectId={canonicalProjectId} repository={runtimeMode === "api" ? runtime?.parameterCatalogRepository : undefined}
        state={state} search={search} canReview={canReviewCanonical} legacyRows={inboxLegacyRows}
        loading={Boolean(reviewProjectionPending)} error={currentReviewProjection?.error}
        onRequestsChanged={() => setRefreshVersion((version) => version + 1)}
        onVisibleLegacyIds={setVisibleLegacyIds}
        renderRowTitle={(row) => {
          if (row.kind !== "legacy") return row.title;
          const request = state.changeRequests.find((item) => item.id === row.id);
          if (!request) return row.title;
          const parameter = state.parameters.find((item) => item.id === request.parameterId);
          return shouldSummarizeReviewChange(request, parameter)
            ? <ReviewChangeValueSummary layout="complex" parameter={parameter} request={request} />
            : <><span className="value-change__title">{row.title}</span><ReviewChangeValueSummary parameter={parameter} request={request} /></>;
        }}
        onLegacySelect={selectLegacyRequest} onOpenLegacy={(id) => {
          const request = state.changeRequests.find((item) => item.id === id);
          if (request) openSubmissionDetail(request);
        }}
        queueActions={<>
          {reviewMode === "pending" && batchableRequests.length > 0 ? (
          <div className="review-batch-toolbar" role="toolbar" aria-label="批量审阅操作">
            <span className="review-batch-toolbar__hint">
              {selectedBatchRequests.length > 0
                ? `已选 ${selectedBatchRequests.length} 项待检视变更`
                : "勾选待检视变更后可批量通过（合入阶段需逐条填写合入链接）"}
            </span>
            <Button
              type="button"
              disabled={selectedBatchRequests.length === 0 || batchProgress !== null}
              onClick={() => setBatchConfirmOpen(true)}
            >
              {batchProgress ? `通过中 ${batchProgress.done}/${batchProgress.total}…` : `批量通过（${selectedBatchRequests.length} 项）`}
            </Button>
          </div>
        ) : null}
          <ConfirmDialog
            open={batchConfirmOpen}
            title="确认批量通过"
            description={
              <p>
                将按顺序推进选中的 {selectedBatchRequests.length} 项待检视变更（逐项校验版本），失败项会保留在列表并汇总原因；
                合入阶段的请求不在批量范围内。
              </p>
            }
            confirmLabel={`通过 ${selectedBatchRequests.length} 项`}
            pending={batchProgress !== null}
            pendingLabel={batchProgress ? `通过中 ${batchProgress.done}/${batchProgress.total}…` : "通过中…"}
            onCancel={() => {
              if (batchProgress) return;
              setBatchConfirmOpen(false);
            }}
            onConfirm={() => void runBatchAdvance()}
          />
        </>}
        selectAll={batchableRequests.length ? <input type="checkbox" aria-label="全选可批量通过的变更"
          checked={batchableRequests.every((request) => batchSelectedIds.has(request.id))} onChange={toggleBatchAll} /> : null}
        renderRowSelection={batchableRequests.length ? (row) => batchableIds.has(row.id) ? <input type="checkbox"
          aria-label={`选择 ${row.title} 加入批量通过`} checked={batchSelectedIds.has(row.id)}
          onClick={(event) => event.stopPropagation()} onChange={() => toggleBatchId(row.id)} /> : null : undefined}
        renderLegacyDetail={() => <>
        {selectedInitialization ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">参数初始化</span>
              <h3>参数初始化</h3>
              <p>
                {selectedInitialization.draft.projectName} 初始化由 {selectedInitializationSubmitter} 提交。
              </p>
            </div>
            <div className="ai-summary-card">
              <SectionLabel icon={<Sparkles size={16} />} label="变更摘要" />
              <p>项目：{selectedInitialization.draft.projectName}</p>
              <p>
                主来源：{selectedInitializationPrimarySource?.name ?? selectedInitialization.draft.primarySourceProjectId}
              </p>
              <p>已选参数：{selectedInitialization.draft.parameterSnapshots.length}</p>
              <p>补充来源填充：{selectedInitializationSupplementCount}</p>
              <p>需确认推荐值：{selectedInitializationConfirmationCount}</p>
            </div>
            <div className="detail-card">
              <h3>前后对比</h3>
              <p>新项目初始化：从固定来源参数快照建立推荐值。</p>
              <ol>{selectedInitialization.draft.parameterSnapshots.map((snapshot) => <li key={snapshot.parameterId}>
                {state.parameters.find((parameter) => parameter.id === snapshot.parameterId)?.name ?? snapshot.parameterId}：未初始化 → {snapshot.recommendedValue}
              </li>)}</ol>
              <h3>影响范围</h3>
              <p>{selectedInitialization.draft.projectName} · {selectedInitialization.draft.parameterSnapshots.length} 项参数</p>
            </div>
            {selectedInitialization.review.rejectionReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="驳回原因" />
                <p>{selectedInitialization.review.rejectionReason}</p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="初始化状态" />
              <VerticalTimeline
                items={[
                  {
                    time: "当前",
                    title: getParameterInitializationReviewStatusLabel(selectedInitialization.review.status),
                    body: selectedInitialization.review.rejectionReason ?? "等待参数管理员处理。",
                    isCurrent: selectedInitialization.review.status === "pending",
                    marker: selectedInitialization.review.status === "pending" ? "当前流程" : undefined
                  },
                  {
                    time: "已提交",
                    title: formatRelativeOrAbsolute(selectedInitialization.review.submittedAt),
                    titleHint: formatAbsolute(selectedInitialization.review.submittedAt),
                    body: selectedInitialization.draft.notes || "已从来源项目推荐值生成初始化快照。"
                  }
                ]}
              />
            </div>
            {selectedInitialization.review.status === "pending" ? (
              <div className="action-panel">
                <Button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      if (!selectedInitialization) {
                        return;
                      }
                      if (runtimeMode === "api" && parameterInitializationRepository) {
                        try {
                          const review = await parameterInitializationRepository.approve(
                            selectedInitialization.review.id
                          );
                          dispatch({
                            type: "APPROVE_PARAMETER_INITIALIZATION",
                            reviewId: review.id
                          });
                          dispatch({
                            type: "HYDRATE_PROJECT_INITIALIZATION_STATUS",
                            projectId: review.projectId,
                            status: "initialized"
                          });
                        } catch (error) {
                          dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "参数初始化通过失败，请稍后重试。") });
                        }
                        return;
                      }
                      dispatch({
                        type: "APPROVE_PARAMETER_INITIALIZATION",
                        reviewId: selectedInitialization.review.id
                      });
                    })();
                  }}
                >
                  <CheckCircle2 size={17} />
                  通过初始化
                </Button>
                <Button type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                  <CircleOff size={17} />
                  驳回初始化
                </Button>
              </div>
            ) : null}
            <ReviewProvenance key={selectedInitialization.review.id} entries={[
              { label: "请求 ID", value: selectedInitialization.review.id },
              { label: "草稿 ID", value: selectedInitialization.draft.id },
              { label: "项目 ID", value: selectedInitialization.draft.projectId },
              { label: "提交人 ID", value: selectedInitialization.review.submittedBy },
              { label: "提交时间", value: selectedInitialization.review.submittedAt }
            ]} />
          </>
        ) : selected ? (
          <>
            <div className="ai-summary-card review-detail-hero">
              <div className="review-detail-hero__header">
                <span className="eyebrow">旧版 · {selectedProjectName}</span>
                <h3>{selected.title}</h3>
                <StatusBadge status={selected.status} />
                <p className="review-detail-hero__meta">
                  目标模块 <strong>{selected.module}</strong>
                  <span aria-hidden="true"> · </span>
                  {selected.submitter} → {getUserName(state.users, selected.assignedTo)}
                  <span aria-hidden="true"> · </span>
                  <time dateTime={selectedCreatedAt} title={formatAbsolute(selectedCreatedAt)}>{formatRelativeOrAbsolute(selectedCreatedAt)}</time>
                </p>
              </div>
              {historicalMetadataNotice}
              <SectionLabel icon={<Sparkles size={16} />} label="变更摘要" />
              <ReviewDetailSummary
                onOpenSubmissionDetail={() => openSubmissionDetail(selected)}
                parameter={selectedReviewParameter}
                request={selected}
                moduleName={selected.module}
                moduleDescription={selectedModuleDescription}
                parameterDescription={selectedParameterDescription}
              />
              {selectedDetailRound ? (
                <Button
                  variant="outline"
                  type="button"
                  className="review-detail-hero__detail-action"
                  onClick={() => openSubmissionDetail(selected)}
                >
                  <FileText size={16} />
                  查看提交详情（{selectedDetailRound.items.length} 项变更）
                </Button>
              ) : null}
            </div>
            <div className="detail-card review-inbox__comparison">
              <h3>前后对比</h3>
              {selectedDetailRound?.items.map((item) => <SubmissionHistoryDiffCard key={item.requestId} item={item} />)}
              <h3>影响范围</h3>
              <p>{selectedProjectName} · {selected.module} · {selectedDetailRound?.items.length ?? 1} 项变更</p>
              <ReviewImpactList items={selected.impact} />
            </div>
            {selected.rejectReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="打回原因" />
                <p>{selected.rejectReason}</p>
              </div>
            ) : null}
            {mergeUrl ? (
              <div className="merge-link-card">
                <SectionLabel icon={<Link2 size={16} />} label="合入链接" />
                <p>
                  <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
                    {mergeUrl}
                  </a>
                </p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="变更历史" />
              <VerticalTimeline items={selectedWorkflowItems} />
            </div>
            {reviewMode === "pending" && canActOnSelectedReview ? (
              <div className="action-panel">
                {selected.status === "软件User合入" ? (
                  <div className="review-merge-link">
                    <label htmlFor="review-merge-link">合入链接</label>
                    <input
                      id="review-merge-link"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://"
                      value={mergeLink}
                      onChange={(event) => setMergeLink(event.target.value)}
                      aria-invalid={mergeLink.trim().length > 0 && !isValidMergeLink(mergeLink)}
                    />
                    {mergeLink.trim().length > 0 && !isValidMergeLink(mergeLink) ? (
                      <span className="review-merge-link__hint" role="status">
                        请输入以 http 或 https 开头的合入链接
                      </span>
                    ) : (
                      <span className="review-merge-link__hint">确认合入前必须填写可访问的合入链接</span>
                    )}
                  </div>
                ) : null}
                <Button
                  type="button"
                  disabled={selected.status === "软件User合入" && !isValidMergeLink(mergeLink)}
                  onClick={() => void advanceSelected()}
                >
                  <CheckCircle2 size={17} />
                  {canPerform(reviewerRoleId, "parameter.merge") && !canPerform(reviewerRoleId, "parameter.review")
                    ? "确认合入"
                    : "推进流程"}
                </Button>
                {canRejectSelectedReview ? (
                  <Button type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                    <CircleOff size={17} />
                    打回修改
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ReviewProvenance key={selected.id} entries={[
              { label: "请求 ID", value: selected.id },
              { label: "参数 ID", value: selected.parameterId },
              { label: "项目 ID", value: getReviewRowField({ kind: "change", request: selected }, "projectId") },
              { label: "提交轮次 ID", value: selected.submissionRoundId },
              { label: "当前处理人 ID", value: selected.assignedTo },
              { label: "基线版本", value: selected.baseVersion },
              { label: "提交时间", value: selectedCreatedAt }
            ]} />
          </>
        ) : (
          <EmptyState text={reviewMode === "history" ? "当前没有历史审阅。" : "当前没有待审阅请求。"} />
        )}
        </>} />
      {rejectOpen && (selected || selectedInitialization) ? (
        <RejectReviewDialog
          onCancel={() => setRejectOpen(false)}
          onSubmit={rejectSelected}
        />
      ) : null}
      {detailOpen && selectedDetailRound ? (
        <ModalDialog
          open
          onDismiss={() => setDetailOpen(false)}
          className={[
            "submission-dialog",
            selectedDetailRound.items.some(isComplexSubmissionHistoryItem) ? "submission-dialog--wide" : "",
            "submission-detail-dialog"
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {({ titleId }) => (
            <>
              <div className="submission-dialog-head">
                <div>
                  <span className="eyebrow">{selectedDetailRound.projectName}</span>
                  <h2 id={titleId}>提交详情</h2>
                  <p>本轮提交包含 {selectedDetailRound.items.length} 个参数修改，由 {selectedDetailRound.submitter} 提交。</p>
                  {historicalMetadataNotice}
                  {shouldShowSubmissionRoundSummary(selectedDetailRound) ? <p>{selectedDetailRound.summary}</p> : null}
                </div>
              </div>
              <div className="submission-diff-list">
                {selectedDetailRound.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
              </div>
              <div className="dialog-actions">
                <button className="button subtle" type="button" onClick={() => setDetailOpen(false)}>关闭</button>
              </div>
            </>
          )}
        </ModalDialog>
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  onCancel,
  onSubmit
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const submitRejection = () => {
    if (trimmedReason) {
      onSubmit(trimmedReason);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent className="rejection-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>打回修改</AlertDialogTitle>
          <AlertDialogDescription>
            将这项修改打回给提交人，管理员需要填写明确原因，方便项目侧补充测试数据或重新调整目标值。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label htmlFor="reject-reason">打回原因</Label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          placeholder="说明需要补充的测试数据、风险依据或参数调整方向"
        />
        <AlertDialogFooter className="dialog-actions">
          <AlertDialogCancel type="button" onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={!trimmedReason} onClick={submitRejection}>
            提交打回
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
