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
  it("lets keyboard users enter both frozen member comparisons without duplicate pre tab stops", async () => {
    const user = userEvent.setup();
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1"
      repository={repository()} detailOnly initialRequestId={pending.id} />);
    const before = await screen.findByRole("tabpanel", { name: "冻结成员变更前" });
    const after = screen.getByRole("tabpanel", { name: "冻结成员变更后" });
    expect(before).toHaveTextContent("removed.json");
    expect(after).not.toHaveTextContent("removed.json");
    expect(after).toHaveTextContent("survivor.json");
    expect(before.querySelector("pre")).not.toHaveAttribute("tabindex");
    expect(after.querySelector("pre")).not.toHaveAttribute("tabindex");
    screen.getByRole("button", { name: "刷新成员删除结果" }).focus();
    await user.tab();
    expect(before).toHaveFocus();
    await user.tab();
    expect(after).toHaveFocus();
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
    await userEvent.click(await screen.findByRole("button", { name: decision === "withdraw" ? "撤回成员删除" : "驳回成员删除" }));
    if (decision === "reject") {
      fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "保留此成员" } });
      fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    }
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    mounted.rerender(<StrictMode><CanonicalMemberRemovalReviewPanel key={nextRequest.id}
      projectId="project-1" repository={repo} currentUserId={currentUserId} canReview
      detailOnly initialRequestId={nextRequest.id} />
    </StrictMode>);
    await screen.findByRole("heading", { name: nextRequest.reason });
    const detailReads = vi.mocked(repo.getMemberRemovalRequest!).mock.calls.length;
    await act(async () => { completed = true; finishAction(); });
    expect(onRequestsChanged).not.toHaveBeenCalled();
    expect(onSelectRequest).not.toHaveBeenCalled();
    expect(repo.getMemberRemovalRequest).toHaveBeenCalledTimes(detailReads);
    expect(screen.getByRole("heading", { name: nextRequest.reason })).toBeInTheDocument();
  });

  it("does not replace selected detail with an unrelated request after an uncertain result", async () => {
    const repo = repository();
    const onRequestsChanged = vi.fn();
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: pending })
      .mockResolvedValue({ item: { ...pending, id: "other-request", reason: "不相关请求" } });
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new Error("connection interrupted"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer" canReview initialRequestId={pending.id} onRequestsChanged={onRequestsChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "批准成员删除" }));
    await screen.findByText(/结果未确认，刷新/);
    await waitFor(() => expect(repo.getMemberRemovalRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("article").querySelector("header")).toHaveTextContent("retire");
    expect(screen.queryByRole("button", { name: "批准成员删除" })).not.toBeInTheDocument();
    expect(onRequestsChanged).not.toHaveBeenCalled();
  });

  it("leads with people and complete frozen comparison before scope, actions and collapsed provenance", async () => {
    const repo = repository();
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer" canReview users={[{ id: "author", name: "提交者" }, { id: "reviewer", name: "审核者" }]} />);
    const detail = await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(detail.querySelector("header")).toHaveTextContent("提交者 → 审核者");
    const sections = within(detail).getAllByRole("heading", { level: 4 });
    expect(sections.slice(0, 3).map((heading) => heading.textContent)).toEqual(["变更摘要", "前后对比", "影响范围"]);
    expect(within(detail).getByLabelText("冻结成员变更前")).toHaveTextContent("removed.json");
    expect(within(detail).getByLabelText("冻结成员变更后")).not.toHaveTextContent("removed.json");
    expect(within(detail).getByLabelText("冻结成员变更后")).toHaveTextContent("survivor.json");
    expect(within(detail).getByLabelText("冻结成员变更前")).not.toHaveTextContent("checksum-removed");
    expect(within(detail).getByLabelText("冻结成员变更前")).not.toHaveTextContent(pending.fileVersionId);
    const footer = detail.querySelector("footer")!;
    expect(footer).toHaveClass("dialog-actions");
    const disclosure = detail.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(footer.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("requires a rejection reason and notifies only after the result proof is confirmed", async () => {
    const repo = repository();
    const onRequestsChanged = vi.fn();
    vi.mocked(repo.getMemberRemovalRequest!).mockResolvedValueOnce({ item: pending })
      .mockResolvedValue({ item: { ...pending, status: "rejected", reviewerNote: "保留此成员" } });
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview onRequestsChanged={onRequestsChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "驳回成员删除" }));
    const dialog = screen.getByRole("dialog", { name: "驳回成员删除" });
    const confirm = within(dialog).getByRole("button", { name: "确认驳回" });
    expect(confirm).toBeDisabled();
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "  保留此成员  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledWith(
      "project-1", pending.id, { decision: "reject", note: "保留此成员", memberProofDigest: digest }, expect.any(Object)));
    await waitFor(() => expect(onRequestsChanged).toHaveBeenCalledTimes(1));
  });

  it("embeds only selected detail and follows the coordinator's history view", async () => {
    const repo = repository();
    const mounted = render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      detailOnly externalView="pending" initialRequestId={pending.id} />);
    await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(screen.queryByRole("heading", { name: "JSON 成员删除审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel").map((panel) => panel.getAttribute("aria-label")))
      .toEqual(["冻结成员变更前", "冻结成员变更后"]);
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
    expect(within(detail).getByRole("list", { name: "冻结 Binding cohort" }).querySelectorAll("li")).toHaveLength(2);
    expect(detail).toHaveTextContent("survivor.json");
    fireEvent.click(within(detail).getByRole("button", { name: "批准成员删除" }));
    await waitFor(() => expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledWith(
      "project-1", pending.id, { decision: "approve", memberProofDigest: digest },
      expect.objectContaining({ catalogReleaseId: "release", idempotencyKey: expect.any(String) })
    ));
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已批准"));
    fireEvent.click(screen.getByText("溯源信息"));
    expect(await screen.findByText("tombstone")).toBeVisible();
    expect(repo.reviewMemberRemovalRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "批准成员删除" })).not.toBeInTheDocument();
  });

  it("allows only the assigned reviewer to reject and only the submitter to withdraw", async () => {
    const repo = repository();
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="other" canReview initialRequestId={pending.id} />);
    await screen.findByRole("article", { name: "JSON 成员删除请求详情" });
    expect(screen.queryByRole("button", { name: "批准成员删除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤回成员删除" })).not.toBeInTheDocument();
    expect(repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
  });

  it("blocks retry after 409 source drift and retains pending state until refresh", async () => {
    const repo = repository();
    vi.mocked(repo.reviewMemberRemovalRequest!).mockRejectedValue(new WiseEffApiError(
      "CONFLICT", "Source changed", {}, "trace-1"));
    render(<CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer" canReview initialRequestId={pending.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "批准成员删除" }));
    expect(await screen.findByText(/来源过期或请求冲突（409）/)).toBeVisible();
    expect(screen.getByRole("article", { name: "JSON 成员删除请求详情" })).toHaveTextContent("待审核");
    expect(screen.queryByRole("button", { name: "批准成员删除" })).not.toBeInTheDocument();
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
    expect(await screen.findByText(/证明摘要不完整/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "批准成员删除" })).not.toBeInTheDocument();
  });
});
