import { SubmissionWorkflowTimeline } from "@/components/SubmissionWorkflowTimeline";
import { useTopBarActions } from "@/components/layout";
import { deriveSubmissionTimeline } from "@/parameterSubmissionTimeline";
import { type PageProps } from "@/app/routes";
import { activeRoleLabel } from "@/application/state/appState";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { canWithdrawSubmissionRound, formatSubmissionTimestamp, isActiveSubmissionRound } from "@/domain/parameters/submissionRound";
import { buildSubmissionWorkflowTrail } from "@/domain/parameters/submissionWorkflowTrail";
import { type User } from "@/domain/prototype/types";
import { MetricCard, StatusBadge, formatWorkflowDisplayText, getUserName } from "@/features/parameter-review/reviewUi";
import { SubmissionHistoryDiffCard } from "@/features/parameter-review/submissionHistoryDiff";
import { EmptyStateCard, PanelHeader } from "@/workbenchUi";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

export function ParameterSubmissionsPage({ state, dispatch, onNavigate, parameterActions }: PageProps) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const submitterAliases = new Set(
    currentUser ? getUserDisplayAliases(currentUser) : [activeRoleLabel(state.activeRoleId), "平台用户"]
  );
  const myRounds = state.parameterSubmissionRounds.filter((round) => submitterAliases.has(round.submitter));
  const [selectedRoundId, setSelectedRoundId] = useState(myRounds[0]?.id ?? "");
  const [withdrawingRound, setWithdrawingRound] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const selectedRound = myRounds.find((round) => round.id === selectedRoundId) ?? myRounds[0];
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
  const activeRoundCount = myRounds.filter((round) => isActiveSubmissionRound(round.status)).length;

  useEffect(() => {
    if (!myRounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(myRounds[0]?.id ?? "");
    }
  }, [myRounds, selectedRoundId]);
  useTopBarActions(
    <Button variant="outline" type="button" onClick={() => onNavigate("/parameters")}>
      <ArrowRight size={16} />
      返回工作台
    </Button>,
    [onNavigate]
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
          {myRounds.length === 0 ? <EmptyStateCard text="当前还没有你的历史提交。" /> : null}
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
                  className="full"
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
            <EmptyStateCard text="请选择一个提交轮次查看详情。" />
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
    </div>
  );
}
