import { SubmissionWorkflowTimeline } from "@/components/SubmissionWorkflowTimeline";
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
import { StatusBadge, formatWorkflowDisplayText, getUserName } from "@/features/parameter-review/reviewUi";
import { SubmissionHistoryDiffCard } from "@/features/parameter-review/submissionHistoryDiff";
import { ReviewInbox, type ReviewInboxRow } from "./ReviewInbox";
import { ReviewProvenance } from "./ReviewProvenance";
import { presentError } from "@/infrastructure/http/presentError";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const canonicalRepository = runtime?.parameterCatalogRepository;
  const contextProjectId = new URLSearchParams(search).get("project") ?? "";
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
    return state.parameterSubmissionRounds.filter((round) => submitterAliases.has(round.submitter));
  }, [canonicalProjectId, currentUser, isApiMode, projectionMatchesScope, state.activeRoleId, state.parameterSubmissionRounds, submissionProjection.rounds]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [locationSearch, setLocationSearch] = useState(search);
  const [withdrawingRound, setWithdrawingRound] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const selectLegacyRound = useCallback((id: string | null) => {
    setSelectedRoundId(id ?? "");
    setWithdrawConfirmOpen(false);
  }, []);
  const selectedRound = myRounds.find((round) => round.id === selectedRoundId);
  const legacyRows: ReviewInboxRow[] = myRounds.map((round) => ({
    id: round.id,
    kind: "legacy",
    projectId: round.projectId,
    project: round.projectName,
    module: [...new Set(round.items.map((item) => item.module))].join("、"),
    title: round.summary || `${round.projectName} · ${round.items.length} 项变更`,
    submitter: round.submitter,
    createdAt: round.createdAt,
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
    <Button
      variant="outline"
      type="button"
      onClick={() => onNavigate(canonicalProjectId ? `/parameters?project=${encodeURIComponent(canonicalProjectId)}` : "/parameters")}
    >
      <ArrowRight size={16} />
      返回工作台
    </Button>,
    [canonicalProjectId, onNavigate]
  );

  const withdrawSelectedRound = async () => {
    if (!selectedRound || !canWithdrawSubmissionRound(selectedRound.status) || withdrawingRound) {
      return;
    }

    setWithdrawingRound(true);
    try {
      if (parameterActions) {
        const result = await parameterActions.withdrawSubmissionRound(selectedRound.id);
        if (result && "notification" in result && !result.alreadyNotified) {
          dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
        }
        if (!result || !("notification" in result)) setRefreshVersion((version) => version + 1);
        return;
      }

      dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: selectedRound.id });
    } finally {
      setWithdrawingRound(false);
      setWithdrawConfirmOpen(false);
    }
  };

  const renderLegacyDetail = (row: ReviewInboxRow) => {
    const round = myRounds.find((candidate) => candidate.id === row.id);
    if (!round) return null;
    const readonly = isApiMode && !round.items.some((item) => item.editSubjectKind === "node-enablement");
    const timelineView = deriveSubmissionTimeline(round);
    const requestIds = round.items.map((item) => item.requestId);
    const workflowStages = round.workflowTrail?.length ? round.workflowTrail : buildSubmissionWorkflowTrail({
      activeIndex: timelineView.activeIndex,
      workflowAssignees: round.workflowAssignees,
      requestIds,
      changeRequests: state.changeRequests.filter((request) => requestIds.includes(request.id)),
      reviewDecisions: state.parameterReviewDecisions.filter((decision) => requestIds.includes(decision.requestId)),
      resolveUserName: (userId) => getUserName(state.users, userId)
    });

    return (
      <section className="submission-round-detail" aria-label="提交轮次详情">
        <div className="detail-card">
          <div className="detail-heading">
            <div>
              <span className="eyebrow">旧版请求</span>
              <h2>{row.title}</h2>
            </div>
            <StatusBadge status={round.status} />
          </div>
          <p>
            本轮提交包含 {round.items.length} 项变更，由 {round.submitter} 在{" "}
            <time dateTime={round.createdAt} title={round.createdAt}>{formatSubmissionTimestamp(round.createdAt)}</time> 提交。
          </p>
          <p>提交人 {round.submitter} → {workflowStages.find((stage) => stage.state === "active")?.assigneeName || "流程已结束"}</p>
          <h3>变更摘要</h3>
          <p>{round.summary || row.title}</p>
        </div>
        <section aria-label="前后对比">
          <h3>前后对比</h3>
          <div className="submission-diff-list history-diff-list">
            {round.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
          </div>
        </section>
        <section aria-label="影响范围">
          <h3>影响范围</h3>
          <ul>{round.items.map((item) => <li key={item.requestId}>{round.projectName} · {item.module} · {item.name}</li>)}</ul>
        </section>
        <SubmissionWorkflowTimeline activeIndex={timelineView.activeIndex} workflowStages={workflowStages} />
        {readonly ? <p role="note">此记录来自旧版流程，仅作只读归档，不能撤回或继续处理。</p> : (
          <div className="action-panel">
            <Button type="button" variant="destructive"
              disabled={!canWithdrawSubmissionRound(round.status) || withdrawingRound}
              onClick={() => {
                setSelectedRoundId(round.id);
                setWithdrawConfirmOpen(true);
              }}>
              <RotateCcw size={16} />
              撤回本轮提交
            </Button>
          </div>
        )}
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
        {!readonly ? <ConfirmDialog
          open={withdrawConfirmOpen && selectedRoundId === round.id}
          title="确认撤回本轮提交"
          description={<p>撤回后本轮 {round.items.length} 项变更将退出评审流程，审阅人不再收到该轮请求；
            如需继续变更需要重新提交一轮。</p>}
          confirmLabel="确认撤回"
          tone="danger"
          pending={withdrawingRound}
          pendingLabel="撤回中…"
          onCancel={() => {
            if (withdrawingRound) return;
            setWithdrawConfirmOpen(false);
          }}
          onConfirm={() => void withdrawSelectedRound()}
        /> : null}
      </section>
    );
  };

  return (
    <div className="submission-history-page">
      {canonicalProject ? <ReviewInbox
        projectId={canonicalProject.id}
        repository={isApiMode ? canonicalRepository : undefined}
        state={state}
        search={inboxParams.toString() ? `?${inboxParams.toString()}` : ""}
        mineOnly
        canReview={false}
        legacyRows={legacyRows}
        renderLegacyDetail={renderLegacyDetail}
        onLegacySelect={selectLegacyRound}
        onRequestsChanged={() => setRefreshVersion((version) => version + 1)}
        loading={isApiMode && (!projectionMatchesScope || submissionProjection.status === "loading")}
        error={(projectionMatchesScope ? submissionProjection.error : null) || (isApiMode && !canonicalRepository ? "新版参数提交暂不可用，请稍后重试。" : null)}
      /> : <p role="alert">项目链接无效，未加载其他项目的提交。</p>}
    </div>
  );
}
