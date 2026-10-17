import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import type { AppRuntime } from "@/app/appRuntime";
import { useLayoutEffect } from "react";
import { ParameterReviewPage } from "./ParameterReviewPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-review");
});

it("keeps an unsubmitted merge link through a same-request API refresh and clears it on a real selection change", async () => {
  const first = { ...initialState.changeRequests[0], id: "merge-refresh-first", title: "待合入节点一", projectId: "aurora",
    editSubjectKind: "node-enablement" as const, logicalNodeId: "merge-node-first", status: "软件User合入" as const };
  const second = { ...first, id: "merge-refresh-second", title: "待合入节点二", logicalNodeId: "merge-node-second" };
  const requests = [first, second];
  let finishRefresh!: (rows: typeof requests) => void;
  const refresh = new Promise<typeof requests>((resolve) => { finishRefresh = resolve; });
  const listChangeRequests = vi.fn().mockResolvedValueOnce(requests).mockReturnValueOnce(refresh);
  const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds: vi.fn().mockResolvedValue([]) },
    parameterCatalogRepository: { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()}
    runtime={runtime} runtimeMode="api" search="?project=aurora&legacyRequest=merge-refresh-first" />);
  fireEvent.change(await screen.findByLabelText("合入链接"), { target: { value: "https://example.com/merge/keep-this-draft" } });
  fireEvent.click(screen.getByRole("button", { name: "刷新队列" }));
  await waitFor(() => expect(listChangeRequests).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("合入链接")).not.toBeInTheDocument();
  await act(async () => { finishRefresh(requests); await refresh; });
  expect(await screen.findByLabelText("合入链接")).toHaveValue("https://example.com/merge/keep-this-draft");
  fireEvent.click(screen.getByRole("button", { name: "查看 待合入节点二 提交详情" }));
  expect(screen.getByLabelText("合入链接")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("合入链接"), { target: { value: "https://example.com/merge/second-draft" } });
  fireEvent.click(screen.getByRole("button", { name: "查看 待合入节点一 提交详情" }));
  expect(screen.getByLabelText("合入链接")).toHaveValue("");
});

it.each(["user", "project", "repository", "role", "runtime"])("clears drafts and open actions before effects when the %s scope changes with the same request ID", async (scope) => {
  const request = { ...initialState.changeRequests[0], id: "merge-scope-request", title: "有合入草稿的节点",
    editSubjectKind: "node-enablement" as const, logicalNodeId: "merge-scope-node", status: "软件User合入" as const,
    assignedTo: initialState.currentUserId };
  const runtime = { parameterRepository: {
    listChangeRequests: vi.fn().mockImplementation(async ({ projectId }: { projectId: string }) => [{ ...request, projectId }]),
    listSubmissionRounds: vi.fn().mockResolvedValue([])
  }, parameterCatalogRepository: { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
    listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }) } } as unknown as AppRuntime;
  const nextRuntime = { ...runtime, parameterRepository: { ...runtime.parameterRepository } } as AppRuntime;
  const beforeEffects: Array<{ draft: boolean; action: boolean; oldQueue: boolean }> = [];
  function ScopeProbe({ changed }: { changed: boolean }) {
    useLayoutEffect(() => {
      if (changed) beforeEffects.push({
        draft: Boolean(screen.queryByDisplayValue("https://example.com/merge/private-draft")),
        action: Boolean(screen.queryByRole("dialog", { name: "确认合入" })),
        oldQueue: Boolean(screen.queryByRole("button", { name: `查看 ${request.title} 提交详情` }))
      });
    }, [changed]);
    return null;
  }
  const page = (userId: string, projectId: string, changed = false) => <>
    <ParameterReviewPage
      state={{ ...initialState, activeRoleId: changed && scope === "role" ? "software-user" : "admin", currentUserId: userId,
        changeRequests: [{ ...request, projectId }], parameterSubmissionRounds: [], parameterInitializationReviews: [] }}
      dispatch={vi.fn()} onNavigate={vi.fn()} runtime={changed && scope === "repository" ? nextRuntime : runtime}
      runtimeMode={changed && scope === "runtime" ? "mock" : "api"}
      search={`?project=${projectId}&legacyRequest=${request.id}`} />
    <ScopeProbe changed={changed} />
  </>;
  const { rerender } = render(page(initialState.currentUserId, "aurora"));
  fireEvent.change(await screen.findByLabelText("合入链接"), { target: { value: "https://example.com/merge/private-draft" } });
  fireEvent.click(screen.getByRole("button", { name: "确认合入" }));
  expect(screen.getByRole("dialog", { name: "确认合入" })).toHaveTextContent("https://example.com/merge/private-draft");
  rerender(page(scope === "user" ? "u-wang-jie" : initialState.currentUserId, scope === "project" ? "nebula" : "aurora", true));
  expect(beforeEffects).toHaveLength(1);
  expect(beforeEffects[0]).toMatchObject({ draft: false, action: false });
  if (scope !== "runtime") expect(beforeEffects[0].oldQueue).toBe(false);
  expect(screen.queryByDisplayValue("https://example.com/merge/private-draft")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "确认合入" })).not.toBeInTheDocument();
  expect(await screen.findByLabelText("合入链接")).toHaveValue("");
});

