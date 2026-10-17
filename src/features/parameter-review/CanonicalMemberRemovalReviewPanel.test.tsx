import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { CanonicalMemberRemovalReviewPanel } from "./CanonicalMemberRemovalReviewPanel";

const digest = "a".repeat(64);
const members = ["removed", "survivor"].map((fileId, sortOrder) => ({
  fileId, fileVersionId: `version-${fileId}`, sourceName: `${fileId}.json`, format: "json" as const,
  role: sortOrder ? "overlay" : "base", sortOrder, checksum: `checksum-${fileId}`, sizeBytes: 20
}));
const cohort = members.map((member, index) => ({
  bindingId: `binding-${index}`, oldValueId: `value-${index}`, sourcePinId: `pin-${index}`,
  sourceOccurrenceId: `occurrence-${index}`, definitionId: "definition", effectiveRevisionId: "revision",
  catalogReleaseId: "release", fileId: member.fileId, fileVersionId: member.fileVersionId,
  locator: { pointer: "/limit" }, valueDigest: `value-digest-${index}`
}));
const pending = {
  id: "request-1", projectId: "project-1", configSetId: "set-1", fileId: "removed",
  fileVersionId: "version-removed", proofDigest: digest,
  frozenProof: { kind: "canonical-member-removal" as const, organizationId: "org-1",
    projectId: "project-1", configSetId: "set-1", fileId: "removed", fileVersionId: "version-removed",
    configRevisionId: "config-revision", members, cohort, proofDigest: digest },
  status: "pending" as const, reason: "retire", submitterUserId: "author",
  assignedToUserId: "reviewer", reviewerUserId: null, reviewerNote: null,
  appliedSourceResult: null, createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z"
};

function repository() {
  return {
    listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [pending] }),
    getMemberRemovalRequest: vi.fn().mockResolvedValue({ item: pending }),
    reviewMemberRemovalRequest: vi.fn().mockResolvedValue({ item: pending }),
    withdrawMemberRemovalRequest: vi.fn().mockResolvedValue({ item: pending }),
    getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } })
  } as unknown as ParameterCatalogRepository;
}

