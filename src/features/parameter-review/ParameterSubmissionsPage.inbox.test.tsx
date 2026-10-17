import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
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

describe("ParameterSubmissionsPage unified inbox", () => {
  it("hides the previous owner's cached rounds immediately and ignores their late response after an identity change", async () => {
    const previousRound = { ...initialState.parameterSubmissionRounds[0], id: "previous-owner-round",
      status: "硬件Committer检视" as const, summary: "上一用户的节点提交",
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], editSubjectKind: "node-enablement" as const }] };
    const nextRound = { ...previousRound, id: "next-owner-round", summary: "当前用户的节点提交" };
    let resolvePrevious!: (rounds: typeof previousRound[]) => void;
    let resolveNext!: (rounds: typeof previousRound[]) => void;
    const previousResponse = new Promise<typeof previousRound[]>((resolve) => { resolvePrevious = resolve; });
    const nextResponse = new Promise<typeof previousRound[]>((resolve) => { resolveNext = resolve; });
    const listSubmissionRounds = vi.fn().mockResolvedValueOnce([previousRound])
      .mockReturnValueOnce(previousResponse).mockReturnValueOnce(nextResponse);
    const runtime = { parameterRepository: { listSubmissionRounds }, parameterCatalogRepository: {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] })
    } } as unknown as AppRuntime;
    const refreshedRuntime = { ...runtime, parameterRepository: { ...runtime.parameterRepository } };
    const nextUserId = "u-next-owner";
    const previousOwnerVisibleBeforeEffects: boolean[] = [];
    function IdentityVisibilityProbe({ userId }: { userId: string }) {
      useLayoutEffect(() => {
        if (userId === nextUserId) previousOwnerVisibleBeforeEffects.push(Boolean(
          screen.queryByRole("button", { name: "查看 上一用户的节点提交 提交详情" })
          || screen.queryByRole("heading", { name: "上一用户的节点提交" })
        ));
      }, [userId]);
      return null;
    }
    const page = (userId: string, pageRuntime: AppRuntime) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: userId }} dispatch={vi.fn()}
        onNavigate={() => {}} search="?project=aurora" runtime={pageRuntime} runtimeMode="api" />
      <IdentityVisibilityProbe userId={userId} />
    </TopBarActionsContext.Provider>;
    const { rerender } = render(page(initialState.currentUserId, runtime));
    expect(await screen.findByRole("button", { name: "查看 上一用户的节点提交 提交详情" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "上一用户的节点提交" })).toBeInTheDocument();
    rerender(page(initialState.currentUserId, refreshedRuntime));
    await waitFor(() => expect(listSubmissionRounds).toHaveBeenCalledTimes(2));

    rerender(page(nextUserId, refreshedRuntime));
    expect(previousOwnerVisibleBeforeEffects).toEqual([false]);
    expect(screen.queryByRole("button", { name: "查看 上一用户的节点提交 提交详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "上一用户的节点提交" })).not.toBeInTheDocument();
    expect(listSubmissionRounds).toHaveBeenCalledTimes(3);
    expect(listSubmissionRounds).toHaveBeenLastCalledWith({ projectId: "aurora", mine: true });
    await act(async () => { resolveNext([nextRound]); });
    expect(await screen.findByRole("button", { name: "查看 当前用户的节点提交 提交详情" })).toBeInTheDocument();
    await act(async () => { resolvePrevious([previousRound]); });
    expect(screen.getByRole("button", { name: "查看 当前用户的节点提交 提交详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 上一用户的节点提交 提交详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "上一用户的节点提交" })).not.toBeInTheDocument();
  });

  it("keeps active node submissions and readonly personal archives in one pending/history queue", async () => {
    const archive = { ...initialState.parameterSubmissionRounds[0], id: "personal-archive", status: "已合入" as const,
      summary: "旧版参数归档", submitter: "同名用户", createdAt: "2026-10-09T00:00:00Z",
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], name: "归档参数" }] };
    const nodeRound = { ...archive, id: "active-node-round", status: "硬件Committer检视" as const, summary: "停用充电节点",
      items: [{ ...archive.items[0], requestId: "node-request", editSubjectKind: "node-enablement" as const,
        logicalNodeId: "node-charger", name: "charger", module: "节点启用", currentValue: '"okay"', targetValue: '"disabled"' }] };
    const listSubmissionRounds = vi.fn().mockResolvedValue([archive, nodeRound]);
    const listProjectValueChangeRequests = vi.fn().mockResolvedValue({ items: [{ id: "canonical-value", bindingId: "binding-1",
      reason: "本人软件配置", status: "pending", submitterUserId: initialState.currentUserId, createdAt: "2026-10-10T00:00:00Z" }] });
    const listMemberRemovalRequests = vi.fn().mockResolvedValue({ items: [{ id: "canonical-member", reason: "本人删除成员",
      status: "pending", submitterUserId: initialState.currentUserId, createdAt: "2026-10-10T01:00:00Z" }] });
    const runtime = { parameterRepository: { listSubmissionRounds }, parameterCatalogRepository: {
      listProjectValueChangeRequests,
      listMemberRemovalRequests,
      getMemberRemovalRequest: vi.fn()
    } } as unknown as AppRuntime;

    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={initialState} dispatch={vi.fn()} onNavigate={() => {}}
        search="?project=aurora" runtime={runtime} runtimeMode="api" />
    </TopBarActionsContext.Provider>);

    const pending = await screen.findByRole("tab", { name: "审核中" });
    const history = screen.getByRole("tab", { name: "已结束" });
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(await screen.findByRole("button", { name: /停用充电节点/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /停用充电节点/ }).closest("tr")).toHaveTextContent("硬件MDE检视");
    expect(screen.queryByRole("region", { name: "旧版提交归档" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "我的提交" })).toHaveLength(1);
    expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true });
    expect(listProjectValueChangeRequests).toHaveBeenCalledWith("aurora", { mine: true });
    expect(listMemberRemovalRequests).toHaveBeenCalledWith("aurora", { mine: true });
    expect(screen.getByRole("button", { name: "查看 本人软件配置 提交详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 本人删除成员 提交详情" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "我的提交" })).getAllByRole("row")).toHaveLength(4);

    await userEvent.click(history);
    fireEvent.click(await screen.findByRole("button", { name: /旧版参数归档/ }));
    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    expect(within(detail).getByText("归档参数")).toBeInTheDocument();
    expect(within(detail).getByRole("note")).toHaveTextContent("仅作只读归档");
    expect(within(detail).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
    await userEvent.click(pending);
    expect(await screen.findByRole("button", { name: /停用充电节点/ })).toBeInTheDocument();
  });

  it("shows the frozen change and affected items before collapsed copyable provenance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const round = { ...initialState.parameterSubmissionRounds[0], id: "frozen-personal-round", submitter: "Xu Yun",
      status: "硬件Committer检视" as const, summary: "更新冻结配置", createdAt: "2026-10-10T00:00:00Z",
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: "frozen-request", name: "冻结参数",
        projectParameterBindingId: "frozen-binding", parameterSpecId: "frozen-spec",
        currentValue: "unchanged start\nold frozen line\nunchanged end", targetValue: "unchanged start\nnew frozen line\nunchanged end" }] };
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", parameterSubmissionRounds: [round,
        { ...round, id: "second-round", summary: "另一轮冻结配置", createdAt: "2026-10-10T01:00:00Z",
          items: [{ ...round.items[0], requestId: "second-frozen-request" }] }] }}
        dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora" runtimeMode="mock" />
    </TopBarActionsContext.Provider>);

    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    const comparison = within(detail).getByRole("region", { name: "前后对比" });
    expect(comparison).toHaveTextContent("old frozen line");
    expect(comparison).toHaveTextContent("new frozen line");
    expect(comparison).toHaveTextContent("unchanged end");
    expect(within(detail).getByRole("region", { name: "影响范围" })).toHaveTextContent("冻结参数");
    const provenance = within(detail).getByText("溯源信息").closest("details")!;
    expect(provenance).not.toHaveAttribute("open");
    expect(comparison.compareDocumentPosition(provenance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(detail).queryByText("frozen-binding")).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByText("溯源信息"));
    expect(await within(detail).findByText("frozen-binding")).toBeVisible();
    fireEvent.click(within(provenance).getByRole("button", { name: "复制 请求 ID · 1" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("frozen-request"));
    fireEvent.click(screen.getByRole("button", { name: "查看 另一轮冻结配置 提交详情" }));
    expect(within(detail).getByText("溯源信息").closest("details")).not.toHaveAttribute("open");
  });

  it("restores contained-request and round bookmarks across browser history without selecting an unrelated round", async () => {
    const pending = { ...initialState.parameterSubmissionRounds[0], id: "pending-round", summary: "待处理节点",
      submitter: "Xu Yun", status: "硬件Committer检视" as const };
    const history = { ...pending, id: "history-round", summary: "已处理参数", status: "已合入" as const,
      items: [{ ...pending.items[0], requestId: "contained-history-request" }] };
    const search = "?project=aurora&legacyRequest=contained-history-request&type=legacy";
    window.history.replaceState(null, "", `/parameter-submissions${search}`);
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={{ ...initialState, currentUserId: "u-xu-yun", parameterSubmissionRounds: [pending, history] }}
        dispatch={vi.fn()} onNavigate={() => {}} search={search} runtimeMode="mock" />
    </TopBarActionsContext.Provider>);

    expect(await screen.findByRole("heading", { level: 2, name: "已处理参数" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toContain("legacyRequest=history-round");
    expect(window.location.search).toContain("view=history");

    window.history.pushState(null, "", "/parameter-submissions?project=aurora&legacyRequest=pending-round&view=pending&type=legacy");
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { level: 2, name: "待处理节点" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveAttribute("data-value", "legacy");
    window.history.pushState(null, "", `/parameter-submissions${search}&view=history`);
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { level: 2, name: "已处理参数" })).toBeInTheDocument();
    window.history.pushState(null, "", "/parameter-submissions?project=aurora&legacyRequest=history-round&type=legacy&view=history");
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { level: 2, name: "已处理参数" })).toBeInTheDocument();
    window.history.pushState(null, "", `/parameter-submissions${search}&view=history`);
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { level: 2, name: "已处理参数" })).toBeInTheDocument();
    window.history.pushState(null, "", "/parameter-submissions?project=aurora&legacyRequest=unknown-request");
    fireEvent.popState(window);
    expect(await screen.findByRole("alert")).toHaveTextContent("请求不存在");
    expect(screen.queryByRole("region", { name: "提交轮次详情" })).not.toBeInTheDocument();
  });

  it("shows one empty queue after the personal API projection settles", async () => {
    const runtime = { parameterRepository: { listSubmissionRounds: vi.fn().mockResolvedValue([]) }, parameterCatalogRepository: {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] })
    } } as unknown as AppRuntime;
    render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={initialState} dispatch={vi.fn()} onNavigate={() => {}}
        search="?project=aurora" runtime={runtime} runtimeMode="api" />
    </TopBarActionsContext.Provider>);

    expect(await screen.findByText("暂无审核中的提交")).toBeInTheDocument();
    expect(screen.getAllByText("暂无审核中的提交")).toHaveLength(1);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "提交轮次详情" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已处理提交" }));
    expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
  });
});