it("offers one review context and one empty message rather than per-type queues", () => {
  render(<ParameterReviewPage state={{ ...initialState, changeRequests: [], parameterSubmissionRounds: [],
    parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" runtimeMode="mock" />);
  expect(screen.getAllByRole("tablist")).toHaveLength(1);
  expect(screen.getByRole("tab", { name: "待处理" })).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "变更类型" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看已处理记录" })).not.toBeInTheDocument();
  expect(screen.getAllByText("暂无待审核请求")).toHaveLength(1);
  expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
});

it("leads legacy details with the change and full comparison before collapsed provenance", async () => {
  const request = { ...initialState.changeRequests[0], id: "legacy-summary", title: "电池电压", status: "硬件Committer检视" as const,
    currentValue: "4500", targetValue: "4600", submissionRoundId: undefined };
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "hardware-committer", changeRequests: [request],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" runtimeMode="mock" />);
  const detail = screen.getByRole("complementary", { name: "审阅详情" });
  const comparison = within(detail).getByText("前后对比");
  const impact = within(detail).getByLabelText("影响范围");
  const provenance = within(detail).getByText("溯源信息").closest("details")!;
  expect(comparison.compareDocumentPosition(impact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(comparison.compareDocumentPosition(within(detail).getByLabelText("影响面")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(provenance).not.toHaveAttribute("open");
  fireEvent.click(within(provenance).getByText("溯源信息"));
  expect(await within(provenance).findByRole("button", { name: "复制完整技术数据" })).toBeInTheDocument();
});

it.each(["second", "missing"])("retains an open rejection and its original target when browser navigation selects %s", async (requestId) => {
  const first = { ...initialState.changeRequests[0], id: "first", title: "第一次修改", submissionRoundId: undefined };
  const second = { ...first, id: "second", title: "第二次修改" };
  window.history.replaceState(null, "", "/parameter-review?legacyRequest=first");
  const dispatch = vi.fn();
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [first, second],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={dispatch} onNavigate={vi.fn()}
    search="?legacyRequest=first" runtimeMode="mock" />);
  fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
  const dialog = screen.getByRole("dialog", { name: "打回修改" });
  fireEvent.change(within(dialog).getByLabelText("打回原因"), { target: { value: "第一项需要补充证据" } });
  window.history.pushState(null, "", `/parameter-review?legacyRequest=${requestId}`);
  fireEvent.popState(window);
  expect(screen.getByRole("dialog", { name: "打回修改" })).toHaveTextContent("第一次修改");
  expect(within(dialog).getByLabelText("打回原因")).toHaveValue("第一项需要补充证据");
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "REJECT_REVIEW" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "提交打回" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "REJECT_REVIEW", requestId: "first", reason: "第一项需要补充证据" }));
});

it("retains rejection input on failure and blocks duplicate requests while pending", async () => {
  const request = { ...initialState.changeRequests[0], id: "retry-reject", title: "待打回修改", submissionRoundId: undefined };
  let failReview!: (value: { notification: string }) => void;
  const reviewChange = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { failReview = resolve; })).mockResolvedValueOnce(undefined);
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [request],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()}
    parameterActions={{ reviewChange } as never} search="" runtimeMode="mock" />);
  fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
  const dialog = screen.getByRole("dialog", { name: "打回修改" });
  fireEvent.change(within(dialog).getByLabelText("打回原因"), { target: { value: "需要补充测试结果" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "提交打回" }));
  expect(within(dialog).getByRole("button", { name: "提交中…" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  expect(reviewChange).toHaveBeenCalledTimes(1);
  await act(async () => { failReview({ notification: "网络失败，请重试" }); });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("网络失败，请重试");
  expect(within(dialog).getByLabelText("打回原因")).toHaveValue("需要补充测试结果");
  fireEvent.click(within(dialog).getByRole("button", { name: "提交打回" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "打回修改" })).not.toBeInTheDocument());
  expect(reviewChange).toHaveBeenCalledTimes(2);
});

it("confirms the initialization scope and keeps a failed approval open for retry", async () => {
  const project = initialState.configDraft.projects[0];
  const draft = { id: "init-draft", projectId: project.id, projectName: project.name, projectCode: project.code,
    ownerUserId: null, sourceProjectIds: [], primarySourceProjectId: "", supplementSourceProjectIds: [], selectedModules: [],
    selectedRisks: [], selectedParameterIds: [], parameterSnapshots: [], notes: "", createdBy: null,
    createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" };
  const approve = vi.fn().mockRejectedValueOnce(new Error("服务暂不可用"))
    .mockResolvedValueOnce({ id: "init-review", projectId: project.id });
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [], parameterSubmissionRounds: [],
    parameterInitializationDrafts: [draft], parameterInitializationReviews: [{ id: "init-review", draftId: draft.id,
      projectId: project.id, status: "pending", submittedBy: null, submittedAt: draft.createdAt }] }}
    runtime={{ parameterInitializationRepository: { approve } } as never} runtimeMode="api"
    dispatch={vi.fn()} onNavigate={vi.fn()} search={`?project=${project.id}&legacyRequest=init-review`} />);
  fireEvent.click(screen.getByRole("button", { name: "通过初始化" }));
  expect(approve).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "确认通过初始化" });
  expect(dialog).toHaveTextContent(project.name);
  expect(dialog).toHaveTextContent("0 项初始化参数");
  fireEvent.click(within(dialog).getByRole("button", { name: "确认通过" }));
  await within(dialog).findByRole("alert");
  expect(screen.getByRole("dialog", { name: "确认通过初始化" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认通过" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认通过初始化" })).not.toBeInTheDocument());
  expect(approve).toHaveBeenCalledTimes(2);
});
