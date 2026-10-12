import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("keeps mock personal withdrawals behind confirmation and omits other submitters", async () => {
    const round = { ...initialState.parameterSubmissionRounds[0], id: "mock-personal-round", submitter: "Xu Yun",
      summary: "本人待撤回提交", status: "硬件Committer检视" as const };
    const dispatch = vi.fn();
    render(<TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", parameterSubmissionRounds: [round,
        { ...round, id: "other-personal-round", submitter: "Another user", summary: "他人提交" }] }}
        dispatch={dispatch} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);

    expect(screen.queryByRole("button", { name: /他人提交/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "WITHDRAW_PARAMETER_SUBMISSION_ROUND", roundId: "mock-personal-round" }));
  });

  it("tracks a node-enablement round as active work with its items and withdrawal action", async () => {
    const nodeRound = { ...initialState.parameterSubmissionRounds[0], id: "node-round", status: "硬件Committer检视" as const,
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: "node-request",
        editSubjectKind: "node-enablement" as const, logicalNodeId: "node-charger", parameterId: "node-charger",
        name: "charger", module: "节点启用", currentValue: '"okay"', targetValue: '"disabled"' }] };
    const listSubmissionRounds = vi.fn().mockResolvedValue([nodeRound]);
    const withdrawSubmissionRound = vi.fn().mockImplementation(async () => {
      listSubmissionRounds.mockResolvedValue([{ ...nodeRound, status: "已撤回" }]);
    });
    const runtime = { parameterRepository: { listSubmissionRounds }, parameterCatalogRepository: {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] })
    } } as unknown as AppRuntime;
    render(<TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterSubmissionsPage state={initialState} dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora"
        runtime={runtime} runtimeMode="api" parameterActions={{ withdrawSubmissionRound } as never} />
    </TopBarActionsContext.Provider>);
    const tracking = await screen.findByRole("region", { name: "提交轮次详情" });
    expect(tracking).toHaveTextContent("charger");
    expect(tracking).toHaveTextContent("1 项");
    expect(tracking).toHaveTextContent("硬件MDE检视");
    expect(tracking).toHaveTextContent('"disabled"');
    expect(screen.queryByText("旧版提交归档")).not.toBeInTheDocument();
    fireEvent.click(within(tracking).getByRole("button", { name: "撤回本轮提交" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(withdrawSubmissionRound).toHaveBeenCalledWith("node-round"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listSubmissionRounds).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("tab", { name: "已处理" }));
    expect(await screen.findByRole("button", { name: "撤回本轮提交" })).toBeDisabled();
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
      <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
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

    expect(await screen.findByText("暂无待审核请求")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "提交轮次详情" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "已处理" }));
    const archive = await screen.findByRole("region", { name: "提交轮次详情" });
    expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true });
    expect(within(archive).getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(within(archive).queryByText(/提交人 ID/)).not.toBeInTheDocument();
    expect(within(archive).getByRole("note")).toHaveTextContent("仅作只读归档");
    expect(within(archive).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
  });
});
