import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRuntime } from "@/app/appRuntime";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import { ParameterSubmissionsPage } from "./ParameterSubmissionsPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ParameterSubmissionsPage canonical and legacy tracking", () => {
  it.each((["已合入", "已打回", "已撤回", "已暂存"] as const).flatMap((status) => [
    { status, retainedTrail: true }, { status, retainedTrail: false }
  ]))("uses the real $status outcome without a current actor or withdrawal (retained trail: $retainedTrail)", async ({ status, retainedTrail }) => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "terminal-personal", submitter: "Xu Yun", status,
      workflowTrail: retainedTrail ? [{ key: "hardware_review" as const, stepIndex: 2, label: "硬件MDE检视", assigneeName: "旧指派人",
        executorName: "旧当前处理人", executorLabel: "当前处理" as const, state: "active" as const }] : undefined };
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, parameterSubmissionRounds: [round], parameterReviewDecisions: [], currentUserId: "u-xu-yun" }}
        dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora&view=history" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);
    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    expect(detail).toHaveTextContent(status);
    expect(detail.querySelector(".review-detail-hero__meta")).not.toHaveTextContent("旧指派人");
    expect(detail.querySelector(".review-detail-hero__meta")).not.toHaveTextContent("旧当前处理人");
    expect(within(detail).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
    expect(detail.querySelector(".action-panel")).not.toBeInTheDocument();
    await userEvent.click(within(detail).getByText("处理记录"));
    expect(detail.querySelector("[data-state='active']")).not.toBeInTheDocument();
    if (!retainedTrail) expect(detail.querySelector("[data-state='ended']")).not.toBeInTheDocument();
    expect(detail).not.toHaveTextContent("当前处理：旧当前处理人");
    expect(detail).toHaveTextContent("执行结果未记录");
  });

  it("reports a missing handler honestly while a round is still pending", () => {
    const round = { ...initialState.parameterSubmissionRounds[0], submitter: "Xu Yun", workflowTrail: [],
      workflowAssignees: undefined, status: "硬件Committer检视" as const };
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, changeRequests: [], parameterSubmissionRounds: [round], currentUserId: "u-xu-yun" }}
        dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);
    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    expect(detail.querySelector(".review-detail-hero__meta")).toHaveTextContent("指定处理人 未记录");
    expect(detail).not.toHaveTextContent("流程已结束");
    expect(within(detail).getByRole("button", { name: "撤回本轮提交" })).toBeEnabled();
  });

  it.each([
    { summary: "Parameter changes submitted.", title: "sc8562", placeholder: true, withdrawn: false },
    { summary: "  Parameter changes submitted.  ", title: "sc8562", placeholder: true, withdrawn: false },
    { summary: "保留客户工况下的节点设置", title: "保留客户工况下的节点设置", placeholder: false, withdrawn: false },
    { summary: "Parameter changes submitted. Keep the board stable.", title: "Parameter changes submitted. Keep the board stable.", placeholder: false, withdrawn: false },
    { summary: "Parameter changes submitted. 已由提交人撤回。", title: "sc8562", placeholder: true, withdrawn: true },
    { summary: "Parameter changes submitted. Keep the board stable. 已由提交人撤回。", title: "Parameter changes submitted. Keep the board stable. 已由提交人撤回。", placeholder: false, withdrawn: true }
  ])("shows one meaningful title and retains review controls for $summary", async ({ summary, title, placeholder, withdrawn }) => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "meaningful-node-round", submitter: "Xu Yun",
      summary, status: withdrawn ? "已撤回" as const : "硬件Committer检视" as const,
      workflowTrail: [{ key: "hardware_review" as const, stepIndex: 0, label: "硬件MDE检视", assigneeName: "Wang Jie",
        executorLabel: "当前处理" as const, state: withdrawn ? "skipped" as const : "active" as const }],
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: "meaningful-node-request",
        editSubjectKind: "node-enablement" as const, logicalNodeId: "logical-sc8562", name: "sc8562", module: "节点启用",
        currentValue: '"okay"', targetValue: '"disabled"' }] };
    const dispatch = vi.fn();
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", activeRoleId: "hardware-user", parameterSubmissionRounds: [round] }}
        dispatch={dispatch} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);
    if (withdrawn) await userEvent.click(screen.getByRole("tab", { name: "已结束" }));
    const queue = screen.getByRole("table", { name: "我的提交" });
    expect(within(queue).getByRole("button", { name: `查看 ${title} 提交详情` })).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    expect(within(detail).getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(within(detail).queryByRole("heading", { name: "变更摘要" })).not.toBeInTheDocument();
    expect(detail.querySelector(".review-detail-hero__meta")).toHaveTextContent("本轮提交包含 1 项变更");
    expect(detail.querySelector(".review-detail-hero__meta")).toHaveTextContent("提交人 Xu Yun");
    if (!withdrawn) expect(detail.querySelector(".review-detail-hero__meta")).toHaveTextContent("指定处理人 Wang Jie");
    expect(detail).toHaveTextContent('"okay"');
    expect(detail).toHaveTextContent('"disabled"');
    if (placeholder) expect(screen.queryByText(summary.trim(), { exact: true })).not.toBeInTheDocument();
    else expect(within(detail).getAllByText(summary)).toHaveLength(1);
    if (withdrawn) {
      expect(detail).toHaveTextContent("已撤回");
      expect(within(detail).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
      expect(detail.querySelector(".action-panel")).not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(within(detail).getByRole("button", { name: "撤回本轮提交" }));
    const confirmation = screen.getByRole("dialog", { name: "确认撤回本轮提交" });
    expect(confirmation).toHaveTextContent(title);
    if (placeholder) expect(confirmation).not.toHaveTextContent("Parameter changes submitted.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps mock personal withdrawals behind confirmation and omits other submitters", async () => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "mock-personal-round", submitter: "Xu Yun",
      summary: "本人待撤回提交", status: "硬件Committer检视" as const };
    const dispatch = vi.fn();
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", parameterSubmissionRounds: [round,
        { ...round, id: "other-personal-round", submitter: "Another user", summary: "他人提交" },
        { ...round, id: "another-project-round", projectId: "nebula", summary: "其他项目提交" }] }}
        dispatch={dispatch} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);

    expect(screen.queryByRole("button", { name: /他人提交/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /其他项目提交/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "我的提交" })).getByText("参数变更")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: "mock-personal-round" }));
  });

  it("tracks a node-enablement round as active work with its items and withdrawal action", async () => {
    const user = userEvent.setup();
    const nodeRound = { ...initialState.parameterSubmissionRounds[0], id: "node-round", status: "硬件Committer检视" as const,
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: "node-request",
        editSubjectKind: "node-enablement" as const, logicalNodeId: "node-charger", parameterId: "node-charger",
        name: "charger", module: "节点启用", currentValue: '"okay"', targetValue: '"disabled"' }] };
    let finishRefresh!: () => void;
    const refreshReady = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const listSubmissionRounds = vi.fn().mockResolvedValueOnce([nodeRound]).mockImplementationOnce(async () => {
      await refreshReady;
      return [{ ...nodeRound, status: "已撤回" }];
    });
    let finishWithdrawal!: () => void;
    const withdrawal = new Promise<void>((resolve) => { finishWithdrawal = resolve; });
    const withdrawSubmissionRound = vi.fn(() => withdrawal);
    const runtime = { parameterRepository: { listSubmissionRounds }, parameterCatalogRepository: {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] })
    } } as unknown as AppRuntime;
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={initialState} dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora"
        runtime={runtime} runtimeMode="api" parameterActions={{ withdrawSubmissionRound } as never} />
    </TopBarActionsContext.Provider>);
    const tracking = await screen.findByRole("region", { name: "提交轮次详情" });
    expect(tracking).toHaveTextContent("charger");
    expect(within(tracking).getByText("节点状态")).toBeInTheDocument();
    expect(tracking).toHaveTextContent("1 项");
    expect(tracking).toHaveTextContent("硬件MDE检视");
    expect(tracking).toHaveTextContent('"disabled"');
    expect(screen.queryByText("旧版提交归档")).not.toBeInTheDocument();
    await user.click(within(tracking).getByRole("button", { name: "撤回本轮提交" }));
    await user.click(await screen.findByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(withdrawSubmissionRound).toHaveBeenCalledWith("node-round"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(listSubmissionRounds).toHaveBeenCalledTimes(1);
    await act(async () => { finishWithdrawal(); await withdrawal; });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(listSubmissionRounds).toHaveBeenCalledTimes(2));
    expect(screen.getByText("正在加载我的提交…")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "已结束" }));
    expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
    await act(async () => { finishRefresh(); await refreshReady; });
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument());
  });

  it("trusts the server-filtered API personal legacy archive when the DTO omits submitter ID", async () => {
    const personalRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "legacy-personal-round",
      status: "硬件Committer检视" as const
    };
    const listSubmissionRounds = vi.fn().mockResolvedValue([personalRound]);
    const runtime = {
      parameterRepository: { listSubmissionRounds },
      parameterCatalogRepository: {
        listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] })
      }
    } as unknown as AppRuntime;

    render(
      <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
        <ParameterSubmissionsPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={() => {}}
          search="?project=aurora"
          runtime={runtime}
          runtimeMode="api"
        />
      </TopBarActionsContext.Provider>
    );

    expect(await screen.findByText("暂无审核中的提交")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "提交轮次详情" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "已结束" }));
    const archive = await screen.findByRole("region", { name: "提交轮次详情" });
    expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true });
    expect(within(archive).getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(within(archive).queryByText(/提交人 ID/)).not.toBeInTheDocument();
    expect(within(archive).getByRole("note")).toHaveTextContent("仅作只读归档");
    expect(within(archive).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
  });

  it("retains a failed withdrawal for retry instead of closing its confirmation", async () => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "retry-withdraw", submitter: "Xu Yun",
      summary: "待撤回提交", status: "硬件Committer检视" as const };
    const withdrawSubmissionRound = vi.fn().mockResolvedValueOnce({ notification: "网络失败，请重试" }).mockResolvedValueOnce(undefined);
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", parameterSubmissionRounds: [round] }}
        dispatch={vi.fn()} onNavigate={() => {}} search="?projectId=aurora" runtimeMode="mock"
        parameterActions={{ withdrawSubmissionRound } as never} />
    </TopBarActionsContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    const dialog = screen.getByRole("dialog", { name: "确认撤回本轮提交" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认撤回" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("网络失败，请重试");
    expect(screen.getByRole("dialog", { name: "确认撤回本轮提交" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认撤回本轮提交" })).not.toBeInTheDocument());
    expect(withdrawSubmissionRound).toHaveBeenCalledTimes(2);
  });

  it("hides a previous user's withdrawal confirmation immediately after identity changes", () => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "owner-withdraw", submitter: "Xu Yun",
      summary: "上一用户的提交", status: "硬件Committer检视" as const };
    const page = (userId: string) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: userId, parameterSubmissionRounds: [round] }}
        dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>;
    const { rerender } = render(page("u-xu-yun"));
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    expect(screen.getByRole("dialog", { name: "确认撤回本轮提交" })).toBeInTheDocument();
    rerender(page("u-other-owner"));
    expect(screen.queryByRole("dialog", { name: "确认撤回本轮提交" })).not.toBeInTheDocument();
  });
});