describe("canonical JSON member removal review", () => {
  it("never unblocks an old member proof when selecting another request fails", async () => {
    const repo = repository();
    const other = { ...pending, id: "other-request", reason: "另一项申请" };
    vi.mocked(repo.listMemberRemovalRequests!).mockResolvedValue({ items: [pending, other] } as never);
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new WiseEffApiError("CONFLICT", "Source changed", {}, "trace"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} currentUserId="reviewer"
      canReview initialRequestId={pending.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "批准移除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).getByRole("button", { name: "批准移除" }));
    await screen.findByText(/来源过期或请求冲突（409）/);
    vi.mocked(repo.getMemberRemovalRequest!).mockRejectedValueOnce(new Error("detail unavailable"));
    const choices = within(screen.getByRole("table", { name: "成员删除请求列表" })).getAllByRole("button", { name: "removed.json" });
    fireEvent.click(choices[1]);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取成员删除证明失败。");
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(choices[0]);
    expect(await screen.findByRole("button", { name: "批准移除" })).toBeEnabled();
    expect(repo.getMemberRemovalRequest).toHaveBeenLastCalledWith("project-1", pending.id);
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(1);
  });

  it("retains a cancelled rejection across external refresh failure and the same request retry", async () => {
    const repo = repository();
    const panel = (refreshVersion: number) => <CanonicalMemberRemovalReviewPanel projectId="project-1"
      repository={repo} currentUserId="reviewer" canReview detailOnly initialRequestId={pending.id} refreshVersion={refreshVersion} />;
    const { rerender } = render(panel(0));
    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "请保留配置来源依据" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    vi.mocked(repo.getMemberRemovalRequest!).mockRejectedValueOnce(new Error("member read failed"));
    rerender(panel(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("加载成员删除请求失败，请刷新重试。");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(panel(2));
    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    expect(screen.getByLabelText("驳回原因")).toHaveValue("请保留配置来源依据");
    expect(repo.getMemberRemovalRequest).toHaveBeenLastCalledWith("project-1", pending.id);
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
  });

  it("clears an uncertain decision block only after an external refresh returns the exact valid proof", async () => {
    const repo = repository();
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new WiseEffApiError("CONFLICT", "Source changed", {}, "trace"));
    const panel = (refreshVersion: number) => <CanonicalMemberRemovalReviewPanel projectId="project-1"
      repository={repo} currentUserId="reviewer" canReview detailOnly initialRequestId={pending.id} refreshVersion={refreshVersion} />;
    const { rerender } = render(panel(0));
    fireEvent.click(await screen.findByRole("button", { name: "批准移除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).getByRole("button", { name: "批准移除" }));
    await screen.findByText(/来源过期或请求冲突（409）/);
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: { ...pending, id: "unrelated" } } as never);
    rerender(panel(1));
    await screen.findByText("请求详情与当前选择不一致，已阻止显示。");
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: { ...pending,
      frozenProof: { ...pending.frozenProof, proofDigest: "b".repeat(64) } } } as never);
    rerender(panel(2));
    await screen.findByText("成员快照或来源证明不完整，暂不能审核。");
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    rerender(panel(3));
    expect(await screen.findByRole("button", { name: "批准移除" })).toBeEnabled();
    expect(repo.getMemberRemovalRequest).toHaveBeenLastCalledWith("project-1", pending.id);
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(1);
  });

  it("requires withdrawal confirmation and leaves a reachable recovery after an unknown result", async () => {
    const repo = repository();
    vi.mocked(repo.withdrawMemberRemovalRequest!).mockRejectedValue(new Error("connection lost"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} detailOnly
      initialRequestId={pending.id} currentUserId="author" />);
    fireEvent.click(await screen.findByRole("button", { name: "撤回申请" }));
    expect(repo.withdrawMemberRemovalRequest).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认撤回移除申请" });
    expect(dialog).toHaveTextContent("removed.json");
    fireEvent.click(within(dialog).getByRole("button", { name: "撤回申请" }));
    const refresh = await screen.findByRole("button", { name: "重新核对状态" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤回申请" })).not.toBeInTheDocument();
    fireEvent.click(refresh);
    await screen.findByRole("button", { name: "撤回申请" });
    expect(repo.withdrawMemberRemovalRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps one complete semantic comparison without duplicate member lists or internal tab stops", async () => {
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1"
      repository={repository()} detailOnly initialRequestId={pending.id} />);
    const list = await screen.findByRole("list", { name: "冻结成员列表" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("removed.json · 基础文件 · 顺序 0 · 拟移除"),
      expect.stringContaining("survivor.json · 覆盖文件 · 顺序 1 · 保留")
    ]);
    expect(list.querySelector("[tabindex]")).toBeNull();
    expect(screen.getAllByRole("list", { name: "冻结成员列表" })).toHaveLength(1);
    expect(list.querySelector("pre")).toBeNull();
    expect(screen.getByText("处理记录", { exact: true }).closest("details")).not.toHaveAttribute("open");
  });

  it.each(["withdraw", "reject"] as const)("ignores an unmounted request's deferred %s completion after selecting another request", async (decision) => {
    let finishAction!: () => void;
    let completed = false;
    const action = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishAction = resolve; }));
    const onSelectRequest = vi.fn();
    const onRequestsChanged = vi.fn();
    const nextRequest = { ...pending, id: "next-request", reason: "另一项删除请求" };
    const repo = { ...repository(), reviewMemberRemovalRequest: action, withdrawMemberRemovalRequest: action,
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [pending, nextRequest] }),
      getMemberRemovalRequest: vi.fn().mockImplementation(async (_projectId: string, id: string) => ({
        item: id === nextRequest.id ? nextRequest : { ...pending,
          status: completed ? decision === "withdraw" ? "withdrawn" : "rejected" : "pending" }
      }))
    } as unknown as ParameterCatalogRepository;
    const currentUserId = decision === "withdraw" ? "author" : "reviewer";
    const mounted = render(<StrictMode><CanonicalMemberRemovalReviewPanel key={pending.id}
      projectId="project-1" repository={repo} currentUserId={currentUserId} canReview
      detailOnly initialRequestId={pending.id} onSelectRequest={onSelectRequest} onRequestsChanged={onRequestsChanged} />
    </StrictMode>);
    await userEvent.click(await screen.findByRole("button", { name: decision === "withdraw" ? "撤回申请" : "驳回" }));
    if (decision === "reject") {
      fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "保留此成员" } });
      fireEvent.click(screen.getByRole("button", { name: "驳回申请" }));
    } else fireEvent.click(within(screen.getByRole("dialog", { name: "确认撤回移除申请" })).getByRole("button", { name: "撤回申请" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    mounted.rerender(<StrictMode><CanonicalMemberRemovalReviewPanel key={nextRequest.id}
      projectId="project-1" repository={repo} currentUserId={currentUserId} canReview
      detailOnly initialRequestId={nextRequest.id} />
    </StrictMode>);
    await screen.findByText(nextRequest.reason);
    const detailReads = vi.mocked(repo.getMemberRemovalRequest!).mock.calls.length;
    await act(async () => { completed = true; finishAction(); });
    expect(onRequestsChanged).not.toHaveBeenCalled();
    expect(onSelectRequest).not.toHaveBeenCalled();
    expect(repo.getMemberRemovalRequest).toHaveBeenCalledTimes(detailReads);
    expect(screen.getByText(nextRequest.reason)).toBeInTheDocument();
  });

  it("does not replace selected detail with an unrelated request after an uncertain result", async () => {
    const repo = repository();
    const onRequestsChanged = vi.fn();
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: pending })
      .mockResolvedValue({ item: { ...pending, id: "other-request", reason: "不相关请求" } });
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new Error("connection interrupted"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer" canReview initialRequestId={pending.id} onRequestsChanged={onRequestsChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "批准移除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).getByRole("button", { name: "批准移除" }));
    await screen.findByText(/结果尚未确认/);
    await waitFor(() => expect(repo.getMemberRemovalRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("article").querySelector("header")).toHaveTextContent("retire");
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    expect(onRequestsChanged).not.toHaveBeenCalled();
  });

  it("leads with people and complete frozen comparison before scope, actions and collapsed provenance", async () => {
    const repo = repository();
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer" canReview users={[{ id: "author", name: "提交者" }, { id: "reviewer", name: "审核者" }]} />);
    const detail = await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(detail.querySelector("header")).toHaveTextContent("提交人提交者指定审核人审核者");
    const sections = within(detail).getAllByRole("heading", { level: 4 });
    expect(sections.slice(0, 3).map((heading) => heading.textContent)).toEqual(["变更摘要", "前后对比", "影响范围"]);
    const members = within(detail).getByRole("list", { name: "冻结成员列表" });
    expect(members).toHaveTextContent("removed.json");
    expect(members).toHaveTextContent("survivor.json");
    expect(members).toHaveTextContent("拟移除");
    expect(members).not.toHaveTextContent("checksum-removed");
    expect(members).not.toHaveTextContent(pending.fileVersionId);
    const actions = detail.querySelector(".review-inspector__actions")!;
    expect(actions).toContainElement(within(detail).getByRole("button", { name: "批准移除" }));
    const disclosure = detail.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(actions.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("requires a rejection reason and notifies only after the result proof is confirmed", async () => {
    const user = userEvent.setup();
    const repo = repository();
    const onRequestsChanged = vi.fn();
    let reviewed = false;
    const rejected = { ...pending, status: "rejected" as const, reviewerNote: "保留此成员" };
    vi.mocked(repo.getMemberRemovalRequest!).mockImplementation(async () => ({ item: reviewed ? rejected : pending }));
    vi.mocked(repo.reviewMemberRemovalRequest!).mockImplementation(async () => {
      reviewed = true;
      return { item: rejected };
    });
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview onRequestsChanged={onRequestsChanged} />);
    await user.click(await screen.findByRole("button", { name: "驳回" }));
    const dialog = await screen.findByRole("dialog", { name: "驳回「removed.json」的移除申请" });
    const confirm = within(dialog).getByRole("button", { name: "驳回申请" });
    expect(confirm).toBeDisabled();
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("驳回原因"), "  保留此成员  ");
    await user.click(confirm);
    await waitFor(() => expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledWith(
      "project-1", pending.id, { decision: "reject", note: "保留此成员", memberProofDigest: digest }, expect.any(Object)));
    await waitFor(() => expect(onRequestsChanged).toHaveBeenCalledTimes(1));
  });

  it("refreshes a failed rejection inside the dialog without losing the reason before retry", async () => {
    const repo = repository();
    let reviewed = false;
    const rejected = { ...pending, status: "rejected" as const, reviewerUserId: "reviewer", reviewerNote: "需要保留" };
    vi.mocked(repo.getMemberRemovalRequest!).mockImplementation(async () => ({ item: reviewed ? rejected : pending }));
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementationOnce(async () => { reviewed = true; return { item: rejected }; });
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview detailOnly initialRequestId={pending.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    const dialog = screen.getByRole("dialog", { name: "驳回「removed.json」的移除申请" });
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "需要保留" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "驳回申请" }));
    const refresh = await within(dialog).findByRole("button", { name: "刷新请求状态" });
    expect(within(dialog).getByRole("button", { name: "驳回申请" })).toBeDisabled();
    expect(within(dialog).getByLabelText("驳回原因")).toHaveValue("需要保留");
    fireEvent.click(refresh);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "驳回申请" })).toBeEnabled());
    expect(within(dialog).getByLabelText("驳回原因")).toHaveValue("需要保留");
    fireEvent.click(within(dialog).getByRole("button", { name: "驳回申请" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("article")).toHaveTextContent("已驳回");
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(2);
  });

  it("embeds only selected detail and follows the coordinator's history view", async () => {
    const repo = repository();
    const mounted = render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      detailOnly externalView="pending" initialRequestId={pending.id} />);
    await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(screen.queryByRole("heading", { name: "JSON 成员删除审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "冻结成员列表" })).toHaveTextContent("removed.json");
    const rejected = { ...pending, status: "rejected" as const };
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValue({ item: rejected });
    vi.mocked(repo.listMemberRemovalRequests!).mockResolvedValue({ items: [rejected] });
    mounted.rerender(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      detailOnly externalView="history" initialRequestId={pending.id} />);
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已驳回"));
    expect(repo.listMemberRemovalRequests).toHaveBeenLastCalledWith("project-1", { mine: false });
  });

  it("shows complete ordered members and cohort, then approves once with the original digest", async () => {
    const repo = repository();
    const approved = { ...pending, status: "approved" as const, reviewerUserId: "reviewer",
      appliedSourceResult: { tombstoneId: "tombstone", successorConfigRevisionId: "next-revision" } };
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: pending }).mockResolvedValue({ item: approved });
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview initialRequestId={pending.id} />);
    const detail = await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(within(detail).getByRole("list", { name: "冻结成员列表" }).querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(within(detail).getByText("查看全部 2 项关联参数"));
    expect(within(detail).getByRole("list", { name: "冻结关联参数" }).querySelectorAll("li")).toHaveLength(2);
    expect(detail).toHaveTextContent("survivor.json");
    fireEvent.click(within(detail).getByRole("button", { name: "批准移除" }));
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).toHaveTextContent("removed.json");
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).getByRole("button", { name: "批准移除" }));
    await waitFor(() => expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledWith(
      "project-1", pending.id, { decision: "approve", memberProofDigest: digest },
      expect.objectContaining({ catalogReleaseId: "release", idempotencyKey: expect.any(String) })
    ));
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已批准"));
    fireEvent.click(screen.getByText("溯源信息"));
    fireEvent.click(await screen.findByText("完整技术数据", { exact: true }));
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("tombstone");
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
  });

  it("allows only the assigned reviewer to reject and only the submitter to withdraw", async () => {
    const repo = repository();
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="other" canReview initialRequestId={pending.id} />);
    await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤回申请" })).not.toBeInTheDocument();
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
  });

  it("blocks retry after 409 source drift and retains pending state until refresh", async () => {
    const repo = repository();
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new WiseEffApiError(
      "CONFLICT", "Source changed", {}, "trace-1"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview initialRequestId={pending.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "批准移除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认从配置集移除文件" })).getByRole("button", { name: "批准移除" }));
    expect(await screen.findByText(/来源过期或请求冲突（409）/)).toBeVisible();
    expect(screen.getByRole("article", { name: "JSON 成员删除请求详情" })).toHaveTextContent("待审核");
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["incomplete cohort", { ...pending.frozenProof, cohort: cohort.slice(0, 1) }],
    ["reordered members", { ...pending.frozenProof, members: [...members].reverse() }],
    ["reordered cohort", { ...pending.frozenProof, cohort: [...cohort].reverse() }],
    ["wrong digest", { ...pending.frozenProof, proofDigest: "b".repeat(64) }]
  ])("refuses %s", async (_case, frozenProof) => {
    const repo = repository();
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValue({ item: {
      ...pending, frozenProof
    } } as never);
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview initialRequestId={pending.id} />);
    expect(await screen.findByText(/快照或来源证明不完整/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "批准移除" })).not.toBeInTheDocument();
  });
});
