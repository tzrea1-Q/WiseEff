import { SubmissionWorkflowTimeline } from "@/components/SubmissionWorkflowTimeline";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { useTopBarActions } from "@/components/layout";
import { deriveSubmissionTimeline } from "@/parameterSubmissionTimeline";
import { type PageProps } from "@/app/routes";
import { activeRoleLabel } from "@/application/state/appState";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { canWithdrawSubmissionRound, formatSubmissionTimestamp, isActiveSubmissionRound } from "@/domain/parameters/submissionRound";
import type { ParameterSubmissionRound as LegacySubmissionRound } from "@/domain/parameters/types";
import { buildSubmissionWorkflowTrail } from "@/domain/parameters/submissionWorkflowTrail";
import { type User } from "@/domain/prototype/types";
import { StatusBadge, formatWorkflowDisplayText } from "@/features/parameter-review/reviewUi";
import { SubmissionHistoryDiffCard, shouldShowSubmissionRoundSummary } from "@/features/parameter-review/submissionHistoryDiff";
import { ReviewInbox, type ReviewInboxRow } from "./ReviewInbox";
import { ReviewProvenance } from "./ReviewProvenance";
import { presentError } from "@/infrastructure/http/presentError";
import { getContextQuery } from "@/workbenchUi";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./parameter-review.css";

type SubmissionProjectionState = {
  scopeKey: string;
  status: "idle" | "loading" | "ready" | "error";
  rounds: LegacySubmissionRound[];
  error: string | null;
};

function getUserDisplayAliases(user: User | undefined) {
  if (!user) {
    return [];
  }

  const aliases = [user.name];
  const [firstName, lastName] = user.name.split(/\s+/);
  if (firstName && lastName) {
    aliases.push(`${firstName[0]}. ${lastName}`);
  }
  return aliases;
}

