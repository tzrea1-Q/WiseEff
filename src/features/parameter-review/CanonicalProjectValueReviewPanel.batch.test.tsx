import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";

const proof = "a".repeat(64);
const targets = ["binding-a", "binding-b"].map((bindingId, ordinal) => ({
  ordinal, draftId: null, decision: "file" as const, bindingId, definitionId: "same-definition",
  definitionRevisionId: "definition-revision", catalogReleaseId: "release-1",
  baseCurrentValueId: `base-${ordinal}`, configRevisionId: `revision-${ordinal}`,
  sourceRef: `source-${ordinal}`, sourcePinId: `pin-${ordinal}`,
  action: "set" as const, targetText: String(50 + ordinal * 10),
  appliedValueId: null, appliedHistoryEventId: null,
  appliedSourcePinId: null, appliedFileVersionId: null
}));
const impact = targets.map((target) => ({ ordinal: target.ordinal, bindingId: target.bindingId,
  role: "target" as const, decision: "file" as const, baseCurrentValueId: target.baseCurrentValueId,
  sourcePinId: target.sourcePinId, configRevisionId: target.configRevisionId, drafts: [] }));
const siblingImpact = { ordinal: 2, bindingId: "binding-unchanged", role: "sibling" as const,
  decision: "re-pin" as const, baseCurrentValueId: "base-unchanged", sourcePinId: "pin-unchanged",
  configRevisionId: "revision-unchanged", drafts: [] };
const siblingBinding = { bindingId: "binding-unchanged", oldValueId: "base-unchanged", sourcePinId: "pin-unchanged" };
const batch = {
  id: "batch-1", projectId: "project-1", candidateId: "candidate-1",
  batchProofDigest: proof, cohortCount: 2, status: "pending" as const,
  draftImpactDigest: "d".repeat(64), draftImpact: impact, uploadCandidateId: null,
  decisionProofDigest: null, compositionProof: null,
  reason: "两项校准", submitterUserId: "author-1", assignedToUserId: "reviewer-1",
  reviewerUserId: null, reviewerNote: null, sourceProofToken: "source-proof",
  cohortProofToken: "cohort-proof", fileId: "file-1", baseVersionId: "version-1",
  configSetId: "set-1", appliedAt: null, appliedAuditRef: null, targets
};
const diff = {
  kind: "batch" as const, requestId: batch.id, candidateId: batch.candidateId,
  batchProofDigest: proof, format: "json" as const, sourceName: "config.json",
  baseDigest: "before-digest", proposedDigest: "after-digest", diffDigest: proof,
  before: '{"a":36.5,"b":48}', after: '{"a":50,"b":60}',
  bindings: targets.map((target) => ({ bindingId: target.bindingId,
    oldValueId: target.baseCurrentValueId, sourcePinId: target.sourcePinId })),
  targets: targets.map((target, ordinal) => ({
    ordinal, bindingId: target.bindingId, sourcePinId: target.sourcePinId,
    action: target.action, decision: "file" as const, draftId: null,
    beforeText: ordinal === 0 ? "36.5" : "48",
    afterText: target.targetText
  }))
};

function repository(source = diff) {
  const reviewProjectValueChangeRequest = vi.fn().mockResolvedValue({ item: batch });
  const getProjectValueBatchChangeRequest = vi.fn().mockResolvedValue({ item: batch });
  const getProjectValueChangeSourceDiff = vi.fn().mockResolvedValue({ item: source });
  return {
    listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
    listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
    getProjectValueBatchChangeRequest,
    getProjectValueChangeSourceDiff,
    reviewProjectValueChangeRequest,
    getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-1" } })
  } as unknown as ParameterCatalogRepository;
}

