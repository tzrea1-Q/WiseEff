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
import { MetricCard, StatusBadge, formatWorkflowDisplayText, getUserName } from "@/features/parameter-review/reviewUi";
import { SubmissionHistoryDiffCard } from "@/features/parameter-review/submissionHistoryDiff";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";
import { CanonicalMemberRemovalReviewPanel } from "./CanonicalMemberRemovalReviewPanel";
import { EmptyState, PanelHeader } from "@/workbenchUi";
import { presentError } from "@/infrastructure/http/presentError";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./parameter-review.css";

type LegacyArchiveState = {
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
  const canonicalRequestId = new URLSearchParams(search).get("request") ?? undefined;
  const memberRequestId = new URLSearchParams(search).get("memberRequest") ?? undefined;
  const canonicalProject = state.configDraft.projects.find((project) => project.id === canonicalProjectId);
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const submitterAliases = new Set(
    currentUser ? getUserDisplayAliases(currentUser) : [activeRoleLabel(state.activeRoleId), "平台用户"]
  );
  // API mode uses the server-side exact-owner archive projection below; the
  // reducer's legacy rounds never decide personal ownership by display name.
  const myRounds = runtimeMode === "api"
    ? []
    : state.parameterSubmissionRounds.filter((round) => submitterAliases.has(round.submitter));
  const [selectedRoundId, setSelectedRoundId] = useState(myRounds[0]?.id ?? "");
  const [legacyArchive, setLegacyArchive] = useState<LegacyArchiveState>({ status: "idle", rounds: [], error: null });
  const [selectedArchiveRoundId, setSelectedArchiveRoundId] = useState("");
  const [withdrawingRound, setWithdrawingRound] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const selectedRound = myRounds.find((round) => round.id === selectedRoundId) ?? myRounds[0];
  const selectedArchiveRound = legacyArchive.rounds.find((round) => round.id === selectedArchiveRoundId) ?? legacyArchive.rounds[0];
  const timelineView = deriveSubmissionTimeline(selectedRound ?? null);
  const workflowStages = useMemo(() => {
    if (!selectedRound) {
      return [];
    }

    if (selectedRound.workflowTrail?.length) {
      return selectedRound.workflowTrail;
    }

    const requestIds = selectedRound.items.map((item) => item.requestId);
    const roundChangeRequests = state.changeRequests.filter((request) => requestIds.includes(request.id));
    const roundDecisions = state.parameterReviewDecisions.filter((decision) => requestIds.includes(decision.requestId));

    return buildSubmissionWorkflowTrail({
      activeIndex: timelineView.activeIndex,
      workflowAssignees: selectedRound.workflowAssignees,
      requestIds,
      changeRequests: roundChangeRequests,
      reviewDecisions: roundDecisions,
      resolveUserName: (userId) => getUserName(state.users, userId)
    });
  }, [
    selectedRound,
    state.changeRequests,
    state.parameterReviewDecisions,
    state.users,
    timelineView.activeIndex
  ]);
  const archiveTimelineView = deriveSubmissionTimeline(selectedArchiveRound ?? null);
  const archiveWorkflowStages = useMemo(() => {
    if (!selectedArchiveRound) {
      return [];
    }

    if (selectedArchiveRound.workflowTrail?.length) {
      return selectedArchiveRound.workflowTrail;
    }

    const requestIds = selectedArchiveRound.items.map((item) => item.requestId);
    const roundChangeRequests = state.changeRequests.filter((request) => requestIds.includes(request.id));
    const roundDecisions = state.parameterReviewDecisions.filter((decision) => requestIds.includes(decision.requestId));

    return buildSubmissionWorkflowTrail({
      activeIndex: archiveTimelineView.activeIndex,
      workflowAssignees: selectedArchiveRound.workflowAssignees,
      requestIds,
      changeRequests: roundChangeRequests,
      reviewDecisions: roundDecisions,
      resolveUserName: (userId) => getUserName(state.users, userId)
    });
  }, [archiveTimelineView.activeIndex, selectedArchiveRound, state.changeRequests, state.parameterReviewDecisions, state.users]);
  const activeRoundCount = myRounds.filter((round) => isActiveSubmissionRound(round.status)).length;

  useEffect(() => {
    if (!myRounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(myRounds[0]?.id ?? "");
    }
  }, [myRounds, selectedRoundId]);

  useEffect(() => {
    if (!isApiMode) {
      setLegacyArchive({ status: "idle", rounds: [], error: null });
      return;
    }
    const parameterRepository = runtime?.parameterRepository;
    if (!parameterRepository) {
      setLegacyArchive({ status: "error", rounds: [], error: "旧版提交归档接口未配置，暂时无法加载。" });
      return;
    }
    if (!canonicalProject) {
      setLegacyArchive({ status: "idle", rounds: [], error: null });
      return;
    }

    let cancelled = false;
    setLegacyArchive({ status: "loading", rounds: [], error: null });
    type SubmissionRoundListMethod = NonNullable<typeof parameterRepository>["listSubmissionRounds"];
    const listSubmissionRounds = parameterRepository.listSubmissionRounds as (
      query: Parameters<SubmissionRoundListMethod>[0] & { mine: true }
    ) => ReturnType<SubmissionRoundListMethod>;
    void listSubmissionRounds({ projectId: canonicalProject.id, mine: true })
      .then((rounds) => {
        if (cancelled) return;
        setLegacyArchive({
          status: "ready",
          // `mine=true` is a server-owned projection. Legacy round DTOs do not
          // expose submitter IDs, so the API client must trust this response.
          rounds,
          error: null
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setLegacyArchive({ status: "error", rounds: [], error: presentError(error, "旧版提交归档加载失败，请稍后重试。") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalProject, isApiMode, runtime?.parameterRepository]);

  useEffect(() => {
    if (!legacyArchive.rounds.some((round) => round.id === selectedArchiveRoundId)) {
      setSelectedArchiveRoundId(legacyArchive.rounds[0]?.id ?? "");
    }
  }, [legacyArchive.rounds, selectedArchiveRoundId]);

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

  const selectCanonicalRequest = (requestId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (canonicalProjectId) {
      params.set("project", canonicalProjectId);
    }
    params.delete("legacyRequest");
    if (requestId) {
      params.set("request", requestId);
    } else {
      params.delete("request");
    }
    const query = params.toString();
    window.history.replaceState(null, "", `/parameter-submissions${query ? `?${query}` : ""}`);
  };

  const selectMemberRequest = (requestId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (canonicalProjectId) params.set("project", canonicalProjectId);
    params.set("memberRequest", requestId);
    window.history.replaceState(null, "", `/parameter-submissions?${params.toString()}`);
  };

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
        return;
      }

      dispatch({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: selectedRound.id });
    } finally {
      setWithdrawingRound(false);
      setWithdrawConfirmOpen(false);
    }
  };

  return (
    <div className="submission-history-page">
      {isApiMode ? (
        <>
          {canonicalRepository ? (
            <div className="canonical-submission-tracking">
              {canonicalProject ? (
                <><CanonicalProjectValueReviewPanel
                  projectId={canonicalProject.id}
                  repository={canonicalRepository}
                  currentUserId={state.currentUserId}
                  canReview={false}
                  initialRequestId={canonicalRequestId}
                  onSelectRequest={selectCanonicalRequest}
                  mineOnly
                />
                <CanonicalMemberRemovalReviewPanel
                  projectId={canonicalProject.id}
                  repository={canonicalRepository}
                  currentUserId={state.currentUserId}
                  canReview={false}
                  mineOnly
                  initialRequestId={memberRequestId}
                  onSelectRequest={selectMemberRequest}
                /></>
              ) : (
                <p role="alert">项目链接无效，未加载其他项目的提交。</p>
              )}
            </div>
          ) : (
            <p role="alert">新版参数提交暂不可用，请稍后重试。</p>
          )}
          {canonicalProject ? (
            <section className="submission-history-archive" aria-label="旧版提交归档">
              <header>
                <h2>旧版提交归档</h2>
                <p>旧版记录仅供本人只读查看，不会进入新版请求或提供撤回操作。</p>
              </header>
              {legacyArchive.status === "loading" ? <p role="status">正在加载旧版提交归档…</p> : null}
              {legacyArchive.error ? <p role="alert">{legacyArchive.error}</p> : null}
              {legacyArchive.status === "ready" && legacyArchive.rounds.length === 0 ? (
                <p role="note">旧版提交记录已离线归档，当前项目没有可展示的旧版本人记录。</p>
              ) : null}
              {legacyArchive.rounds.length > 0 ? (
                <div className="submission-history-layout">
                  <aside className="history-panel" aria-label="旧版提交记录">
                    <PanelHeader title="旧版提交记录" meta={`${legacyArchive.rounds.length} 轮`} />
                    {legacyArchive.rounds.map((round) => (
                      <Button
                        aria-pressed={round.id === selectedArchiveRound?.id}
                        className={round.id === selectedArchiveRound?.id ? "history-item active" : "history-item"}
                        key={round.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedArchiveRoundId(round.id)}
                      >
                        <strong>{round.projectName}</strong>
                        <span>
                          {formatWorkflowDisplayText(round.status)} · {round.items.length} 项 · {formatSubmissionTimestamp(round.createdAt)}
                        </span>
                      </Button>
                    ))}
                  </aside>
                  <section className="submission-round-detail" aria-label="旧版提交归档详情">
                    {selectedArchiveRound ? (
                      <>
                        <div className="detail-card">
                          <div className="detail-heading">
                            <div>
                              <span className="eyebrow">旧版提交归档</span>
                              <h3>{selectedArchiveRound.projectName}</h3>
                            </div>
                            <StatusBadge status={selectedArchiveRound.status} />
                          </div>
                          <p>
                            本轮提交包含 {selectedArchiveRound.items.length} 个参数，由 {selectedArchiveRound.submitter} 在{" "}
                            {formatSubmissionTimestamp(selectedArchiveRound.createdAt)} 提交。
                          </p>
                          <SubmissionWorkflowTimeline
                            activeIndex={archiveTimelineView.activeIndex}
                            workflowStages={archiveWorkflowStages}
                          />
                        </div>
                        <div className="submission-diff-list history-diff-list">
                          {selectedArchiveRound.items.map((item) => (
                            <SubmissionHistoryDiffCard item={item} key={item.requestId} />
                          ))}
                        </div>
                        <p role="note">此记录来自旧版流程，仅作只读归档，不能撤回或继续处理。</p>
                      </>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <>
        <section className="comparison-summary submission-history-summary">
          <MetricCard title="我的提交轮次" value={`${myRounds.length}`} trend="按轮次归档" tone="blue" />
          <MetricCard title="进行中轮次" value={`${activeRoundCount}`} trend="可撤回或等待审阅" tone="teal" />
          <MetricCard title="参数项总数" value={`${myRounds.reduce((total, round) => total + round.items.length, 0)}`} trend="包含单参数和多参数提交" tone="purple" />
        </section>
      <section className="submission-history-layout">
        <aside className="history-panel" aria-label="我的提交轮次">
          <PanelHeader title="提交轮次" meta={`${myRounds.length} 轮`} />
          {myRounds.map((round) => (
            <Button
              aria-pressed={round.id === selectedRound?.id}
              className={round.id === selectedRound?.id ? "history-item active" : "history-item"}
              key={round.id}
              type="button"
              variant="ghost"
              onClick={() => setSelectedRoundId(round.id)}
            >
              <strong>{round.projectName}</strong>
              <span>
                {formatWorkflowDisplayText(round.status)} · {round.items.length} 项 · {formatSubmissionTimestamp(round.createdAt)}
              </span>
            </Button>
          ))}
          {myRounds.length === 0 ? <EmptyState text="当前还没有你的历史提交。" /> : null}
        </aside>
        <section className="submission-round-detail" aria-label="提交轮次详情">
          {selectedRound ? (
            <>
              <div className="detail-card">
                <div className="detail-heading">
                  <div>
                    <span className="eyebrow">提交轮次</span>
                    <h2>{selectedRound.projectName}</h2>
                  </div>
                  <StatusBadge status={selectedRound.status} />
                </div>
                <p>
                  本轮提交包含 {selectedRound.items.length} 个参数，由 {selectedRound.submitter} 在{" "}
                  {formatSubmissionTimestamp(selectedRound.createdAt)} 提交。
                </p>
                <SubmissionWorkflowTimeline activeIndex={timelineView.activeIndex} workflowStages={workflowStages} />
              </div>
              <div className="submission-diff-list history-diff-list">
                {selectedRound.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
              </div>
              <div className="action-panel">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!canWithdrawSubmissionRound(selectedRound.status) || withdrawingRound}
                  onClick={() => setWithdrawConfirmOpen(true)}
                >
                  <RotateCcw size={16} />
                  撤回本轮提交
                </Button>
              </div>
            </>
          ) : (
            <EmptyState text="请选择一个提交轮次查看详情。" />
          )}
        </section>
      </section>
      <ConfirmDialog
        open={withdrawConfirmOpen && Boolean(selectedRound)}
        title="确认撤回本轮提交"
        description={
          selectedRound ? (
            <p>
              撤回后本轮 {selectedRound.items.length} 项变更将退出评审流程，审阅人不再收到该轮请求；
              如需继续变更需要重新提交一轮。
            </p>
          ) : null
        }
        confirmLabel="确认撤回"
        tone="danger"
        pending={withdrawingRound}
        pendingLabel="撤回中…"
        onCancel={() => {
          if (withdrawingRound) return;
          setWithdrawConfirmOpen(false);
        }}
        onConfirm={() => void withdrawSelectedRound()}
      />
        </>
      )}
    </div>
  );
}
