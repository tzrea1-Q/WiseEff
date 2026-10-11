import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";

const request = {
  id: "request-json-1",
  projectId: "project-1",
  draftId: "draft-json-1",
  bindingId: "binding-json-1",
  definitionId: "definition-1",
  effectiveRevisionId: "revision-1",
  status: "pending" as const,
  targetValue: '{"kind":"cells","values":[1,2]}',
  sourceFormat: "json" as const,
  action: "set" as const,
  sourceTarget: { format: "json" as const, sourceText: '{"kind":"cells","values":[1,2]}\n' },
  baseRevisionId: "base-revision-1",
  baseCurrentValueId: "value-old",
  reason: "校准充电策略",
  submitterUserId: "user-1",
  assignedToUserId: null,
  reviewerUserId: null,
  reviewerNote: null,
  appliedValueId: null,
  applyOutcome: null,
  sourcePinId: "source-pin-1",
  candidateId: "candidate-1",
  appliedSourceResult: null,
  createdAt: "2026-09-17T01:02:03.000Z",
  updatedAt: "2026-09-17T01:02:03.000Z"
};

describe("CanonicalProjectValueReviewPanel", () => {
  it.each(["withdraw", "approve"] as const)("ignores an unmounted request's deferred %s completion after selecting another request", async (decision) => {
    let finishAction!: (value: unknown) => void;
    const action = vi.fn().mockImplementation(() => new Promise((resolve) => { finishAction = resolve; }));
    const onSelectRequest = vi.fn();
    const onRequestsChanged = vi.fn();
    const nextRequest = { ...request, id: "next-request", reason: "另一项请求" };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request, nextRequest] }),
      reviewProjectValueChangeRequest: action,
      withdrawProjectValueChangeRequest: action,
      getProjectValueChangeSourceDiff: vi.fn().mockImplementation(async (_projectId: string, requestId: string) => ({
        item: { requestId, format: "json", sourceName: "config.json", bindings: [], before: "before", after: "after" }
      })),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;
    const currentUserId = decision === "withdraw" ? "user-1" : "reviewer-1";
    const mounted = render(<StrictMode><CanonicalProjectValueReviewPanel key={request.id}
      projectId="project-1" repository={repository} currentUserId={currentUserId}
      detailOnly initialRequestId={request.id} onSelectRequest={onSelectRequest} onRequestsChanged={onRequestsChanged} />
    </StrictMode>);
    const button = await screen.findByRole("button", { name: decision === "withdraw" ? "撤回我的提交" : "批准软件配置" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    mounted.rerender(<StrictMode><CanonicalProjectValueReviewPanel key={nextRequest.id}
      projectId="project-1" repository={repository} currentUserId={currentUserId}
      detailOnly initialRequestId={nextRequest.id} />
    </StrictMode>);
    await screen.findByRole("heading", { name: nextRequest.reason });
    await act(async () => { finishAction({ item: { ...request, status: decision === "withdraw" ? "withdrawn" : "approved" } }); });
    expect(onRequestsChanged).not.toHaveBeenCalled();
    expect(onSelectRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: nextRequest.reason })).toBeInTheDocument();
  });

  it("never substitutes a different detail after an uncertain decision and queue refetch", async () => {
    const onRequestsChanged = vi.fn();
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn().mockRejectedValue(new Error("connection interrupted")),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;
    const mounted = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly currentUserId="reviewer-1" initialRequestId={request.id} onRequestsChanged={onRequestsChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "核对来源" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    await screen.findAllByText(/软件审核失败/);
    expect(onRequestsChanged).not.toHaveBeenCalled();
    const refreshedRepository = { ...repository,
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [{ ...request, id: "another-request", reason: "不相关请求" }] }) };
    mounted.rerender(<CanonicalProjectValueReviewPanel projectId="project-1" repository={refreshedRepository}
      detailOnly currentUserId="reviewer-1" initialRequestId={request.id} onRequestsChanged={onRequestsChanged} />);
    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
    expect(await screen.findByText(/已失效、已归档/)).toHaveTextContent(request.id);
    expect(screen.queryByRole("heading", { name: "不相关请求" })).not.toBeInTheDocument();
  });

  it("reloads frozen evidence when an external selection selects the already selected request", async () => {
    const source = { requestId: request.id, format: "json", sourceName: "config.json", bindings: [], before: "before", after: "after" };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockResolvedValueOnce({ item: source })
        .mockReturnValue(new Promise(() => {}))
    } as unknown as ParameterCatalogRepository;
    const mounted = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly currentUserId="reviewer-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "批准软件配置" })).toBeEnabled());
    mounted.rerender(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly currentUserId="reviewer-1" initialRequestId={request.id} />);
    await waitFor(() => expect(repository.getProjectValueChangeSourceDiff).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "批准软件配置" })).toBeDisabled();
    expect(screen.queryByLabelText("固定源变更前")).not.toBeInTheDocument();
  });

  it("presents the full frozen diff before scope, sticky actions and collapsed provenance", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockResolvedValue({ item: {
        requestId: request.id, format: "json", sourceName: "config.json", bindings: [],
        before: '{"enabled":false,"untouched":"all source lines"}\n',
        after: '{"enabled":true,"untouched":"all source lines"}\n', diffDigest: "sha256:full"
      } })
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} detailOnly
      currentUserId="reviewer-1" users={[{ id: "user-1", name: "提交者" }]} />);
    const detail = await screen.findByRole("article", { name: "源文件请求详情" });
    expect(detail.querySelector("header")).toHaveTextContent("提交者 → 未指派");
    expect(within(detail).getAllByRole("heading", { level: 4 }).slice(0, 3).map((heading) => heading.textContent))
      .toEqual(["变更摘要", "前后对比", "影响范围"]);
    expect(await within(detail).findByLabelText("固定源变更前")).toHaveTextContent("all source lines");
    expect(within(detail).getByLabelText("固定源变更后")).toHaveTextContent("all source lines");
    const footer = detail.querySelector("footer")!;
    expect(footer).toHaveClass("dialog-actions");
    const disclosure = detail.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(footer.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "复制 固定来源元数据 · diffDigest" })).not.toBeInTheDocument();
  });

  it("requires a trimmed rejection reason and notifies the queue only after success", async () => {
    const onRequestsChanged = vi.fn();
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn().mockResolvedValue({ item: { ...request, status: "rejected" } }),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      currentUserId="reviewer-1" onRequestsChanged={onRequestsChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    const dialog = screen.getByRole("dialog", { name: "驳回请求" });
    const confirm = within(dialog).getByRole("button", { name: "确认驳回" });
    expect(confirm).toBeDisabled();
    expect(repository.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "  " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "  请补充依据  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(repository.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", request.id, { decision: "reject", note: "请补充依据" }, expect.any(Object)));
    await waitFor(() => expect(onRequestsChanged).toHaveBeenCalledTimes(1));
  });

  it("embeds only detail and follows the coordinator's view and selection", async () => {
    const terminal = { ...request, id: "history-request", status: "rejected" as const };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request, terminal] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable"))
    } as unknown as ParameterCatalogRepository;
    const mounted = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly externalView="pending" initialRequestId={request.id} />);
    expect(await screen.findByRole("article", { name: "源文件请求详情" })).toHaveTextContent(request.reason);
    expect(screen.queryByRole("heading", { name: "软件配置审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    mounted.rerender(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly externalView="history" initialRequestId={terminal.id} />);
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已驳回"));
    expect(repository.getProjectValueChangeSourceDiff).toHaveBeenLastCalledWith("project-1", terminal.id);
    mounted.rerender(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      detailOnly externalView="pending" initialRequestId={request.id} />);
    await waitFor(() => expect(repository.getProjectValueChangeSourceDiff).toHaveBeenLastCalledWith("project-1", request.id));
  });

  it("keeps a non-reviewer's single-target request available without reading the reviewer batch queue", async () => {
    const listProjectValueBatchChangeRequests = vi.fn().mockRejectedValue(new Error("403"));
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      listProjectValueBatchChangeRequests,
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable"))
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository}
      currentUserId="user-1" canReview={false} />);
    expect(await screen.findByRole("button", { name: "撤回我的提交" })).toBeEnabled();
    expect(listProjectValueBatchChangeRequests).not.toHaveBeenCalled();
  });

  it("does not replace the new project's selection when an earlier withdrawal finishes", async () => {
    let finishWithdrawal!: (value: unknown) => void;
    const withdrawProjectValueChangeRequest = vi.fn().mockImplementation(() => new Promise((resolve) => { finishWithdrawal = resolve; }));
    const onSelectRequest = vi.fn();
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockImplementation(async (projectId: string) => ({
        items: [{ ...request, id: projectId === "project-1" ? request.id : "project-2-request", projectId }]
      })),
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest,
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable")),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;
    const { rerender } = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="user-1" canReview={false} onSelectRequest={onSelectRequest} />);
    fireEvent.click(await screen.findByRole("button", { name: "撤回我的提交" }));
    await waitFor(() => expect(withdrawProjectValueChangeRequest).toHaveBeenCalled());
    rerender(<CanonicalProjectValueReviewPanel projectId="project-2" repository={repository} currentUserId="user-1" canReview={false} onSelectRequest={onSelectRequest} />);
    await screen.findByRole("article", { name: "源文件请求详情" });
    fireEvent.click(screen.getByText("溯源信息"));
    expect(await screen.findByText("project-2-request")).toBeVisible();
    finishWithdrawal({ item: { ...request, status: "withdrawn" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "撤回我的提交" })).toBeEnabled());
    expect(screen.getByText("project-2-request")).toBeInTheDocument();
    expect(onSelectRequest).not.toHaveBeenCalled();
  });

  it("lets the submitter withdraw without review permission and retains access to history", async () => {
    const onSelectRequest = vi.fn();
    const withdrawProjectValueChangeRequest = vi.fn().mockResolvedValue({ item: { ...request, status: "withdrawn" } });
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest,
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable")),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="user-1" canReview={false} onSelectRequest={onSelectRequest} />);
    fireEvent.click(await screen.findByRole("button", { name: "撤回我的提交" }));
    await waitFor(() => expect(withdrawProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", request.id, expect.objectContaining({ catalogReleaseId: "release-1", idempotencyKey: expect.any(String) })
    ));
    expect(repository.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤回我的提交" })).not.toBeInTheDocument());
    expect(onSelectRequest).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole("tab", { name: "历史" }));
    await waitFor(() => expect(repository.listProjectValueChangeRequests).toHaveBeenLastCalledWith("project-1", undefined));
  });

  it("never offers withdrawal for another submitter", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest: vi.fn()
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="other-user" canReview={false} />);
    await screen.findByRole("region", { name: "软件配置审核" });
    expect(screen.queryByRole("button", { name: "撤回我的提交" })).not.toBeInTheDocument();
  });

  it("keeps reviewers from acting on their own submission", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest: vi.fn()
    } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="user-1" canReview />);
    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    expect(within(panel).queryByRole("button", { name: "批准软件配置" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "撤回我的提交" })).toBeEnabled();
  });

  it("lists canonical JSON requests and approves through the v2 software-review port", async () => {
    const onSelectRequest = vi.fn();
    const nextRequest = { ...request,id: "request-json-2" };
    const listProjectValueChangeRequests = vi.fn().mockResolvedValue({ items: [request,nextRequest] });
    const reviewProjectValueChangeRequest = vi.fn().mockResolvedValue({ item: { ...request, status: "approved" } });
    const getProjectValueChangeSourceDiff = vi.fn().mockImplementation(async (_projectId: string,requestId: string) => ({
      item: {
        requestId,
        bindingId: request.bindingId,
        format: "json",
        sourceName: "config.json",
        sourcePinId: "source-pin-1",
        candidateId: "candidate-1",
        baseDigest: "sha256:before",
        proposedDigest: "sha256:after",
        diffDigest: "sha256:diff",
        before: '{"enabled":false}\n',
        after: '{"enabled":true}\n',
        bindings: [{
          bindingId: request.bindingId,
          oldValueId: "value-old",
          sourcePinId: "source-pin-1",
          sourceOccurrenceId: "occurrence-1",
          definitionId: request.definitionId,
          effectiveRevisionId: request.effectiveRevisionId,
          catalogReleaseId: "release-1",
          locator: { kind: "json-pointer", pointer: "/enabled" },
          valueKind: "json",
          valueDigest: "sha256:after",
          configSetId: "config-set-1"
        }]
      }
    }));
    const repository = {
      listProjectValueChangeRequests,
      reviewProjectValueChangeRequest,
      getProjectValueChangeSourceDiff,
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;

    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="reviewer-1" onSelectRequest={onSelectRequest} />);
    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    expect((await within(panel).findAllByText("JSON")).length).toBeGreaterThan(0);
    expect(within(panel).getByLabelText("固定源目标内容")).toHaveTextContent("cells");
    expect(await within(panel).findByLabelText("固定源变更前")).toHaveTextContent("enabled");
    expect(await within(panel).findByLabelText("固定源变更后")).toHaveTextContent("enabled");
    expect(getProjectValueChangeSourceDiff).toHaveBeenCalledWith("project-1", request.id);

    const approve = within(panel).getByRole("button", { name: "批准软件配置" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(reviewProjectValueChangeRequest).toHaveBeenCalledWith(
        "project-1",
        "request-json-1",
        { decision: "approve" },
        expect.objectContaining({ catalogReleaseId: "release-1", idempotencyKey: expect.any(String) })
      );
    });
    await waitFor(() => expect(getProjectValueChangeSourceDiff).toHaveBeenCalledWith("project-1",nextRequest.id));
    expect(onSelectRequest).toHaveBeenLastCalledWith(nextRequest.id);
    await waitFor(() => expect(within(panel).getByRole("button",{ name: "批准软件配置" })).toBeEnabled());
  });

  it("keeps approval disabled and shows the real source-diff failure", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("object-store unavailable")),
      reviewProjectValueChangeRequest: vi.fn(),
      getCatalog: vi.fn()
    } as unknown as ParameterCatalogRepository;

    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="reviewer-1" />);
    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    const approve = await within(panel).findByRole("button", { name: "批准软件配置" });
    await waitFor(() => expect(approve).toBeDisabled());
    expect(await within(panel).findByRole("alert")).toHaveTextContent("固定源差异");
    expect(repository.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it("labels a delete request explicitly in the review details", async () => {
    const deleteRequest = {
      ...request,
      id: "request-delete-1",
      action: "delete" as const,
      targetValue: "",
      reason: "移除过时属性"
    };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [deleteRequest] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable"))
    } as unknown as ParameterCatalogRepository;

    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="reviewer-1" />);
    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    expect(within(panel).getByText("删除属性")).toBeVisible();
    expect(within(panel).getByText("删除属性（批准后生效）")).toBeVisible();
  });

  it("uses the authenticated-user projection for personal tracking and keeps foreign rows out", async () => {
    const foreignRequest = { ...request, id: "request-foreign", submitterUserId: "other-user", reason: "别人的请求" };
    const listProjectValueChangeRequests = vi.fn().mockResolvedValue({ items: [request, foreignRequest] });
    const repository = {
      listProjectValueChangeRequests,
      withdrawProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable")),
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
    } as unknown as ParameterCatalogRepository;

    render(
      <CanonicalProjectValueReviewPanel
        projectId="project-1"
        repository={repository}
        currentUserId="user-1"
        canReview={false}
        mineOnly
      />
    );

    const panel = await screen.findByRole("region", { name: "我的参数提交" });
    await waitFor(() => expect(listProjectValueChangeRequests).toHaveBeenCalledWith("project-1", { status: "pending", mine: true }));
    expect(within(panel).getAllByText("校准充电策略").length).toBeGreaterThan(0);
    expect(within(panel).queryByText("别人的请求")).not.toBeInTheDocument();
  });

  it("notifies the route owner when a request is selected", async () => {
    const onSelectRequest = vi.fn();
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("source unavailable"))
    } as unknown as ParameterCatalogRepository;

    render(
      <CanonicalProjectValueReviewPanel
        projectId="project-1"
        repository={repository}
        currentUserId="user-1"
        canReview={false}
        onSelectRequest={onSelectRequest}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "查看请求" }));
    expect(onSelectRequest).toHaveBeenCalledWith(request.id);
  });

  it("opens a terminal canonical deep link in history without offering actions", async () => {
    const terminalRequest = {
      ...request,
      id: "request-approved-1",
      status: "approved" as const,
      reviewerUserId: "reviewer-1",
      reviewerNote: "已核对固定源差异",
      updatedAt: "2026-09-18T01:02:03.000Z",
      applyOutcome: "committed" as const
    };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [terminalRequest] }),
      reviewProjectValueChangeRequest: vi.fn(),
      withdrawProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn().mockResolvedValue({
        item: {
          requestId: terminalRequest.id,
          bindingId: terminalRequest.bindingId,
          format: "json",
          sourceName: "config.json",
          sourcePinId: "source-pin-1",
          candidateId: "candidate-1",
          baseDigest: "sha256:before",
          proposedDigest: "sha256:after",
          diffDigest: "sha256:diff",
          before: "before\n",
          after: "after\n",
          bindings: []
        }
      })
    } as unknown as ParameterCatalogRepository;

    render(
      <CanonicalProjectValueReviewPanel
        projectId="project-1"
        repository={repository}
        currentUserId="reviewer-1"
        canReview
        initialRequestId={terminalRequest.id}
      />
    );

    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    const detail = await within(panel).findByRole("article", { name: "源文件请求详情" });
    expect(within(detail).getByText("已批准")).toBeVisible();
    expect(detail.querySelector("header")).toHaveTextContent("reviewer-1");
    expect(within(panel).getByText("已核对固定源差异")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "批准软件配置" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "撤回我的提交" })).not.toBeInTheDocument();
    await waitFor(() => expect(repository.getProjectValueChangeSourceDiff).toHaveBeenCalledWith("project-1", terminalRequest.id));
  });

  it("does not silently select another request for a stale canonical deep link", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      reviewProjectValueChangeRequest: vi.fn(),
      getProjectValueChangeSourceDiff: vi.fn()
    } as unknown as ParameterCatalogRepository;

    render(
      <CanonicalProjectValueReviewPanel
        projectId="project-1"
        repository={repository}
        currentUserId="reviewer-1"
        initialRequestId="request-missing"
      />
    );

    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("request-missing");
    expect(within(panel).queryByRole("article", { name: "源文件请求详情" })).not.toBeInTheDocument();
    expect(repository.getProjectValueChangeSourceDiff).not.toHaveBeenCalled();
  });

  it.each([null, new WiseEffApiError("NOT_FOUND", "Not found", {}, "request-id")])(
    "treats an absent conflict decision (%s) as an ordinary review", async (absence) => {
      const getProjectValueConflictDecision = absence === null
        ? vi.fn().mockResolvedValue({ item: null }) : vi.fn().mockRejectedValue(absence);
      const repository = {
        listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
        getProjectValueConflictDecision,
        getProjectValueChangeSourceDiff: vi.fn().mockResolvedValue({ item: {
          requestId: request.id, bindingId: request.bindingId, candidateId: request.candidateId,
          sourcePinId: request.sourcePinId, format: "json", bindings: [{ bindingId: request.bindingId }],
          before: "before", after: "after"
        } }),
        reviewProjectValueChangeRequest: vi.fn()
      } as unknown as ParameterCatalogRepository;
      render(<CanonicalProjectValueReviewPanel projectId="project-1" currentUserId="reviewer-1"
        repository={repository} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "批准软件配置" })).toBeEnabled());
      expect(getProjectValueConflictDecision).toHaveBeenCalledWith("project-1", request.id);
      expect(screen.queryByRole("heading", { name: "单项来源冲突决策" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  );

  it("shows one frozen conflict choice and blocks approval when its target or source order disagrees", async () => {
    const assigned = { ...request, candidateId: "prepared-candidate", assignedToUserId: "reviewer-1" };
    const source = { requestId: assigned.id, bindingId: assigned.bindingId, candidateId: assigned.candidateId,
      sourcePinId: assigned.sourcePinId, format: "json", sourceName: "config.json",
      baseDigest: "a".repeat(64), proposedDigest: "b".repeat(64), diffDigest: "c".repeat(64),
      before: "before", after: "after", bindings: [{ bindingId: assigned.bindingId }] };
    const frozen = { request: assigned, sourceCandidateId: "uploaded-candidate",
      selectedBindingId: assigned.bindingId, selectedDraftId: "selected-draft", choice: "draft",
      decisionProofDigest: "d".repeat(64), sourceDiff: source };
    const getProjectValueConflictDecision = vi.fn().mockResolvedValue({ item: frozen });
    const reviewProjectValueChangeRequest = vi.fn();
    const repository = { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [assigned] }),
      getProjectValueChangeSourceDiff: vi.fn().mockResolvedValue({ item: source }),
      getProjectValueConflictDecision, reviewProjectValueChangeRequest,
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } }) } as unknown as ParameterCatalogRepository;
    const { rerender } = render(<CanonicalProjectValueReviewPanel projectId="project-1"
      currentUserId="reviewer-1" repository={repository} />);
    expect(await screen.findByRole("heading", { name: "单项来源冲突决策" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准软件配置" })).toBeEnabled();
    expect(screen.getByText("界面草稿值")).toBeInTheDocument();
    getProjectValueConflictDecision.mockResolvedValue({ item: { ...frozen, sourceDiff: { ...source,
      bindings: [{ bindingId: "other-binding" }] } } });
    rerender(<CanonicalProjectValueReviewPanel projectId="project-2" currentUserId="reviewer-1"
      repository={{ ...repository, listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [{ ...assigned,
        projectId: "project-2" }] }) } as ParameterCatalogRepository} />);
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent("冲突详情、目标、顺序或证明与请求来源不符");
    expect(screen.getByRole("button", { name: "批准软件配置" })).toBeDisabled();
    expect(reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it("blocks review when the frozen conflict detail reports missing proof", async () => {
    const assigned = { ...request, assignedToUserId: "reviewer-1" };
    const reviewProjectValueChangeRequest = vi.fn();
    const repository = { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [assigned] }),
      getProjectValueChangeSourceDiff: vi.fn().mockResolvedValue({ item: { requestId: assigned.id,
        bindingId: assigned.bindingId, candidateId: assigned.candidateId, format: "json",
        sourcePinId: assigned.sourcePinId, bindings: [] } }),
      getProjectValueConflictDecision: vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT",
        "Frozen source conflict decision is inconsistent.", { reason: "conflict-decision-stale" }, "request-id")),
      reviewProjectValueChangeRequest } as unknown as ParameterCatalogRepository;
    render(<CanonicalProjectValueReviewPanel projectId="project-1" currentUserId="reviewer-1"
      repository={repository} />);
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent("冲突决策来源或证明已过期（409）");
    expect(screen.queryByRole("button", { name: "批准软件配置" })).not.toBeInTheDocument();
    expect(reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });
});
