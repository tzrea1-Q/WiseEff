import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
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
    expect(await screen.findByText("project-2-request")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
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
    expect(within(panel).getAllByText("JSON").length).toBeGreaterThan(0);
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
    expect(await within(panel).findByText("已批准")).toBeInTheDocument();
    expect(within(panel).getByText("reviewer-1")).toBeInTheDocument();
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
});
