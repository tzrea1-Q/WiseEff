import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { TopBarActionsContext } from "@/components/layout";
import type { AppRuntime } from "@/app/appRuntime";
import { initialState } from "@/mockData";
import { ParameterChangesPage } from "./ParameterChangesPage";

vi.mock("@/application/parameters/parameterFileRuntime", () => ({
  resolveParameterFileRepository: () => ({ listSourceRevisionRequests: async () => [] })
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("keeps an ordinary project member in their personal queue even when review is requested", async () => {
  const listSubmissionRounds = vi.fn().mockResolvedValue([]);
  const listChangeRequests = vi.fn().mockResolvedValue([]);
  const listProjectValueChangeRequests = vi.fn().mockResolvedValue({ items: [] });
  const runtime = { parameterRepository: { listSubmissionRounds, listChangeRequests }, parameterCatalogRepository: {
    listProjectValueChangeRequests, listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] })
  } } as unknown as AppRuntime;
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=review");
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={{ ...initialState, activeRoleId: "guest" }} dispatch={vi.fn()} onNavigate={vi.fn()}
      search="?project=aurora&scope=review" runtime={runtime} runtimeMode="api" sessionRoles={[]}
      projectMemberships={[{ projectId: "aurora", roles: ["hardware-user"] }]} />
  </TopBarActionsContext.Provider>);

  expect(await screen.findByText("暂无审核中的提交")).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "审阅队列" })).not.toBeInTheDocument();
  await waitFor(() => expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true }));
  expect(listProjectValueChangeRequests).toHaveBeenCalledWith("aurora", { mine: true });
  expect(listChangeRequests).not.toHaveBeenCalled();
});

it("defaults to the current project's review queue and discards late results after switching to mine", async () => {
  let resolveReview!: (value: typeof initialState.changeRequests) => void;
  const review = new Promise<typeof initialState.changeRequests>((resolve) => { resolveReview = resolve; });
  const listChangeRequests = vi.fn().mockReturnValue(review);
  const listSubmissionRounds = vi.fn().mockResolvedValue([]);
  const runtime = { parameterRepository: { listSubmissionRounds, listChangeRequests }, parameterCatalogRepository: {
    listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
    listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] })
  } } as unknown as AppRuntime;
  const initialSearch = "?project=aurora&view=history&legacyRequest=old-request";
  window.history.replaceState(null, "", `/parameter-changes${initialSearch}`);
  function Page() {
    const [search, setSearch] = useState(initialSearch);
    return <ParameterChangesPage state={{ ...initialState, activeRoleId: "software-committer" }} dispatch={vi.fn()}
      onNavigate={(url) => { window.history.pushState(null, "", url); setSearch(window.location.search); }} search={search}
      runtime={runtime} runtimeMode="api" sessionRoles={[{ projectId: "aurora", roleId: "software-committer" }]} />;
  }
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}><Page /></TopBarActionsContext.Provider>);
  expect(screen.getByRole("radio", { name: "审阅队列" })).toHaveAttribute("aria-checked", "true");
  await waitFor(() => expect(listChangeRequests).toHaveBeenCalledWith({ projectId: "aurora" }));
  fireEvent.click(screen.getByRole("radio", { name: "我的提交" }));
  expect(await screen.findByText("暂无已处理提交")).toBeInTheDocument();
  expect(window.location.search).toContain("scope=mine");
  expect(window.location.search).toContain("view=history");
  expect(window.location.search).not.toContain("legacyRequest");
  await act(async () => { resolveReview([{ ...initialState.changeRequests[0], id: "old-request", title: "旧审阅结果" }]); await review; });
  expect(screen.queryByText("旧审阅结果")).not.toBeInTheDocument();
  expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true });
});

it("prevents changing views while a withdrawal is in flight", async () => {
  let finish!: () => void;
  const withdrawal = new Promise<void>((resolve) => { finish = resolve; });
  const withdrawSubmissionRound = vi.fn().mockReturnValue(withdrawal);
  const round = { ...initialState.parameterSubmissionRounds[0], id: "withdraw-round", projectId: "aurora",
    summary: "待撤回提交", submitter: "Xu Yun", status: "硬件Committer检视" as const };
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=mine&legacyRequest=withdraw-round");
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={{ ...initialState, activeRoleId: "admin", currentUserId: "u-xu-yun", parameterSubmissionRounds: [round] }}
      dispatch={vi.fn()} onNavigate={vi.fn()} search={window.location.search} runtimeMode="mock"
      parameterActions={{ withdrawSubmissionRound } as never} />
  </TopBarActionsContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "撤回本轮提交" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "确认撤回本轮提交" })).getByRole("button", { name: "确认撤回" }));
  expect(withdrawSubmissionRound).toHaveBeenCalledWith("withdraw-round");
  expect(screen.getByRole("radio", { name: "审阅队列" })).toBeDisabled();
  await act(async () => { finish(); await withdrawal; });
  expect(screen.getByRole("radio", { name: "审阅队列" })).toBeEnabled();
});

