import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogValueChangeSourceDiffResponse } from "@/infrastructure/http/parameterCatalogDtos";
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

type BatchSourceDiff = Extract<CatalogValueChangeSourceDiffResponse["item"], { kind: "batch" }>;
type SourceFixture = Omit<typeof diff, "format" | "targets"> & {
  format: BatchSourceDiff["format"];
  targets: Array<Omit<(typeof diff.targets)[number], "action" | "afterText" | "decision" | "draftId"> & {
    action: BatchSourceDiff["targets"][number]["action"]; afterText?: string;
    decision: BatchSourceDiff["targets"][number]["decision"];
    draftId: BatchSourceDiff["targets"][number]["draftId"];
  }>;
};

function repository(source: SourceFixture = diff) {
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
  it("refreshes the same batch without losing a cancelled rejection or submitting a decision", async () => {
    const repo = repository();
    const panel = (refreshVersion: number) => <CanonicalProjectValueReviewPanel projectId="project-1"
      repository={repo} currentUserId="reviewer-1" detailOnly initialRequestId={batch.id} refreshVersion={refreshVersion} />;
    const { rerender } = render(panel(0));
    fireEvent.click(await screen.findByRole("button", { name: "驳回全部 2 项" }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "整批需补充说明" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    rerender(panel(1));
    await waitFor(() => expect(repo.getProjectValueBatchChangeRequest).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "驳回全部 2 项" }));
    expect(screen.getByLabelText("驳回原因")).toHaveValue("整批需补充说明");
    expect(repo.getProjectValueBatchChangeRequest).toHaveBeenLastCalledWith("project-1", batch.id);
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it.each(["approve", "reject"] as const)("blocks both decisions after an uncertain %s returns another request", async (decision) => {
    const repo = repository();
    const onRequestsChanged = vi.fn();
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockResolvedValue({ item: { ...batch, id: "other-batch", reason: "不相关批量请求" } } as never);
    vi.mocked(repo.reviewProjectValueChangeRequest!).mockRejectedValue(new Error("connection interrupted"));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer-1" initialRequestId={batch.id} onRequestsChanged={onRequestsChanged} />);
    const approve = await screen.findByRole("button", { name: "批准全部 2 项" });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(decision === "approve" ? approve : screen.getByRole("button", { name: "驳回全部 2 项" }));
    if (decision === "reject") fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "需要补充依据" } });
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: decision === "approve" ? "确认批准并应用" : "确认驳回" }));
    await screen.findByText(/审核结果尚未确认|批量软件审核失败/);
    await waitFor(() => expect(repo.getProjectValueBatchChangeRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("article").querySelector("header")).toHaveTextContent("两项校准");
    expect(screen.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "驳回全部 2 项" })).toBeDisabled();
    if (decision === "reject") expect(screen.getByRole("button", { name: "确认驳回" })).toBeDisabled();
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
    expect(onRequestsChanged).not.toHaveBeenCalled();
  });

  it("preserves a blocked rejection until the same batch is freshly read, retaining its reason", async () => {
    const repo = repository();
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockRejectedValueOnce(new Error("status unavailable"))
      .mockResolvedValueOnce({ item: { ...batch, id: "other-batch" } } as never)
      .mockResolvedValue({ item: batch } as never);
    vi.mocked(repo.reviewProjectValueChangeRequest!).mockRejectedValue(new Error("connection interrupted"));
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} detailOnly
      currentUserId="reviewer-1" initialRequestId={batch.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "驳回全部 2 项" }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "需要补充依据" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    await waitFor(() => expect(repo.getProjectValueBatchChangeRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "确认驳回" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "重新核对状态" }));
    await screen.findByText(/请求详情与当前请求不一致/);
    expect(screen.queryByRole("button", { name: "驳回全部 2 项" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载请求" }));
    fireEvent.click(await screen.findByRole("button", { name: "驳回全部 2 项" }));
    expect(screen.getByLabelText("驳回原因")).toHaveValue("需要补充依据");
    expect(screen.getByRole("button", { name: "确认驳回" })).toBeEnabled();
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("shows full batch sources before target impact and keeps every proof copyable behind disclosure", async () => {
    const repo = repository();
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} detailOnly
      initialRequestId={batch.id} currentUserId="reviewer-1"
      users={[{ id: "reviewer-1", name: "审核者" }]} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(detail.querySelector("header")).toHaveTextContent("审核者");
    expect(within(detail).getAllByRole("heading", { level: 4 }).slice(0, 3).map((heading) => heading.textContent))
      .toEqual(["变更摘要", "前后对比", "影响范围"]);
    expect(await within(detail).findByLabelText("批量固定源变更前")).toHaveTextContent(diff.before);
    expect(within(detail).getByLabelText("批量固定源变更后")).toHaveTextContent(diff.after);
    const disclosure = within(detail).getByText("溯源信息").closest("details")!;
    expect(disclosure.open).toBe(false);
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve.compareDocumentPosition(within(detail).getByLabelText("批量固定源变更前")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "驳回全部 2 项" })).toBeInTheDocument();
    expect(detail.querySelector("footer")).toBeNull();
    expect(within(detail).getByRole("region", { name: "影响范围" }).compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(detail).getByText("溯源信息"));
    expect(await within(detail).findByRole("button", { name: "复制 批量证明摘要" })).toBeVisible();
    fireEvent.click(within(detail).getByText("完整技术数据", { exact: true }));
    expect(within(detail).getByLabelText("完整溯源数据")).toHaveTextContent(diff.bindings[0].sourcePinId);
    expect(within(detail).getByRole("button", { name: "复制完整技术数据" })).toBeVisible();
  });

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
    fireEvent.click(within(detail).getByText(/查看全部 3 项参数与草稿影响/));
    expect(within(within(detail).getByRole("region", { name: "影响范围" })).getAllByText("项目成员（姓名暂不可用）")).toHaveLength(2);
    expect(within(detail).getByRole("list", { name: "批量审核目标" })).toHaveTextContent("项目成员（姓名暂不可用）");
    expect(within(detail).getByText("/binding-sibling").parentElement).toHaveTextContent("保留数值，更新来源关联");
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: "确认批准并应用" }));
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
    fireEvent.click(within(detail).getByText("溯源信息"));
    fireEvent.click(await within(detail).findByText("完整技术数据", { exact: true }));
    expect(within(detail).getByLabelText("完整溯源数据")).toHaveTextContent('"format": "dts"');
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: "确认批准并应用" }));
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
    expect(within(detail.querySelector("header")!).getAllByText("项目成员（姓名暂不可用）")).toHaveLength(2);
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    expect(await within(detail).findByLabelText("目标 1 来源变更前")).toHaveTextContent("36.5");
    expect(within(detail).getByLabelText("目标 2 来源变更后")).toHaveTextContent("60");
    const approve = within(detail).getByRole("button", { name: "批准全部 2 项" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: "确认批准并应用" }));
    await waitFor(() => expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", batch.id, { decision: "approve", batchProofDigest: proof,
        draftImpactDigest: "d".repeat(64) },
      expect.objectContaining({ catalogReleaseId: "release-1", idempotencyKey: expect.any(String) })
    ));
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已批准"));
    fireEvent.click(screen.getByText("溯源信息"));
    fireEvent.click(await screen.findByText("完整技术数据", { exact: true }));
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("value-0");
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("value-1");
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
    fireEvent.click(screen.getByRole("button", { name: "确认批准并应用" }));
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
    fireEvent.click(screen.getByRole("button", { name: "确认批准并应用" }));
    await waitFor(() => expect(screen.getByRole("article")).toHaveTextContent("已批准"));
    fireEvent.click(screen.getByText("溯源信息"));
    fireEvent.click(await screen.findByText("完整技术数据", { exact: true }));
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("value-0");
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
    expect(await within(detail).findByText("删除属性")).toBeVisible();
    await waitFor(() => expect(within(detail).getByRole("button", { name: "批准全部 2 项" })).toBeEnabled());
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
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValueOnce({ items: [batch] } as never)
      .mockResolvedValue({ items: [{ ...batch, status: "rejected" }] } as never);
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValueOnce({ item: batch } as never)
      .mockResolvedValue({ item: { ...batch, status: "rejected" } } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo} currentUserId="reviewer-1" />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByLabelText("批量固定源变更前")).toHaveTextContent(diff.before);
    expect(within(detail).getByRole("list", { name: "批量审核目标" }).querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(within(detail).getByRole("button", { name: "驳回全部 2 项" }));
    const dialog = screen.getByRole("dialog", { name: /驳回「/ });
    const confirm = within(dialog).getByRole("button", { name: "确认驳回" });
    expect(confirm).toBeDisabled();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "  补充校准依据  " } });
    await act(async () => { fireEvent.click(confirm); });
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledWith(
      "project-1", batch.id, { decision: "reject", note: "补充校准依据", batchProofDigest: proof,
        draftImpactDigest: "d".repeat(64) }, expect.any(Object)
    );
    const rejectedDetail = screen.getByRole("article", { name: "批量源文件请求详情" });
    expect(rejectedDetail).toBeInTheDocument();
    expect(rejectedDetail).toHaveTextContent("已驳回");
    expect(repo.reviewProjectValueChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("finds the submitter's batch in mine and withdraws with a refreshed terminal result", async () => {
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [batch] } as never);
    repo.withdrawProjectValueChangeRequest = vi.fn().mockResolvedValue({ item: { ...batch, status: "withdrawn" } });
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="author-1" mineOnly />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(within(detail).queryByRole("button", { name: "复制 批量证明摘要" })).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByText("溯源信息"));
    expect(await within(detail).findByRole("button", { name: "复制 批量证明摘要" })).toBeVisible();
    expect(within(detail).getAllByText(proof).every((element) => element.closest("details")?.open)).toBe(true);
    fireEvent.click(within(detail).getByRole("button", { name: "撤回我的批量提交" }));
    expect(repo.withdrawProjectValueChangeRequest).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认撤回提交" })).getByRole("button", { name: "撤回提交" }));
    await waitFor(() => expect(repo.withdrawProjectValueChangeRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(detail).toHaveTextContent("已撤回"));
  });

  it("shows the owner's immutable batch source diff in personal history without review actions", async () => {
    const terminal = { ...batch, status: "approved" as const };
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [terminal] } as never);
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({ item: terminal } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="author-1" mineOnly initialRequestId={batch.id} />);
    const detail = await screen.findByRole("article", { name: "批量源文件请求详情" });
    expect(await within(detail).findByLabelText("批量固定源变更前")).toHaveTextContent(diff.before);
    expect(within(detail).getByLabelText("批量固定源变更后")).toHaveTextContent(diff.after);
    expect(repo.getProjectValueBatchChangeRequest).toHaveBeenCalledWith("project-1", batch.id);
    expect(repo.getProjectValueChangeSourceDiff).toHaveBeenCalledWith("project-1", batch.id);
    expect(within(detail).queryByRole("button", { name: /批准全部|驳回全部/ })).not.toBeInTheDocument();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
  });

  it.each([
    { ...batch, projectId: "foreign-project" },
    { ...batch, submitterUserId: "other-author" }
  ])("refuses a mismatched owner detail in personal history", async (item) => {
    const repo = repository();
    vi.mocked(repo.listProjectValueBatchChangeRequests!).mockResolvedValue({ items: [batch] } as never);
    vi.mocked(repo.getProjectValueBatchChangeRequest!).mockResolvedValue({ item } as never);
    render(<CanonicalProjectValueReviewPanel projectId="project-1" repository={repo}
      currentUserId="author-1" mineOnly initialRequestId={batch.id} />);
    await waitFor(() => expect(repo.getProjectValueBatchChangeRequest).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("不一致");
    expect(screen.queryByLabelText("批量固定源变更前")).not.toBeInTheDocument();
    expect(repo.getProjectValueChangeSourceDiff).not.toHaveBeenCalled();
    expect(repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
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