export function ParameterSubmissionsPage({
  state,
  dispatch,
  onNavigate,
  parameterActions,
  search,
  runtime,
  runtimeMode
}: PageProps) {
  const isApiMode = runtimeMode === "api";
  const sourceRepository = useMemo(() => isApiMode ? resolveParameterFileRepository("api") : undefined, [isApiMode]);
  const canonicalRepository = runtime?.parameterCatalogRepository;
  const contextProjectId = getContextQuery(search).projectId;
  const canonicalProjectId = contextProjectId || state.activeProjectId;
  const canonicalProject = state.configDraft.projects.find((project) => project.id === canonicalProjectId);
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const projectionScopeKey = JSON.stringify([state.currentUserId, canonicalProjectId]);
  const [submissionProjection, setSubmissionProjection] = useState<SubmissionProjectionState>({ scopeKey: projectionScopeKey, status: "idle", rounds: [], error: null });
  const projectionMatchesScope = submissionProjection.scopeKey === projectionScopeKey;
  const [refreshVersion, setRefreshVersion] = useState(0);
  // API mode uses the server-side exact-owner archive projection below; the
  // reducer's legacy rounds never decide personal ownership by display name.
  const myRounds = useMemo(() => {
    if (isApiMode) return projectionMatchesScope
      ? submissionProjection.rounds.filter((round) => round.projectId === canonicalProjectId) : [];
    const submitterAliases = new Set(
      currentUser ? getUserDisplayAliases(currentUser) : [activeRoleLabel(state.activeRoleId), "平台用户"]
    );
    return state.parameterSubmissionRounds.filter((round) => round.projectId === canonicalProjectId && submitterAliases.has(round.submitter));
  }, [canonicalProjectId, currentUser, isApiMode, projectionMatchesScope, state.activeRoleId, state.parameterSubmissionRounds, submissionProjection.rounds]);
  const [withdrawTarget, setWithdrawTarget] = useState<LegacySubmissionRound | null>(null);
  const [locationSearch, setLocationSearch] = useState(search);
  const [withdrawingRound, setWithdrawingRound] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawScopeKey, setWithdrawScopeKey] = useState("");
  const selectedRound = withdrawTarget;
  const legacyRows: ReviewInboxRow[] = myRounds.map((round) => ({
    id: round.id,
    kind: "legacy",
    typeLabel: round.items.some((item) => item.editSubjectKind === "node-enablement") ? "节点状态" : isApiMode ? "历史参数" : "参数变更",
    projectId: round.projectId,
    project: round.projectName,
    module: [...new Set(round.items.map((item) => item.module))].join("、"),
    title: shouldShowSubmissionRoundSummary(round) ? round.summary
      : `${round.items[0]?.name || round.projectName}${round.items.length > 1 ? ` 等 ${round.items.length} 项变更` : ""}`,
    submitter: round.submitter,
    createdAt: round.createdAt,
    assignedTo: isActiveSubmissionRound(round.status) ? round.workflowTrail?.find((stage) => stage.state === "active")?.assigneeName : undefined,
    handledBy: (() => {
      const decision = state.parameterReviewDecisions.filter((item) => round.items.some((entry) => entry.requestId === item.requestId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return decision?.reviewerUserId ? state.users.find((user) => user.id === decision.reviewerUserId)?.name || "处理人姓名未记录" : undefined;
    })(),
    handledAt: state.parameterReviewDecisions.filter((decision) => round.items.some((item) => item.requestId === decision.requestId))
      .map((decision) => decision.createdAt).sort().at(-1),
    status: formatWorkflowDisplayText(round.status),
    view: isActiveSubmissionRound(round.status)
      && (!isApiMode || round.items.some((item) => item.editSubjectKind === "node-enablement")) ? "pending" : "history"
  }));
  const inboxParams = new URLSearchParams(locationSearch);
  const legacyRequestId = inboxParams.get("legacyRequest");
  const linkedRound = myRounds.find((round) => round.id === legacyRequestId
    || round.items.some((item) => item.requestId === legacyRequestId));
  if (linkedRound) inboxParams.set("legacyRequest", linkedRound.id);

  useEffect(() => {
    setLocationSearch(search);
  }, [search]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const requestId = params.get("legacyRequest");
      const round = myRounds.find((candidate) => candidate.items.some((item) => item.requestId === requestId));
      if (round && round.id !== requestId) {
        params.set("legacyRequest", round.id);
        window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      }
      setLocationSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, [myRounds]);

  useEffect(() => {
    if (!isApiMode) {
      setSubmissionProjection({ scopeKey: projectionScopeKey, status: "idle", rounds: [], error: null });
      return;
    }
    const parameterRepository = runtime?.parameterRepository;
    if (!parameterRepository) {
      setSubmissionProjection({ scopeKey: projectionScopeKey, status: "error", rounds: [], error: "提交记录接口未配置，暂时无法加载。" });
      return;
    }
    if (!canonicalProject) {
      setSubmissionProjection({ scopeKey: projectionScopeKey, status: "idle", rounds: [], error: null });
      return;
    }

    let cancelled = false;
    setSubmissionProjection((current) => ({ scopeKey: projectionScopeKey, status: "loading",
      rounds: current.scopeKey === projectionScopeKey ? current.rounds : [], error: null }));
    type SubmissionRoundListMethod = NonNullable<typeof parameterRepository>["listSubmissionRounds"];
    const listSubmissionRounds = parameterRepository.listSubmissionRounds as (
      query: Parameters<SubmissionRoundListMethod>[0] & { mine: true }
    ) => ReturnType<SubmissionRoundListMethod>;
    void listSubmissionRounds({ projectId: canonicalProject.id, mine: true })
      .then((rounds) => {
        if (cancelled) return;
        setSubmissionProjection({
          scopeKey: projectionScopeKey,
          status: "ready",
          // `mine=true` is a server-owned projection. Legacy round DTOs do not
          // expose submitter IDs, so the API client must trust this response.
          rounds,
          error: null
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setSubmissionProjection({ scopeKey: projectionScopeKey, status: "error", rounds: [], error: presentError(error, "提交记录加载失败，请稍后重试。") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalProject, isApiMode, projectionScopeKey, runtime?.parameterRepository, refreshVersion]);

  useTopBarActions(
    myRounds.length > 0 ? <Button
      variant="outline"
      type="button"
      onClick={() => onNavigate(canonicalProjectId ? `/parameters?project=${encodeURIComponent(canonicalProjectId)}` : "/parameters")}
    >
      <ArrowLeft size={16} />
      返回参数修改
    </Button> : null,
    [canonicalProjectId, onNavigate, myRounds.length]
  );

  const withdrawSelectedRound = async () => {
    if (!selectedRound || withdrawScopeKey !== projectionScopeKey || !canWithdrawSubmissionRound(selectedRound.status) || withdrawingRound) {
      return;
    }

    setWithdrawingRound(true);
    setWithdrawError("");
    try {
      if (parameterActions) {
        const result = await parameterActions.withdrawSubmissionRound(selectedRound.id);
        if (result && "notification" in result && !result.alreadyNotified) {
          dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
        }
        if (result && "notification" in result) {
          setWithdrawError(result.notification);
          return;
        }
        setRefreshVersion((version) => version + 1);
        setWithdrawConfirmOpen(false);
        return;
      }

      dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: selectedRound.id });
      setWithdrawConfirmOpen(false);
    } catch (error) {
      setWithdrawError(presentError(error, "撤回失败，请稍后重试。"));
    } finally {
      setWithdrawingRound(false);
    }
  };

  const renderLegacyDetail = (row: ReviewInboxRow) => {
    const round = myRounds.find((candidate) => candidate.id === row.id);
    if (!round) return null;
    const readonly = isApiMode && !round.items.some((item) => item.editSubjectKind === "node-enablement");
    const timelineView = deriveSubmissionTimeline(round);
    const requestIds = round.items.map((item) => item.requestId);
    const workflowStages = round.workflowTrail?.length ? round.workflowTrail : buildSubmissionWorkflowTrail({
      activeIndex: isActiveSubmissionRound(round.status) ? timelineView.activeIndex : -1,
      workflowAssignees: round.workflowAssignees,
      requestIds,
      changeRequests: state.changeRequests.filter((request) => requestIds.includes(request.id)),
      reviewDecisions: state.parameterReviewDecisions.filter((decision) => requestIds.includes(decision.requestId)),
      resolveUserName: (userId) => state.users.find((user) => user.id === userId)?.name || (userId ? "成员姓名暂不可用" : "未指派")
    });
    const activeStage = isActiveSubmissionRound(round.status) ? workflowStages.find((stage) => stage.state === "active") : undefined;
    const activeHandler = activeStage?.executorName || activeStage?.assigneeName;
    const singleItem = round.items.length === 1;

    return (
      <section className="submission-round-detail" aria-label="提交轮次详情">
        <div className="detail-card review-detail-hero">
          <div className="detail-heading review-detail-hero__header">
            <div>
              <h2>{row.title}</h2>
            </div>
            <StatusBadge status={round.status} />
          </div>
          <p className="review-detail-hero__meta">
            本轮提交包含 {round.items.length} 项变更
            <span aria-hidden="true"> · </span>
            提交人 {round.submitter}
            {isActiveSubmissionRound(round.status) ? <><span aria-hidden="true"> · </span>指定处理人 {activeHandler && activeHandler !== "未指派" ? activeHandler : "未记录"}</> : null}
            <span aria-hidden="true"> · </span>
            提交时间 <time dateTime={round.createdAt} title={round.createdAt}>{formatSubmissionTimestamp(round.createdAt)}</time>
          </p>
        </div>
        <section aria-label="前后对比">
          <h3>前后对比</h3>
          <div className="submission-diff-list history-diff-list">
            {round.items.map((item) => <SubmissionHistoryDiffCard item={item} compactIdentity={singleItem && row.title === item.name}
              showReason={item.reason.trim() !== row.title.trim()} key={item.requestId} />)}
          </div>
        </section>
        <SubmissionWorkflowTimeline status={round.status} workflowStages={workflowStages} />
        {readonly ? <p role="note">此记录来自旧版流程，仅作只读归档，不能撤回或继续处理。</p> : canWithdrawSubmissionRound(round.status) ? (
          <div className="action-panel review-detail-actions review-detail-actions--secondary">
            <Button type="button" variant="destructive"
              disabled={!canWithdrawSubmissionRound(round.status) || withdrawingRound}
              onClick={() => {
                setWithdrawTarget(round);
                setWithdrawScopeKey(projectionScopeKey);
                setWithdrawError("");
                setWithdrawConfirmOpen(true);
              }}>
              <RotateCcw size={16} />
              撤回本轮提交
            </Button>
          </div>
        ) : null}
        <ReviewProvenance key={round.id} entries={[
          { label: "轮次 ID", value: round.id },
          { label: "项目 ID", value: round.projectId },
          { label: "请求 ID", value: requestIds },
          { label: "参数 ID", value: round.items.filter((item) => item.editSubjectKind !== "node-enablement").map((item) => item.parameterId) },
          { label: "绑定 ID", value: round.items.map((item) => "projectParameterBindingId" in item ? item.projectParameterBindingId : undefined).filter(Boolean) },
          { label: "参数定义 ID", value: round.items.map((item) => "parameterSpecId" in item ? item.parameterSpecId : undefined).filter(Boolean) },
          { label: "逻辑节点 ID", value: round.items.map((item) => item.logicalNodeId).filter(Boolean) },
          { label: "提交时间", value: round.createdAt }
        ]} />
      </section>
    );
  };

  return (
    <div className="submission-history-page">
      {canonicalProject ? <ReviewInbox
        projectId={canonicalProject.id}
        repository={isApiMode ? canonicalRepository : undefined}
        sourceRepository={sourceRepository}
        state={state}
        search={inboxParams.toString() ? `?${inboxParams.toString()}` : ""}
        mineOnly
        canReview={false}
        busy={withdrawingRound}
        legacyRows={legacyRows}
        renderLegacyDetail={renderLegacyDetail}
        onRequestsChanged={() => setRefreshVersion((version) => version + 1)}
        onNavigate={onNavigate}
        loading={isApiMode && (!projectionMatchesScope || submissionProjection.status === "loading")}
        error={(projectionMatchesScope ? submissionProjection.error : null) || (isApiMode && !canonicalRepository ? "新版参数提交暂不可用，请稍后重试。" : null)}
      /> : <div className="review-state"><p role="alert">项目链接无效，未加载其他项目的提交。</p>
        <Button type="button" variant="outline" onClick={() => onNavigate("/parameter-submissions")}>返回我的提交</Button>
      </div>}
      <ConfirmDialog
        open={withdrawConfirmOpen && withdrawTarget !== null && withdrawScopeKey === projectionScopeKey}
        title="确认撤回本轮提交"
        description={<p>将撤回“{legacyRows.find((row) => row.id === withdrawTarget?.id)?.title || withdrawTarget?.items[0]?.name || withdrawTarget?.projectName}”中的 {withdrawTarget?.items.length} 项变更，该轮请求将退出评审流程；如需继续变更需要重新提交一轮。</p>}
        confirmLabel="确认撤回" tone="danger" pending={withdrawingRound} error={withdrawError} pendingLabel="撤回中…"
        onCancel={() => setWithdrawConfirmOpen(false)} onConfirm={() => void withdrawSelectedRound()}
      />
    </div>
  );
}