it.each(["project", "identity", "view"])("stops the remaining batch after %s unmounts the old review view", async (change) => {
  const requests = ["batch-first", "batch-second"].map((id) => ({ ...initialState.changeRequests[0], id,
    projectId: "aurora", status: "硬件Committer检视" as const, submissionRoundId: undefined }));
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const reviewChange = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const renderPage = (changed: boolean) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={{ ...initialState, activeRoleId: "admin", currentUserId: changed && change === "identity" ? "u-wang-jie" : "u-xu-yun",
      changeRequests: requests, parameterSubmissionRounds: [], parameterInitializationReviews: [] }}
      dispatch={vi.fn()} onNavigate={vi.fn()} parameterActions={{ reviewChange } as never} runtimeMode="mock"
      search={`?project=${changed && change === "project" ? "nebula" : "aurora"}&scope=${changed && change === "view" ? "mine" : "review"}`} />
  </TopBarActionsContext.Provider>;
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=review");
  const { rerender } = render(renderPage(false));
  fireEvent.click(screen.getByRole("checkbox", { name: "全选可批量通过的变更" }));
  fireEvent.click(screen.getByRole("button", { name: "批量通过（2 项）" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "确认批量通过" })).getByRole("button", { name: "通过 2 项" }));
  expect(reviewChange).toHaveBeenCalledTimes(1);
  rerender(renderPage(true));
  await act(async () => { finish(); await pending; });
  expect(reviewChange).toHaveBeenCalledTimes(1);
});

it("does not turn the API membership-only submission exception into review authority", async () => {
  const listChangeRequests = vi.fn().mockResolvedValue([]);
  const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds: vi.fn().mockResolvedValue([]) },
    parameterCatalogRepository: { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  window.history.replaceState(null, "", "/parameter-changes?project=aurora");
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={{ ...initialState, activeRoleId: "guest" }} dispatch={vi.fn()} onNavigate={vi.fn()}
      search={window.location.search} runtime={runtime} runtimeMode="api" sessionRoles={[]}
      projectMemberships={[{ projectId: "aurora", roles: ["software-committer"] }]} />
  </TopBarActionsContext.Provider>);
  expect(await screen.findByText("暂无审核中的提交")).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "审阅队列" })).not.toBeInTheDocument();
  expect(listChangeRequests).not.toHaveBeenCalled();
});

it.each([
  ["hardware-committer", null, false], ["hardware-committer", "aurora", true],
  ["software-committer", null, false], ["software-committer", "aurora", true],
  ["software-user", null, false], ["software-user", "aurora", true],
  ["admin", null, true], ["admin", "nebula", true]
])("uses the project duty of API role %s at %s for review access", async (roleId, roleProject, allowed) => {
  const listChangeRequests = vi.fn().mockResolvedValue([]);
  const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds: vi.fn().mockResolvedValue([]) },
    parameterCatalogRepository: { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={{ ...initialState, activeRoleId: roleId }} dispatch={vi.fn()} onNavigate={vi.fn()}
      search="?project=aurora&scope=review" runtime={runtime} runtimeMode="api"
      sessionPermissions={["parameter:view", "parameter:review", "parameter:edit", ...(roleId === "admin" ? ["admin:access"] : [])]}
      sessionRoles={[{ projectId: roleProject, roleId }]} />
  </TopBarActionsContext.Provider>);
  if (allowed) await waitFor(() => expect(listChangeRequests).toHaveBeenCalledWith({ projectId: "aurora" }));
  else {
    await screen.findByText("暂无审核中的提交");
    expect(listChangeRequests).not.toHaveBeenCalled();
  }
  expect(screen.queryByRole("radio", { name: "审阅队列" }) !== null).toBe(allowed);
});

it.each(["role", "permission"])("drops the review queue immediately when current-project %s is revoked", async (revoked) => {
  let resolveReview!: (value: typeof initialState.changeRequests) => void;
  const review = new Promise<typeof initialState.changeRequests>((resolve) => { resolveReview = resolve; });
  const listChangeRequests = vi.fn().mockReturnValue(review);
  const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds: vi.fn().mockResolvedValue([]) },
    parameterCatalogRepository: { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  const state = { ...initialState, activeRoleId: "software-committer" as const };
  const renderPage = (authorized: boolean) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterChangesPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="?project=aurora&scope=review"
      runtime={runtime} runtimeMode="api" sessionPermissions={authorized || revoked === "role" ? ["parameter:view", "parameter:review"] : ["parameter:view"]}
      sessionRoles={authorized || revoked === "permission" ? [{ projectId: "aurora", roleId: "software-committer" }] : [
        { projectId: "nebula", roleId: "software-committer" }
      ]} projectMemberships={[{ projectId: "aurora", roles: ["hardware-user"] }]} />
  </TopBarActionsContext.Provider>;
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=review");
  const { rerender } = render(renderPage(true));
  await waitFor(() => expect(listChangeRequests).toHaveBeenCalledTimes(1));
  rerender(renderPage(false));
  expect(screen.queryByRole("radio", { name: "审阅队列" })).not.toBeInTheDocument();
  expect(await screen.findByText("暂无审核中的提交")).toBeInTheDocument();
  await act(async () => { resolveReview([{ ...initialState.changeRequests[0], title: "撤权前的审阅记录" }]); await review; });
  expect(screen.queryByText("撤权前的审阅记录")).not.toBeInTheDocument();
  expect(listChangeRequests).toHaveBeenCalledTimes(1);
});

