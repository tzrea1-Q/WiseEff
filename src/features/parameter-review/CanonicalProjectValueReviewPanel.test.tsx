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
  it("lists canonical JSON requests and approves through the v2 software-review port", async () => {
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

    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} />);
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
    await waitFor(() => expect(within(panel).getByRole("button",{ name: "批准软件配置" })).toBeEnabled());
  });

  it("keeps approval disabled and shows the real source-diff failure", async () => {
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      getProjectValueChangeSourceDiff: vi.fn().mockRejectedValue(new Error("object-store unavailable")),
      reviewProjectValueChangeRequest: vi.fn(),
      getCatalog: vi.fn()
    } as unknown as ParameterCatalogRepository;

    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} />);
    const panel = await screen.findByRole("region", { name: "软件配置审核" });
    const approve = await within(panel).findByRole("button", { name: "批准软件配置" });
    await waitFor(() => expect(approve).toBeDisabled());
    expect(await within(panel).findByRole("alert")).toHaveTextContent("固定源差异");
    expect(repository.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });
});