describe("canonical batch reviewer", () => {
  it.each(["json", "dts"] as const)("reviews a composed %s upload, draft choice, and sibling re-pin with all digests", async (format) => {
    const mixedDigest = "b".repeat(64);
    const decisionDigest = "c".repeat(64);
    const impactDigest = "d".repeat(64);
    const cohort = ["binding-a", "binding-b", "binding-sibling"].map((bindingId, index) => ({
      bindingId, oldValueId: `base-${index}`, sourcePinId: `pin-${index}`,
      sourceOccurrenceId: `occ-${index}`, definitionId: "same-definition",
      effectiveRevisionId: "definition-revision", catalogReleaseId: "release-1",
      locator: { pointer: `/${bindingId}` }, valueKind: "number", valueDigest: "value-digest",
      configSetId: "set-1"
    }));
    const impact = cohort.map((entry, index) => ({ ordinal: index, bindingId: entry.bindingId,
      baseCurrentValueId: entry.oldValueId, sourcePinId: entry.sourcePinId,
      configRevisionId: `revision-${index}`,
      role: index === 2 ? "sibling" : "target", decision: index === 0 ? "draft" : index === 1 ? "file" : "re-pin",
      ...(index === 0 ? { selectedDraftId: "draft-88" } : {}),
      drafts: index === 0 ? [{ draftId: "draft-88", authorUserId: "other-author", currentlyStale: false,
        expectedEffect: "preserved-stale" }] : index === 2 ? [{ draftId: "sibling-draft", authorUserId: "third-author",
        currentlyStale: false, expectedEffect: "preserved-stale" }] : []
    }));
    const chosenTargets = targets.map((target, index) => ({ ...target,
      targetText: index === 0 ? "88" : "60", decision: index === 0 ? "draft" as const : "file" as const,
      draftId: index === 0 ? "draft-88" : null
    }));
    const compositionProof = { uploadCandidateId: "original-upload", composedCandidateId: "composed-candidate",
      projectId: "project-1", fileId: "file-1", baseVersionId: "version-1",
      configSetId: "set-1", format, cohortProofToken: "cohort-proof",
      batchProofDigest: mixedDigest, draftImpactDigest: impactDigest, decisionProofDigest: decisionDigest,
      cohort, targetDecisions: chosenTargets.map((target, ordinal) => ({ ordinal,
        bindingId: target.bindingId, choice: target.decision, action: target.action,
        targetText: target.targetText, draft: ordinal === 0 ? { id: "draft-88" } : null })) };
    const request = { ...batch, candidateId: "composed-candidate", uploadCandidateId: "original-upload",
      batchProofDigest: mixedDigest, draftImpactDigest: impactDigest, decisionProofDigest: decisionDigest,
      draftImpact: impact, compositionProof, cohortCount: 3, targets: chosenTargets };
    const source = { ...diff, format, candidateId: "composed-candidate", uploadCandidateId: "original-upload",
      decisionProofDigest: decisionDigest, batchProofDigest: mixedDigest, diffDigest: mixedDigest,
      uploadAfter: "50 / 60 / 30", after: "88 / 60 / 30", draftImpact: impact, bindings: cohort,
      targets: chosenTargets.map((target, ordinal) => ({ ordinal, bindingId: target.bindingId,
        sourcePinId: target.sourcePinId, action: target.action, decision: target.decision,
        draftId: target.draftId, beforeText: String(10 + ordinal * 10), afterText: target.targetText })) };
    const repo = repository(source);
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({ item: request } as never);
    const view = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={request.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByLabelText("批量原上传来源")).toHaveTextContent("50 / 60 / 30");
    expect(within(detail).getByLabelText("批量固定源变更后")).toHaveTextContent("88 / 60 / 30");
    expect(within(detail).getAllByText("other-author")).toHaveLength(2);
    expect(within(detail).getByText(/兄弟 Binding · 结构性 re-pin/)).toBeVisible();
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", request.id, { decision: "approve", batchProofDigest: mixedDigest,
        draftImpactDigest: impactDigest, decisionProofDigest: decisionDigest }, expect.any(Object)
    ));
    view.unmount();
    for (const incomplete of [
      { ...request, compositionProof: { ...compositionProof,
        targetDecisions: [...compositionProof.targetDecisions].reverse() } },
      { ...request, draftImpact: impact.slice(0, 2) },
      { ...request, decisionProofDigest: null },
      { ...request, draftImpactDigest: null }
    ]) {
      const rejected = repository(source);
      vi.mocked(rejected.getProjectValueBatchChangeRequest!).mockResolvedValue({ item: incomplete } as never);
      const mounted = render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={rejected}
        currentUserId="reviewer-1" initialRequestId={request.id} />);
      const blocked = await screen.findByRole("article", { name: "批量源文件请求详情" });
      await expect(within(blocked).findByRole("alert")).resolves.toHaveTextContent("不一致");
      expect(within(blocked).getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
      expect(rejected.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
      mounted.unmount();
    }
  });
  it("shows a DTS request with its full surviving Binding cohort and approves one frozen digest", async () => {
    const repo = repository({ ...diff, format: "dts", sourceName: "config.dts",
      bindings: [...diff.bindings, siblingBinding] });
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({
      item: { ...batch, cohortCount: 3, draftImpact: [...impact, siblingImpact] }
    } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByText("DTS")).toBeVisible();
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", batch.id, { decision: "approve", batchProofDigest: proof,
        draftImpactDigest: "d".repeat(64) }, expect.any(Object)
    ));
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("blocks DTS approval when the fixed source difference fails to load", async () => {
    const repo = repository();
    vi.mocked(repo.getProjectValueChangeSourceDiff!).mockRejectedValue(new Error("source unavailable"));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByRole("alert")).toBeVisible();
    expect(within(detail).getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["missing target", diff.targets.slice(0, 1), proof],
    ["reordered targets", [...diff.targets].reverse(), proof],
    ["wrong proof", diff.targets, "b".repeat(64)]
  ])("blocks DTS approval for %s", async (_reason, sourceTargets, sourceProof) => {
    const repo = repository({ ...diff, format: "dts", batchProofDigest: sourceProof,
      bindings: [...diff.bindings, siblingBinding], targets: sourceTargets });
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({
      item: { ...batch, cohortCount: 3, draftImpact: [...impact, siblingImpact] }
    } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByRole("alert")).toHaveTextContent("不一致");
    expect(within(detail).getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it("loads one exact request, compares both source targets, and approves once with its frozen digest", async () => {
    const repo = repository();
    const approved = {
      ...batch, status: "approved" as const, reviewerUserId: "reviewer-1",
      targets: targets.map((target) => ({ ...target, appliedValueId: `value-${target.ordinal}`,
        appliedHistoryEventId: `history-${target.ordinal}`, appliedSourcePinId: `new-pin-${target.ordinal}`,
        appliedFileVersionId: "version-2" }))
    };
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockResolvedValue({ item: approved } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);

    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).getByText("两项校准")).toBeVisible();
    expect(within(detail).getByText("reviewer-1")).toBeVisible();
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    expect(await within(detail).findByLabelText("目标 1 来源变更前")).toHaveTextContent("36.5");
    expect(within(detail).getByLabelText("目标 2 来源变更后")).toHaveTextContent("60");
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", batch.id, { decision: "approve", batchProofDigest: proof,
        draftImpactDigest: "d".repeat(64) },
      expect.objectContaining({ catalogReleaseId: "release-1", idempotencyKey: expect.any(String) })
    ));
    await waitFor(() => expect(screen.getByText("value-0")).toBeVisible());
    expect(screen.getByText("value-1")).toBeVisible();
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("article", { name: "批量源文件请求详情" }))
      .queryByRole("button", { name: /批准全部/ })).not.toBeInTheDocument();
  });

  it.each([
    ["missing target", { ...diff, targets: diff.targets.slice(0, 1) }],
    ["reordered targets", { ...diff, targets: [...diff.targets].reverse() }],
    ["wrong proof", { ...diff, batchProofDigest: "b".repeat(64) }],
    ["wrong target text", { ...diff, targets: [{ ...diff.targets[0], afterText: "999" }, diff.targets[1]] }]
  ])("refuses approval for %s", async (_name, source) => {
    const repo = repository(source);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByRole("alert")).toHaveTextContent("不一致");
    expect(within(detail).getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it("keeps the pending request visible and blocks another approval after source drift", async () => {
    const repo = repository();
    vi.mocked(repo.reviewProjectValueChangeRequest!).mockRejectedValue(new WiseEffApiError(
      "CONFLICT", "Source changed", { reason: "source-proof-stale" }, "trace-1"
    ));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const approve = await screen.findByRole("button", { name: "批准全部 2 项" });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    expect(await screen.findByText(/来源或审核证明已变化/)).toBeVisible();
    expect(screen.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
    expect(screen.getByRole("article", { name: "批量源文件请求详情" })).toHaveTextContent("待审核");
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("re-reads the batch after an uncertain approval error without sending a second approval", async () => {
    const repo = repository();
    const approved = { ...batch, status: "approved" as const, targets: targets.map((target) => ({
      ...target, appliedValueId: `value-${target.ordinal}`, appliedHistoryEventId: `history-${target.ordinal}`,
      appliedSourcePinId: `new-pin-${target.ordinal}`, appliedFileVersionId: "version-2"
    })) };
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockResolvedValue({ item: approved } as never);
    vi.mocked(repo.reviewProjectValueChangeRequest!).mockRejectedValue(new Error("connection interrupted"));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const approve = await screen.findByRole("button", { name: "批准全部 2 项" });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByText("value-0")).toBeVisible());
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /批准全部/ })).not.toBeInTheDocument();
  });

  it("shows a delete target without a replacement value", async () => {
    const deleted = { ...targets[1], action: "delete" as const, targetText: null };
    const repo = repository({ ...diff, targets: [diff.targets[0], {
      ...diff.targets[1], action: "delete" as const, afterText: undefined
    }] });
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({
      item: { ...batch, targets: [targets[0], deleted] }
    } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByText("删除（无替换值）")).toBeVisible();
    expect(within(detail).getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
  });

  it("hides review actions for the submitter", async () => {
    const repo = repository();
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="author-1" initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).queryByRole("button", { name: /批准全部/ })).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /驳回全部/ })).not.toBeInTheDocument();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it("discovers the assigned pending batch in the queue and rejects once", async () => {
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [batch] } as never);
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockResolvedValue({ item: { ...batch, status: "rejected" } } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} currentUserId="reviewer-1" />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(within(detail).getByRole("button", { name: "驳回全部 2 项" }));
    await waitFor(() => expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", batch.id, { decision: "reject", batchProofDigest: proof,
        draftImpactDigest: "d".repeat(64) }, expect.any(Object)
    ));
    await waitFor(() => expect(detail).toHaveTextContent("已驳回"));
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("finds the submitter's batch in mine and withdraws with a refreshed terminal result", async () => {
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [batch] } as never);
    repo.withdrawProjectValueChangeRequest = vi.fn().mockResolvedValue({ item: { ...batch, status: "withdrawn" } });
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="author-1" mineOnly />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).getByText(proof)).toBeVisible();
    fireEvent.click(within(detail).getByRole("button", { name: "撤回我的批量提交" }));
    await waitFor(() => expect(repo.withdrawProjectValueChangeRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(detail).toHaveTextContent("已撤回"));
  });

  it("does not offer approval to a reviewer who is not assigned", async () => {
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [batch] } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} currentUserId="reviewer-2" />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).queryByRole("button", { name: /批准全部/ })).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /驳回全部/ })).not.toBeInTheDocument();
  });

  it("does not expose a batch detail when the reviewer read is forbidden", async () => {
    const repo = repository();
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockRejectedValue(new WiseEffApiError(
      "FORBIDDEN", "Forbidden", {}, "trace-2"
    ));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="outsider" initialRequestId={batch.id} />);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("article", { name: "批量源文件请求详情" })).not.toBeInTheDocument();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });
});