it.each(["?project=missing", "?project=", "?projectId="])("reports invalid project context %s without querying another project", (search) => {
  const listChangeRequests = vi.fn();
  const listSubmissionRounds = vi.fn();
  const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds } } as unknown as AppRuntime;
  render(<ParameterChangesPage state={{ ...initialState, activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()}
    search={search} runtime={runtime} runtimeMode="api" sessionRoles={[{ projectId: null, roleId: "admin" }]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("项目链接无效");
  expect(listChangeRequests).not.toHaveBeenCalled();
  expect(listSubmissionRounds).not.toHaveBeenCalled();
});

it("keeps merge actions when a project user also holds a same-rank hardware role", async () => {
  const request = { ...initialState.changeRequests[0], id: "merge-request", projectId: "aurora",
    title: "待合入节点", status: "软件User合入" as const, editSubjectKind: "node-enablement" as const,
    logicalNodeId: "merge-node", assignedTo: initialState.currentUserId };
  const runtime = { parameterRepository: { listChangeRequests: vi.fn().mockResolvedValue([request]),
    listSubmissionRounds: vi.fn().mockResolvedValue([]) }, parameterCatalogRepository: {
    listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
    listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&legacyRequest=merge-request");
  render(<ParameterChangesPage state={{ ...initialState, activeRoleId: "hardware-user" }} dispatch={vi.fn()} onNavigate={vi.fn()}
    search={window.location.search} runtime={runtime} runtimeMode="api" sessionPermissions={["parameter:view", "parameter:edit"]}
    sessionRoles={[{ projectId: "aurora", roleId: "hardware-user" }, { projectId: "aurora", roleId: "software-user" }]} />);
  expect(await screen.findByLabelText("合入链接")).toBeInTheDocument();
});

it("keeps cached initialization and mock requests inside the current project", () => {
  const request = { ...initialState.changeRequests[0], id: "aurora-request", projectId: "aurora", title: "当前项目变更",
    status: "硬件Committer检视" as const, submissionRoundId: undefined };
  const draft = { id: "aurora-draft", projectId: "aurora", projectName: "Aurora", projectCode: "AUR",
    ownerUserId: null, sourceProjectIds: [], primarySourceProjectId: "", supplementSourceProjectIds: [], selectedModules: [],
    selectedRisks: [], selectedParameterIds: [], parameterSnapshots: [], notes: "", createdBy: null,
    createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" };
  const review = { id: "aurora-init", draftId: draft.id, projectId: "aurora", status: "pending" as const,
    submittedBy: null, submittedAt: draft.createdAt };
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=review");
  render(<ParameterChangesPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [request,
    { ...request, id: "other-request", projectId: "nebula", title: "其他项目变更" }], parameterSubmissionRounds: [],
    parameterInitializationDrafts: [draft, { ...draft, id: "nebula-draft", projectId: "nebula", projectName: "Nebula" }],
    parameterInitializationReviews: [review, { ...review, id: "nebula-init", draftId: "nebula-draft", projectId: "nebula" }] }}
    dispatch={vi.fn()} onNavigate={vi.fn()} search={window.location.search} runtimeMode="mock" />);
  const table = screen.getByRole("table", { name: "审阅队列" });
  expect(table).toHaveTextContent("当前项目变更");
  expect(table).toHaveTextContent("Aurora 初始化");
  expect(table).not.toHaveTextContent("其他项目变更");
  expect(table).not.toHaveTextContent("Nebula 初始化");
});

it("restores scope and status on browser navigation without retaining an old confirmation", async () => {
  const request = { ...initialState.changeRequests[0], id: "review-target", title: "待处理请求", submissionRoundId: undefined };
  window.history.replaceState(null, "", "/parameter-changes?project=aurora&scope=review&legacyRequest=review-target");
  function Page() {
    const [search, setSearch] = useState(window.location.search);
    useEffect(() => {
      const restore = () => setSearch(window.location.search);
      window.addEventListener("popstate", restore);
      return () => window.removeEventListener("popstate", restore);
    }, []);
    return <ParameterChangesPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [request],
      parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()} search={search} runtimeMode="mock"
      onNavigate={(url) => { window.history.pushState(null, "", url); setSearch(window.location.search); }} />;
  }
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}><Page /></TopBarActionsContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
  expect(screen.getByRole("dialog", { name: "打回修改" })).toBeInTheDocument();
  window.history.pushState(null, "", "/parameter-changes?project=aurora&scope=mine&view=history");
  fireEvent.popState(window);
  expect(screen.queryByRole("dialog", { name: "打回修改" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
  window.history.back();
  await waitFor(() => expect(screen.getByRole("radio", { name: "审阅队列" })).toHaveAttribute("aria-checked", "true"));
  expect(screen.queryByRole("dialog", { name: "打回修改" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "待处理请求" })).toBeInTheDocument();
});
