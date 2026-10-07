import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
