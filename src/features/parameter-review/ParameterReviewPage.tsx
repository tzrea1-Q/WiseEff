import { canPerform } from "@/app/permissions";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { type PageProps } from "@/app/routes";
import { toLegacyInitializationReview } from "@/application/parameters/initializationUiMappers";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { isValidMergeLink } from "@/domain/parameters/mergeLink";
import { isActiveSubmissionRound } from "@/domain/parameters/submissionRound";
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
import { EmptyState, SectionLabel, WorkbenchLayout, getContextQuery, riskLabels } from "@/workbenchUi";
import { CheckCircle2, CircleOff, FileText, Link2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  userId: string | null | undefined,
  historicalName?: string | null
) {
  if (historicalName !== undefined) return historicalName ?? "历史署名未记录";
  if (userId === undefined) return "未指派";
  if (userId === null) return "已注销用户";
  return users.find((user) => user.id === userId)?.name ?? "成员姓名暂不可用";
}

export function ParameterReviewPage({
  state,
  dispatch,
  onNavigate,
  search,
  parameterActions,
  runtime,
  runtimeMode
}: PageProps) {
  const sourceRepository = useMemo(() => runtimeMode === "api" ? resolveParameterFileRepository("api") : undefined, [runtimeMode]);
  const reviewProjectId = getContextQuery(search).projectId || state.activeProjectId;
  const parameterRepository = runtime?.parameterRepository;
  const parameterInitializationRepository = runtime?.parameterInitializationRepository;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const permissionKey = JSON.stringify([currentUser?.isActive, currentUser?.roles]);
  const reviewScope = useMemo(() => ({ parameterRepository, parameterInitializationRepository, runtimeMode,
    userId: state.currentUserId, projectId: reviewProjectId, activeRoleId: state.activeRoleId, permissionKey }),
  [parameterRepository, parameterInitializationRepository, runtimeMode, state.currentUserId, reviewProjectId, state.activeRoleId, permissionKey]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [reviewProjection, setReviewProjection] = useState<{
    scope: typeof reviewScope;
    requests: ChangeRequest[];
    rounds: ParameterSubmissionRound[];
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (runtimeMode !== "api" || !parameterRepository || !reviewProjectId) return;
    let cancelled = false;
    setReviewProjection(null);
    void Promise.all([
      parameterRepository.listChangeRequests({ projectId: reviewProjectId }),
      parameterRepository.listSubmissionRounds({ projectId: reviewProjectId })
    ]).then(([requests, rounds]) => {
      if (!cancelled) setReviewProjection({ scope: reviewScope, requests, rounds, error: null });
    }).catch((error) => {
      if (!cancelled) {
        setReviewProjection({ scope: reviewScope, requests: [], rounds: [],
          error: presentError(error, "审阅记录加载失败，请稍后重试。") });
        dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "审阅记录加载失败，请稍后重试。") });
      }
    });
    return () => { cancelled = true; };
  }, [dispatch, reviewScope, refreshVersion, runtimeMode, parameterRepository, reviewProjectId]);
  const currentReviewProjection = reviewProjection?.scope === reviewScope ? reviewProjection : null;
  if (runtimeMode === "api" && parameterRepository) {
    state = {
      ...state,
      changeRequests: currentReviewProjection?.requests ?? [],
      parameterSubmissionRounds: currentReviewProjection?.rounds ?? []
    };
  }
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
  const [actionTarget, setActionTarget] = useState<ParameterReviewRow | null>(null);
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMergeLink, setActionMergeLink] = useState("");
  const [actionScopeKey, setActionScopeKey] = useState<typeof reviewScope | null>(null);
  const [detailOpenScope, setDetailOpenScope] = useState<typeof reviewScope | null>(null);
  const [mergeLinkValue, setMergeLink] = useState("");
  const [batchSelectedIds, setBatchSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [visibleLegacyIds, setVisibleLegacyIds] = useState<string[] | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchTargets, setBatchTargets] = useState<ChangeRequest[]>([]);
  const [batchScopeKey, setBatchScopeKey] = useState<typeof reviewScope | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchFailures, setBatchFailures] = useState<Array<{ requestId: string; title: string; notification: string }>>([]);
  const [reviewMode, setReviewMode] = useState<ParameterReviewMode>(requestedLegacyIsHistory ? "history" : "pending");
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const reviewProjectionPending = runtimeMode === "api" && parameterRepository && !currentReviewProjection;
  const canonicalProjectId = contextQuery.projectId || state.activeProjectId;
  const currentActionScopeKey = reviewScope;
  const mergeLinkTargetRef = useRef({ scopeKey: currentActionScopeKey, requestId: selectedId });
  const mergeLink = mergeLinkTargetRef.current.scopeKey === currentActionScopeKey
    && (!selectedId || mergeLinkTargetRef.current.requestId === selectedId) ? mergeLinkValue : "";
  const actionScopeRef = useRef(currentActionScopeKey);
  actionScopeRef.current = currentActionScopeKey;
  useEffect(() => {
    setBatchSelectedIds(new Set());
    setBatchFailures([]);
    setBatchConfirmOpen(false);
    setRejectOpen(false);
    setAdvanceConfirmOpen(false);
    setActionTarget(null);
    setActionMergeLink("");
    setDetailOpenScope(null);
  }, [currentActionScopeKey]);
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
      const submitter = resolveRetainedUserName(state.users, row.review.submittedBy, row.review.submittedByName);
      const modules = [...new Set(row.draft.parameterSnapshots.map((snapshot) => snapshot.module))];
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
          editSubjectKind: selected.editSubjectKind,
          logicalNodeId: selected.logicalNodeId,
          parameterId: selected.parameterId,
          name: parameter?.name ?? selected.title,
          module: selected.module,
          currentValue: selected.currentValue,
          targetValue: selected.targetValue,
          unit: "",
          // The legacy item shape requires a risk, but no frozen metadata was
          // retained here. The fallback card hides it instead of asserting it.
          risk: "Medium",
          valueKind: selected.valueKind ?? parameter?.valueKind ?? "scalar",
          reason: ""
        }
      ]
    };
  }, [getReviewRowField, selected, selectedRound, state.parameters]);
  const selectedDetailItem = selectedDetailRound?.items.find((item) => selected && item.requestId === selected.id && item.parameterId === selected.parameterId);
  const otherRoundItems = selectedDetailRound?.items.filter((item) => item !== selectedDetailItem) ?? [];
  const canExpandSubmission = otherRoundItems.length > 0 || Boolean(selectedDetailItem && isComplexSubmissionHistoryItem(selectedDetailItem));
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
    ? resolveRetainedUserName(state.users, selectedInitialization.review.submittedBy, selectedInitialization.review.submittedByName)
    : "";
  const selectedInitializationPrimarySource = selectedInitialization
    ? state.configDraft.projects.find((project) => project.id === selectedInitialization.draft.primarySourceProjectId)
    : null;
  const selectedInitializationSupplementCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.sourceRole === "supplement").length ?? 0;
  const selectedInitializationConfirmationCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.needsRecommendedValueConfirmation).length ?? 0;

  useEffect(() => {
    const previous = mergeLinkTargetRef.current;
    // A refresh briefly clears selection; only a real target or scope change discards the draft.
    if (previous.scopeKey !== currentActionScopeKey || (selectedId && previous.requestId !== selectedId)) {
      setMergeLink("");
      mergeLinkTargetRef.current = { scopeKey: currentActionScopeKey, requestId: selectedId };
    }
  }, [selectedId, currentActionScopeKey]);



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
    if (!actionTarget || actionScopeKey !== currentActionScopeKey || actionPending) return;
    setActionPending(true);
    setActionError("");
    try {
      if (actionTarget.kind === "initialization") {
        if (runtimeMode === "api" && parameterInitializationRepository) {
          const review = await parameterInitializationRepository.reject(
            actionTarget.review.id,
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
        } else {
          dispatch({ type: "REJECT_PARAMETER_INITIALIZATION", reviewId: actionTarget.review.id, reason });
        }
        setRejectOpen(false);
        setActionTarget(null);
        return;
      }
      const selected = actionTarget.request;
      const result = parameterActions
        ? await parameterActions.reviewChange({ requestId: selected.id, decision: "reject", note: reason })
        : await Promise.resolve(dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason }));
      if (dispatchParameterActionFailure(result)) {
        if (result && "notification" in result) setActionError(result.notification);
        return;
      }
      setRefreshVersion((version) => version + 1);
      setRejectOpen(false);
      setActionTarget(null);
    } catch (error) {
      setActionError(presentError(error, "打回失败，请稍后重试。"));
    } finally {
      setActionPending(false);
    }
  };
  const advanceSelected = async () => {
    if (!actionTarget || actionScopeKey !== currentActionScopeKey || actionPending) return;
    setActionPending(true);
    setActionError("");
    try {
      if (actionTarget.kind === "initialization") {
        if (runtimeMode === "api" && parameterInitializationRepository) {
          const review = await parameterInitializationRepository.approve(actionTarget.review.id);
          dispatch({ type: "APPROVE_PARAMETER_INITIALIZATION", reviewId: review.id });
          dispatch({ type: "HYDRATE_PROJECT_INITIALIZATION_STATUS", projectId: review.projectId, status: "initialized" });
        } else {
          dispatch({ type: "APPROVE_PARAMETER_INITIALIZATION", reviewId: actionTarget.review.id });
        }
        setAdvanceConfirmOpen(false);
        return;
      }
      const selected = actionTarget.request;
      const requiresMergeLink = selected.status === "软件User合入";
      const trimmedMergeLink = actionMergeLink.trim();
      if (requiresMergeLink && !isValidMergeLink(trimmedMergeLink)) return;
      const input = {
        requestId: selected.id,
        decision: "advance" as const,
        ...(selected.baseVersion !== undefined ? { expectedVersion: selected.baseVersion } : {}),
        ...(requiresMergeLink ? { note: trimmedMergeLink } : {})
      };
      const result = parameterActions
        ? await parameterActions.reviewChange(input)
        : await Promise.resolve(dispatch({ type: "ADVANCE_REVIEW", requestId: selected.id,
          ...(requiresMergeLink ? { note: trimmedMergeLink } : {}) }));
      if (dispatchParameterActionFailure(result)) {
        if (result && "notification" in result) setActionError(result.notification);
      } else {
        setRefreshVersion((version) => version + 1);
        setAdvanceConfirmOpen(false);
      }
    } catch (error) {
      setActionError(presentError(error, "处理失败，请稍后重试。"));
    } finally {
      setActionPending(false);
    }
  };
  const openDecision = (decision: "advance" | "reject") => {
    setActionTarget(selectedRow);
    setActionScopeKey(currentActionScopeKey);
    setActionMergeLink(mergeLink);
    setActionError("");
    if (decision === "reject") setRejectOpen(true);
    else setAdvanceConfirmOpen(true);
  };
  const openSubmissionDetail = (request: ChangeRequest) => {
    setSelectedId(request.id);
    setDetailOpenScope(reviewScope);
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
    const targets = batchTargets;
    if (targets.length === 0 || batchProgress || batchScopeKey !== currentActionScopeKey) {
      return;
    }
    setBatchProgress({ done: 0, total: targets.length });
    setBatchFailures([]);
    const failures: Array<{ requestId: string; title: string; notification: string }> = [];
    try {
      for (const [index, request] of targets.entries()) {
        if (actionScopeRef.current !== batchScopeKey) break;
        try {
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
        } catch (error) {
          failures.push({ requestId: request.id, title: request.title, notification: presentError(error, "处理失败，请重试。") });
        }
        setBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setRefreshVersion((version) => version + 1);
      setBatchProgress(null);
      setBatchConfirmOpen(false);
    }
    const succeeded = targets.length - failures.length;
    if (actionScopeRef.current !== batchScopeKey) return;
    setBatchFailures(failures);
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
  const reviewPageTitle = "变更审阅";
  const selectLegacyRequest = useCallback((id: string | null, view: ParameterReviewMode) => {
    setSelectedId(id ?? "");
    setReviewMode(view);
  }, []);
  const inboxLegacyRows: ReviewInboxRow[] = [
    ...pendingInitializationRows.map((row) => ({ row, view: "pending" as const })),
    ...historyInitializationRows.map((row) => ({ row, view: "history" as const })),
    ...pendingRequests.map((request) => ({ row: { kind: "change" as const, request }, view: "pending" as const })),
    ...historyRequests.map((request) => ({ row: { kind: "change" as const, request }, view: "history" as const }))
  ].map(({ row, view }) => ({ id: getReviewRowField(row, "id"), kind: "legacy", view,
    typeLabel: row.kind === "initialization" ? "参数初始化" : row.request.editSubjectKind === "node-enablement" ? "节点状态" : runtimeMode === "api" ? "历史参数" : "参数变更",
    projectId: getReviewRowField(row, "projectId"), project: getReviewRowField(row, "project"),
    module: getReviewRowField(row, "module"), title: row.kind === "change" ? row.request.title : `${row.draft.projectName} 初始化`,
    submitter: getReviewRowField(row, "submitter"), status: getReviewRowField(row, "status"),
    createdAt: row.kind === "change" ? row.request.createdAtTs || row.request.createdAt : row.review.submittedAt,
    handledAt: view === "history" ? row.kind === "change" ? row.request.updatedAt : row.review.reviewedAt : undefined,
    assignedToId: row.kind === "change" ? row.request.assignedTo : undefined,
    handledBy: view === "history" ? row.kind === "initialization"
      ? resolveRetainedUserName(state.users, row.review.reviewedBy, row.review.reviewedByName)
      : (() => {
        const decision = state.parameterReviewDecisions.filter((item) => item.requestId === row.request.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        return decision ? resolveRetainedUserName(state.users, decision.reviewerUserId, decision.reviewerName) : undefined;
      })() : undefined,
    assignedTo: row.kind === "change" ? resolveRetainedUserName(state.users, row.request.assignedTo) : view === "pending" ? "参数管理员" : resolveRetainedUserName(state.users, row.review.reviewedBy, row.review.reviewedByName)
  }));
  const mergeUrl =
    selected?.status === "已合入" && selected.reviewerNote && isValidMergeLink(selected.reviewerNote)
      ? selected.reviewerNote.trim()
      : null;
  const selectedWorkflowItems: VerticalTimelineItem[] = selected
    ? (() => {
        const recordedItems: VerticalTimelineItem[] = [
          { time: formatRelativeOrAbsolute(selectedCreatedAt), titleHint: formatAbsolute(selectedCreatedAt), title: "提交变更", body: `${selected.submitter} 提交了本次修改。` },
          ...state.parameterReviewDecisions.filter((decision) => decision.requestId === selected.id)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map((decision) => ({ time: formatRelativeOrAbsolute(decision.createdAt), titleHint: formatAbsolute(decision.createdAt),
              title: decision.decision === "reject" ? "打回修改" : "通过检视",
              body: `${resolveRetainedUserName(state.users, decision.reviewerUserId, decision.reviewerName)}：${decision.fromStatus} → ${decision.toStatus}` }))
        ];
        if (reviewMode === "history") {
          return [...recordedItems, { time: selected.updatedAt ? formatRelativeOrAbsolute(selected.updatedAt) : "处理结果",
            titleHint: selected.updatedAt ? formatAbsolute(selected.updatedAt) : undefined, title: selected.status,
            body: "此记录已结束本阶段审阅。" }];
        }
        return recordedItems;
      })()
    : [];

  return (
    <WorkbenchLayout title={reviewPageTitle}>
      <ReviewInbox projectId={canonicalProjectId} repository={runtimeMode === "api" ? runtime?.parameterCatalogRepository : undefined}
        sourceRepository={sourceRepository}
        state={state} search={search} canReview={canReviewCanonical} legacyRows={inboxLegacyRows}
        onNavigate={onNavigate}
        busy={actionPending || batchProgress !== null}
        loading={Boolean(reviewProjectionPending)} error={currentReviewProjection?.error}
        onRequestsChanged={() => setRefreshVersion((version) => version + 1)}
        onVisibleLegacyIds={setVisibleLegacyIds}
        renderRowTitle={(row) => {
          if (row.kind !== "legacy") return row.title;
          const request = state.changeRequests.find((item) => item.id === row.id);
          if (!request) return row.title;
          const parameter = state.parameters.find((item) => item.id === request.parameterId);
          return <ReviewChangeValueSummary parameter={parameter} request={request} />;
        }}
        onLegacySelect={selectLegacyRequest}
        queueActions={<>
          {reviewMode === "pending" && (selectedBatchRequests.length > 0 || batchFailures.length > 0) ? (
          <div className="review-batch-toolbar" role="toolbar" aria-label="批量审阅操作">
            <span className="review-batch-toolbar__hint">
              已选 {selectedBatchRequests.length} 项待检视变更
            </span>
            <Button
              type="button"
              disabled={selectedBatchRequests.length === 0 || batchProgress !== null || actionPending}
              onClick={() => {
                setBatchTargets(selectedBatchRequests);
                setBatchScopeKey(currentActionScopeKey);
                setBatchConfirmOpen(true);
              }}
            >
              {batchProgress ? `通过中 ${batchProgress.done}/${batchProgress.total}…` : `批量通过（${selectedBatchRequests.length} 项）`}
            </Button>
          </div>
        ) : null}
          {batchFailures.length > 0 ? <details className="review-batch-failures" open>
            <summary>{batchFailures.length} 项未通过，失败项已保留</summary>
            <ul>{batchFailures.map((failure) => <li key={failure.requestId}>{failure.title}：{failure.notification}</li>)}</ul>
          </details> : null}
          <ConfirmDialog
            open={batchConfirmOpen && batchScopeKey === currentActionScopeKey}
            title="确认批量通过"
            description={
              <p>
                将通过选中的 {batchTargets.length} 项当前检视，失败项会保留在列表并分别说明原因；
                合入阶段的请求不在批量范围内。
              </p>
            }
            confirmLabel={`通过 ${batchTargets.length} 项`}
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
          disabled={actionPending || batchProgress !== null} checked={batchableRequests.every((request) => batchSelectedIds.has(request.id))} onChange={toggleBatchAll} /> : null}
        renderRowSelection={batchableRequests.length ? (row) => batchableIds.has(row.id) ? <input type="checkbox"
          aria-label={`选择 ${row.title} 加入批量通过`} checked={batchSelectedIds.has(row.id)}
          disabled={actionPending || batchProgress !== null}
          onClick={(event) => event.stopPropagation()} onChange={() => toggleBatchId(row.id)} /> : null : undefined}
        renderLegacyDetail={() => <>
        {selectedInitialization ? (
          <>
            <div className="detail-card review-detail-hero">
              <h3>{selectedInitialization.draft.projectName} 初始化</h3>
              <StatusBadge status={getParameterInitializationReviewStatusLabel(selectedInitialization.review.status)} />
              <p className="review-detail-hero__meta">
                提交人 {selectedInitializationSubmitter} · 提交时间 <time dateTime={selectedInitialization.review.submittedAt}
                  title={formatAbsolute(selectedInitialization.review.submittedAt)}>{formatRelativeOrAbsolute(selectedInitialization.review.submittedAt)}</time>
              </p>
              {selectedInitialization.draft.notes.trim() ? <p>{selectedInitialization.draft.notes}</p> : null}
            </div>
            <section className="review-legacy-section" aria-label="将建立的参数">
              <h3>将建立的参数（{selectedInitialization.draft.parameterSnapshots.length} 项）</h3>
              <p>主来源 {selectedInitializationPrimarySource?.name || "来源名称未记录"}
                {selectedInitializationSupplementCount > 0 ? `；其中 ${selectedInitializationSupplementCount} 项来自补充来源` : ""}。
                {selectedInitializationConfirmationCount > 0 ? <a href="#initialization-snapshots">{selectedInitializationConfirmationCount} 项推荐值需核对</a> : null}
              </p>
              <ol className="review-initialization-list" id="initialization-snapshots">{[...selectedInitialization.draft.parameterSnapshots]
                .sort((left, right) => Number(right.needsRecommendedValueConfirmation) - Number(left.needsRecommendedValueConfirmation)).map((snapshot) => <li className="review-initialization-list__item" key={snapshot.parameterId}>
                <strong>{state.parameters.find((parameter) => parameter.id === snapshot.parameterId)?.name || "参数名称未记录"}</strong>
                <p className="review-initialization-list__meta">{snapshot.module} · {riskLabels[snapshot.risk]}风险 · {snapshot.sourceRole === "primary" ? "主来源" : "补充来源"}：{state.configDraft.projects.find((project) => project.id === snapshot.sourceProjectId)?.name || "来源名称未记录"}</p>
                {snapshot.needsRecommendedValueConfirmation ? <p className="review-initialization-list__attention">需核对推荐值</p> : null}
                {shouldSummarizeReviewChange({ currentValue: "", targetValue: snapshot.recommendedValue }) ? <details open={snapshot.needsRecommendedValueConfirmation}>
                  <summary>查看完整推荐值</summary><pre aria-label="冻结推荐值"
                    tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Long frozen recommendations support keyboard scrolling. */}><code>{snapshot.recommendedValue}</code></pre>
                </details> : <pre aria-label="冻结推荐值"><code>{snapshot.recommendedValue}</code></pre>}
                {snapshot.notes?.trim() ? <p>{snapshot.notes}</p> : null}
                <details><summary>参数与来源信息</summary>
                  <dl><dt>参数 ID</dt><dd><code>{snapshot.parameterId}</code></dd>
                    <dt>来源项目 ID</dt><dd><code>{snapshot.sourceProjectId}</code></dd>
                    {snapshot.alternativeSourceProjectIds.length > 0 ? <><dt>备选来源项目</dt><dd>{snapshot.alternativeSourceProjectIds.map((id) => <p key={id}>{state.configDraft.projects.find((project) => project.id === id)?.name || "名称未记录"} · <code>{id}</code></p>)}</dd></> : null}
                  </dl>
                </details>
              </li>)}</ol>
            </section>
            {selectedInitialization.review.status === "rejected" ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="驳回原因" />
                <p>{selectedInitialization.review.rejectionReason || "未记录驳回原因"}</p>
              </div>
            ) : null}
            <details className="review-workflow-records">
              <summary>处理记录</summary>
              <VerticalTimeline
                items={[
                  {
                    time: selectedInitialization.review.status === "pending" ? "当前" : selectedInitialization.review.reviewedAt ? formatRelativeOrAbsolute(selectedInitialization.review.reviewedAt) : "处理时间未记录",
                    titleHint: selectedInitialization.review.reviewedAt ? formatAbsolute(selectedInitialization.review.reviewedAt) : undefined,
                    title: getParameterInitializationReviewStatusLabel(selectedInitialization.review.status),
                    body: selectedInitialization.review.status === "pending" ? "等待初始化审核。" : `${resolveRetainedUserName(state.users, selectedInitialization.review.reviewedBy, selectedInitialization.review.reviewedByName)}。${selectedInitialization.review.status === "approved" ? "初始化参数已建立。" : "本次初始化未通过。"}`,
                    isCurrent: selectedInitialization.review.status === "pending",
                    marker: selectedInitialization.review.status === "pending" ? "当前流程" : undefined
                  },
                  {
                    time: "已提交",
                    title: formatRelativeOrAbsolute(selectedInitialization.review.submittedAt),
                    titleHint: formatAbsolute(selectedInitialization.review.submittedAt),
                    body: `提交人：${selectedInitializationSubmitter}`
                  }
                ]}
              />
            </details>
            {selectedInitialization.review.status === "pending" ? (
              <div className="action-panel review-detail-actions">
                <p className="review-action-description">通过后完成该项目的参数初始化。</p>
                <Button
                  type="button"
                  disabled={actionPending}
                  onClick={() => openDecision("advance")}
                >
                  <CheckCircle2 size={17} />
                  通过初始化
                </Button>
                <Button type="button" variant="destructive" disabled={actionPending} onClick={() => openDecision("reject")}>
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
              { label: "主来源项目 ID", value: selectedInitialization.draft.primarySourceProjectId },
              { label: "补充来源项目 ID", value: selectedInitialization.draft.supplementSourceProjectIds },
              { label: "提交时间", value: selectedInitialization.review.submittedAt }
            ]} />
          </>
        ) : selected ? (
          <>
            <div className="ai-summary-card review-detail-hero">
              <div className="review-detail-hero__header">
                <h3>{selected.title}</h3>
                <StatusBadge status={selected.status} />
                <p className="review-detail-hero__meta">
                  提交人 {selected.submitter}
                  {isActiveSubmissionRound(selected.status) ? <><span aria-hidden="true"> · </span>指定处理人 {resolveRetainedUserName(state.users, selected.assignedTo)}</> : null}
                  <span aria-hidden="true"> · </span>
                  提交时间 <time dateTime={selectedCreatedAt} title={formatAbsolute(selectedCreatedAt)}>{formatRelativeOrAbsolute(selectedCreatedAt)}</time>
                </p>
              </div>
              {historicalMetadataNotice}
              <ReviewDetailSummary
                request={selected}
                moduleName={selected.module}
                moduleDescription={selectedModuleDescription}
                parameterDescription={selectedParameterDescription}
              />
              {canExpandSubmission ? (
                <Button
                  variant="outline"
                  type="button"
                  className="review-detail-hero__detail-action"
                  onClick={() => openSubmissionDetail(selected)}
                >
                  <FileText size={16} />
                  {otherRoundItems.length > 0 ? `查看本轮其他 ${otherRoundItems.length} 项` : "展开完整对比"}
                </Button>
              ) : null}
            </div>
            <section className="review-legacy-section review-inbox__comparison" aria-label="本条变更">
              <h3>前后对比</h3>
              {otherRoundItems.length > 0 ? <p>本轮共 {selectedDetailRound!.items.length} 项，本次仅审阅这一项。</p> : null}
              {selectedDetailItem ? <SubmissionHistoryDiffCard item={selectedDetailItem}
                compactIdentity={selectedDetailItem.name === selected.title}
                incompleteMetadata={!selectedRound} /> : null}
            </section>
            {selected.impact.length > 0 ? <section className="review-legacy-section" aria-label="影响范围">
              <ReviewImpactList items={selected.impact} />
            </section> : null}
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
            <details className="review-workflow-records">
              <summary>处理记录</summary>
              <VerticalTimeline items={selectedWorkflowItems} />
            </details>
            {reviewMode === "pending" && canActOnSelectedReview ? (
              <div className="action-panel review-detail-actions">
                <p className="review-action-description">{selected.status === "软件User合入" ? "确认后将本条修改记为已合入，并保存填写的合入链接。" : "通过本条当前检视，后续仍按项目审批流程处理。"}{otherRoundItems.length > 0 ? "本轮其他变更需分别审阅。" : ""}</p>
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
                      <span className="review-merge-link__hint">填写本次修改的 http 或 https 合入链接</span>
                    )}
                  </div>
                ) : null}
                <Button
                  type="button"
                  disabled={actionPending || (selected.status === "软件User合入" && !isValidMergeLink(mergeLink))}
                  onClick={() => openDecision("advance")}
                >
                  <CheckCircle2 size={17} />
                  {selected.status === "软件User合入" ? "确认合入" : "通过检视"}
                </Button>
                {canRejectSelectedReview ? (
                  <Button type="button" variant="destructive" disabled={actionPending} onClick={() => openDecision("reject")}>
                    <CircleOff size={17} />
                    打回修改
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ReviewProvenance key={selected.id} entries={[
              { label: "请求 ID", value: selected.id },
              { label: "参数 ID", value: selected.editSubjectKind !== "node-enablement" ? selected.parameterId : undefined },
              { label: "逻辑节点 ID", value: selected.logicalNodeId },
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
      {actionTarget && actionScopeKey === currentActionScopeKey ? (
        <RejectReviewDialog
          key={`${actionTarget.kind}:${actionTarget.kind === "change" ? actionTarget.request.id : actionTarget.review.id}`}
          open={rejectOpen}
          initialization={actionTarget.kind === "initialization"}
          targetTitle={actionTarget.kind === "change" ? actionTarget.request.title : `${actionTarget.draft.projectName} · 参数初始化`}
          pending={actionPending}
          error={actionError}
          onCancel={() => setRejectOpen(false)}
          onSubmit={rejectSelected}
        />
      ) : null}
      <ConfirmDialog
        open={advanceConfirmOpen && actionTarget !== null && actionScopeKey === currentActionScopeKey}
        title={actionTarget?.kind === "initialization" ? "确认通过初始化" : actionTarget?.kind === "change" && actionTarget.request.status === "软件User合入" ? "确认合入" : "确认通过检视"}
        description={actionTarget?.kind === "initialization"
          ? <p>将为 {actionTarget.draft.projectName} 建立 {actionTarget.draft.parameterSnapshots.length} 项初始化参数，并完成项目初始化。请确认参数和来源快照无误。</p>
          : <><p>仅处理“{actionTarget?.request.title}”这一条变更（{actionTarget?.kind === "change" ? formatWorkflowDisplayText(actionTarget.request.status) : ""}）。</p>
            {actionTarget?.kind === "change" && !shouldSummarizeReviewChange(actionTarget.request) ? <p><code>{actionTarget.request.currentValue}</code> → <code>{actionTarget.request.targetValue}</code></p> : null}
            <p>{actionTarget?.kind === "change" && actionTarget.request.status === "软件User合入" ? `将记为已合入，合入链接：${actionMergeLink}` : "通过当前检视后，请求交给下一阶段处理。"}</p></>}
        confirmLabel={actionTarget?.kind === "initialization" ? "确认通过" : actionTarget?.kind === "change" && actionTarget.request.status === "软件User合入" ? "确认合入" : "确认通过"}
        pending={actionPending} pendingLabel="处理中…" error={actionError}
        onCancel={() => setAdvanceConfirmOpen(false)} onConfirm={() => void advanceSelected()}
      />
      {detailOpenScope === reviewScope && selectedDetailRound ? (
        <ModalDialog
          open
          onDismiss={() => setDetailOpenScope(null)}
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
                  <h2 id={titleId}>{otherRoundItems.length > 0 ? "本轮变更" : "完整对比"}</h2>
                  <p>{selectedDetailRound.items.length} 项变更 · 提交人 {selectedDetailRound.submitter} · 提交时间 {formatRelativeOrAbsolute(selectedDetailRound.createdAt)}</p>
                  {historicalMetadataNotice}
                  {selectedRound && selectedDetailRound.summary !== selected?.title && shouldShowSubmissionRoundSummary(selectedDetailRound) ? <p>{selectedDetailRound.summary}</p> : null}
                </div>
              </div>
              <div className="submission-diff-list">
                {selectedDetailRound.items.map((item) => <SubmissionHistoryDiffCard item={item} incompleteMetadata={!selectedRound} key={item.requestId} />)}
              </div>
              <div className="dialog-actions">
                <button className="button subtle" type="button" onClick={() => setDetailOpenScope(null)}>关闭</button>
              </div>
            </>
          )}
        </ModalDialog>
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  open,
  initialization,
  targetTitle,
  pending,
  error,
  onCancel,
  onSubmit
}: {
  open: boolean;
  initialization: boolean;
  targetTitle: string;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const submitRejection = () => {
    if (trimmedReason) {
      void onSubmit(trimmedReason);
    }
  };

  return (
    <ConfirmDialog open={open} title={initialization ? "驳回初始化" : "打回修改"} className="rejection-dialog"
      description={<p>将“{targetTitle}”退回提交人，本次{initialization ? "初始化" : "变更"}不会继续应用。</p>}
      confirmLabel="提交打回" tone="danger" pending={pending} pendingLabel="提交中…"
      confirmDisabled={!trimmedReason} error={error} onConfirm={submitRejection} onCancel={onCancel}
      extra={<div className="review-rejection-field">
        <Label htmlFor="reject-reason">{initialization ? "驳回原因" : "打回原因"}</Label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          required
          disabled={pending}
          placeholder="说明需要补充的依据或调整方向"
        />
      </div>}
    />
  );
}
