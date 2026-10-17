import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterFileCandidate, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import type { CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import type { CatalogBatchValueChangeRequestResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { CanonicalBatchSubmitDialog } from "./CanonicalBatchSubmitDialog";

const digest = "a".repeat(64);
const candidate: ParameterFileCandidate = { id: "candidate-1", projectId: "project-1", fileName: "config.dts",
  fileId: "file-1", baseVersionId: "version-1", checksum: "b".repeat(64), sizeBytes: 10,
  format: "dts", status: "ready", diagnostics: [], impact: {}, blockers: [],
  createdAt: "2026-09-24", updatedAt: "2026-09-24" };
const bindings = ["binding-a", "binding-b"].map((bindingId) => ({
  bindingId, definitionId: "definition-1", baseCurrentValueId: "value-1",
  configRevisionId: "revision-1", sourcePinId: `pin-${bindingId}`,
  locator: `/node/${bindingId}`, baseDigest: digest, proposedDigest: candidate.checksum!,
  action: "set" as const, beforeText: "<36>", afterText: "<77>"
}));
const preview: ParameterFileSourcePreview = { kind: "canonical", canSubmit: false,
  reason: "canonical-batch-review-required", fileId: candidate.fileId, baseVersionId: candidate.baseVersionId,
  candidateId: candidate.id, format: "dts", proofToken: "proof-1", proposedDigest: candidate.checksum, bindings };

type Batch = CatalogBatchValueChangeRequestResponse["item"];
function batchResponse(overrides: Partial<Batch> = {}): CatalogBatchValueChangeRequestResponse {
  return { item: {
    id: "new-batch", projectId: "project-1", status: "pending", candidateId: candidate.id,
    assignedToUserId: "reviewer-1", submitterUserId: "author-1", reviewerUserId: null, reviewerNote: null,
    reason: "reason", batchProofDigest: digest, cohortCount: 2, uploadCandidateId: null, compositionProof: null,
    decisionProofDigest: null, sourceProofToken: preview.proofToken!, cohortProofToken: "workflow",
    fileId: candidate.fileId!, baseVersionId: candidate.baseVersionId!, configSetId: "set",
    appliedAt: null, appliedAuditRef: null, draftImpactDigest: digest,
    draftImpact: bindings.map((binding, ordinal) => ({ ordinal, bindingId: binding.bindingId, role: "target",
      decision: "file", baseCurrentValueId: binding.baseCurrentValueId, sourcePinId: binding.sourcePinId,
      configRevisionId: binding.configRevisionId, drafts: [] })),
    targets: bindings.map((binding, ordinal) => ({ ordinal, bindingId: binding.bindingId,
      action: binding.action, sourcePinId: binding.sourcePinId, targetText: binding.afterText,
      baseCurrentValueId: binding.baseCurrentValueId, configRevisionId: binding.configRevisionId,
      definitionId: binding.definitionId, definitionRevisionId: "revision", catalogReleaseId: "release",
      sourceRef: binding.locator, targetValue: binding.afterText, decision: "file", draftId: null,
      appliedValueId: null, appliedHistoryEventId: null, appliedSourcePinId: null, appliedFileVersionId: null })),
    ...overrides
  } };
}

function sourceConflicts(request?: CanonicalSourceConflictList["request"]): CanonicalSourceConflictList {
  const file: CanonicalSourceConflictList["items"][number]["choices"]["file"] = {
    choice: "file", candidateId: candidate.id, selectedBindingId: "binding-a", selectedDraftId: "draft-1",
    sourceProofToken: "proof-1", fileId: candidate.fileId!, baseVersionId: candidate.baseVersionId!,
    selectedSourcePinId: "pin-binding-a", selectedBaseValueId: "value-1", selectedRevisionId: "revision-1",
    action: "set", targetText: "<77>", decisionProofDigest: digest, configSetId: "set", cohortProofToken: "workflow",
    sourceCandidateDigest: candidate.checksum!, selectedDraftProof: digest, selectedDraftCandidateId: "draft-candidate",
    selectedDraftCandidateDigest: "c".repeat(64), members: [{ memberId: "member", fileId: candidate.fileId!,
      fileVersionId: candidate.baseVersionId!, sourceName: candidate.fileName, format: "dts", role: "base",
      sortOrder: 0, checksum: digest, sizeBytes: 10, configSetId: "set", isCandidateFile: true }],
    cohort: bindings.map((binding) => ({ bindingId: binding.bindingId, oldValueId: binding.baseCurrentValueId,
      sourcePinId: binding.sourcePinId, sourceOccurrenceId: `occurrence-${binding.bindingId}`,
      definitionId: binding.definitionId, effectiveRevisionId: "revision", catalogReleaseId: "release",
      locator: { path: binding.locator }, valueKind: "u32-array", valueDigest: digest, configSetId: "set" }))
  };
  return { request, items: [{ selectedBindingId: "binding-a", selectedDraftId: "draft-1", authorUserId: "other-author",
    choices: { file, draft: { ...file, choice: "draft", targetText: "<88>", decisionProofDigest: "d".repeat(64) } } }], ineligible: [] };
}

function mixedResponse(): CatalogBatchValueChangeRequestResponse {
  const conflict = sourceConflicts().items[0]!;
  const proof = conflict.choices.draft;
  const response = batchResponse({ candidateId: "composed-candidate", uploadCandidateId: candidate.id,
    sourceProofToken: "composed-proof", decisionProofDigest: digest });
  const request = response.item;
  request.compositionProof = {
    kind: "canonical-batch-draft-composition", organizationId: "org", projectId: "project-1", format: "dts",
    fileId: candidate.fileId!, baseVersionId: candidate.baseVersionId!, configSetId: "set", cohortProofToken: "workflow",
    uploadCandidateId: candidate.id, composedCandidateId: request.candidateId,
    uploadObject: { storageKey: "upload", sha256: candidate.checksum!, sizeBytes: 10, proofToken: preview.proofToken! },
    composedObject: { storageKey: "composed", sha256: digest, sizeBytes: 10, proofToken: request.sourceProofToken },
    batchProofDigest: request.batchProofDigest, draftImpactDigest: request.draftImpactDigest!, decisionProofDigest: digest,
    members: proof.members, cohort: proof.cohort,
    targetDecisions: bindings.map((binding, ordinal) => ({ ordinal, bindingId: binding.bindingId,
      choice: ordinal === 0 ? "draft" : "file", action: "set", locator: { path: binding.locator },
      targetValue: ordinal === 0 ? "<88>" : "<77>", targetText: ordinal === 0 ? "<88>" : "<77>",
      draft: ordinal === 0 ? { id: conflict.selectedDraftId, authorUserId: conflict.authorUserId,
        frozenFingerprint: digest, baseCurrentValueId: proof.selectedBaseValueId,
        sourcePinId: proof.selectedSourcePinId, configRevisionId: proof.selectedRevisionId,
        candidateStorageKey: "draft", candidateSha256: proof.selectedDraftCandidateDigest, candidateSizeBytes: 10 } : null }))
  };
  Object.assign(request.targets[0]!, { decision: "draft", draftId: "draft-1", targetText: "<88>", targetValue: "<88>" });
  Object.assign(request.draftImpact![0]!, { decision: "draft", selectedDraftId: "draft-1" });
  return response;
}

function batchProps(submit = vi.fn().mockResolvedValue(mixedResponse()), conflicts = sourceConflicts()) {
  return { projectId: "project-1", currentUserId: "author-1", candidate, preview,
    repository: { getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }),
      submitProjectValueBatchChangeRequest: submit },
    fileRepository: { getCandidateSourcePreview: vi.fn().mockResolvedValue(preview) },
    conflictClient: { listCandidateSourceConflicts: vi.fn().mockResolvedValue(conflicts) },
    governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { userId: "reviewer-1", name: "周工", roles: ["software-committer"], isActive: true }
    ] }) }, onDismiss: vi.fn(), onSubmitted: vi.fn() };
}

describe("canonical DTS batch submit dialog", () => {
  it("resumes an existing candidate with mixed choices even though a batch preview cannot submit singly", async () => {
    const props = batchProps();
    render(<CanonicalBatchSubmitDialog {...props} />);
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith("new-batch"));
    expect(props.fileRepository.getCandidateSourcePreview).toHaveBeenCalledWith("project-1", candidate.id);
    expect(props.conflictClient.listCandidateSourceConflicts).toHaveBeenCalledWith("project-1", candidate.id);
    expect(props.repository.submitProjectValueBatchChangeRequest).toHaveBeenCalledWith("project-1", {
      candidateId: candidate.id, expectedProofToken: preview.proofToken, reason: "reason", assignedToUserId: "reviewer-1",
      targetDecisions: [{ bindingId: "binding-a", choice: "draft", draftId: "draft-1",
        expectedConflictProofs: [{ draftId: "draft-1", decisionProofDigest: "d".repeat(64) }] },
      { bindingId: "binding-b", choice: "file", expectedConflictProofs: [] }]
    }, expect.objectContaining({ catalogReleaseId: "release", idempotencyKey: expect.any(String) }));
  });

  it.each(["upload", "proof", "cohort", "decision", "author", "action", "impact", "order"] as const)(
    "rejects a mixed response with mismatched %s evidence", async (mismatch) => {
      const response = mixedResponse();
      const composition = response.item.compositionProof!;
      if (mismatch === "upload") response.item.uploadCandidateId = "other-upload";
      if (mismatch === "proof") composition.uploadObject.proofToken = "old-proof";
      if (mismatch === "cohort") composition.cohort[0]!.oldValueId = "other-value";
      if (mismatch === "decision") composition.targetDecisions[0]!.choice = "file";
      if (mismatch === "author") composition.targetDecisions[0]!.draft!.authorUserId = "other-person";
      if (mismatch === "action") response.item.targets[0]!.action = "delete";
      if (mismatch === "impact") response.item.draftImpact![0]!.selectedDraftId = "other-draft";
      if (mismatch === "order") response.item.targets.reverse();
      const props = batchProps(vi.fn().mockResolvedValue(response));
      render(<CanonicalBatchSubmitDialog {...props} />);
      fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1/ }));
      fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
      fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("服务端冻结目标、顺序或证明与预览不一致");
      expect(props.onSubmitted).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "修改原因" })).toBeDisabled();
    }
  );

  it("keeps a selected draft deletion instead of checking it against the uploaded set action", async () => {
    const conflicts = sourceConflicts();
    conflicts.items[0]!.choices.draft.action = "delete";
    delete conflicts.items[0]!.choices.draft.targetText;
    const response = mixedResponse();
    Object.assign(response.item.compositionProof!.targetDecisions[0]!, { action: "delete", targetText: null, targetValue: null });
    Object.assign(response.item.targets[0]!, { action: "delete", targetText: null, targetValue: null });
    const props = batchProps(vi.fn().mockResolvedValue(response), conflicts);
    render(<CanonicalBatchSubmitDialog {...props} />);
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1.*删除属性/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith("new-batch"));
  });

  it("proves the selected draft and every unselected competing draft in target order", async () => {
    const conflicts = sourceConflicts();
    const second = structuredClone(conflicts.items[0]!);
    second.selectedDraftId = "draft-2";
    second.choices.file.selectedDraftId = second.choices.draft.selectedDraftId = "draft-2";
    second.choices.file.decisionProofDigest = "e".repeat(64);
    second.choices.draft.decisionProofDigest = "f".repeat(64);
    conflicts.items.push(second);
    const response = mixedResponse();
    response.item.compositionProof!.targetDecisions[0]!.draft!.id = "draft-2";
    response.item.targets[0]!.draftId = "draft-2";
    response.item.draftImpact![0]!.selectedDraftId = "draft-2";
    const submit = vi.fn().mockResolvedValue(response);
    const props = batchProps(submit, conflicts);
    render(<CanonicalBatchSubmitDialog {...props} />);
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 2/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith("new-batch"));
    expect(submit.mock.calls[0]![1].targetDecisions).toEqual([
      { bindingId: "binding-a", choice: "draft", draftId: "draft-2", expectedConflictProofs: [
        { draftId: "draft-1", decisionProofDigest: digest }, { draftId: "draft-2", decisionProofDigest: "f".repeat(64) }] },
      { bindingId: "binding-b", choice: "file", expectedConflictProofs: [] }
    ]);
  });

  it("blocks a draft whose proof does not belong to the current candidate preview", async () => {
    const conflicts = sourceConflicts();
    conflicts.items[0]!.choices.draft.sourceProofToken = "stale";
    const props = batchProps(vi.fn(), conflicts);
    render(<CanonicalBatchSubmitDialog {...props} />);
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
    expect(props.repository.submitProjectValueBatchChangeRequest).not.toHaveBeenCalled();
  });

  it("preserves choices, reviewer, reason and the identical uncertain request across inline target remounts", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce(mixedResponse());
    const props = batchProps(submit);
    const firstTarget = document.createElement("div");
    document.body.append(firstTarget);
    const view = render(<CanonicalBatchSubmitDialog {...props} inlineTarget={firstTarget} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同一请求重试");
    view.rerender(<CanonicalBatchSubmitDialog {...props} inlineTarget={null} />);
    firstTarget.remove();
    expect(screen.queryByRole("textbox", { name: "修改原因" })).not.toBeInTheDocument();
    const nextTarget = document.createElement("div");
    document.body.append(nextTarget);
    view.rerender(<CanonicalBatchSubmitDialog {...props} inlineTarget={nextTarget} />);
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("reason");
    expect(screen.getByRole("textbox", { name: "修改原因" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer-1");
    expect(screen.getByRole("radio", { name: /采用界面草稿 1/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /采用界面草稿 1/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试同一提交" }));
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith("new-batch"));
    expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
    expect(props.repository.getCatalog).toHaveBeenCalledOnce();
    expect(props.fileRepository.getCandidateSourcePreview).toHaveBeenCalledOnce();
    view.unmount();
    nextTarget.remove();
  });

  it("blocks a refreshed workflow while preserving inline inputs through target hiding and restoration", async () => {
    const props = batchProps();
    const firstTarget = document.createElement("div");
    document.body.append(firstTarget);
    const view = render(<CanonicalBatchSubmitDialog {...props} inlineTarget={firstTarget} />);
    fireEvent.click(await screen.findByRole("radio", { name: /采用界面草稿 1/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeEnabled());
    const blocked = "正在重新核对文件版本与来源证明，暂不能提交。";
    view.rerender(<CanonicalBatchSubmitDialog {...props} inlineTarget={null} submissionBlockedReason={blocked} />);
    firstTarget.remove();
    const nextTarget = document.createElement("div");
    document.body.append(nextTarget);
    view.rerender(<CanonicalBatchSubmitDialog {...props} inlineTarget={nextTarget} submissionBlockedReason={blocked} />);
    expect(screen.getByRole("alert")).toHaveTextContent(blocked);
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("reason");
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer-1");
    expect(screen.getByRole("radio", { name: /采用界面草稿 1/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    expect(props.repository.submitProjectValueBatchChangeRequest).not.toHaveBeenCalled();
    expect(props.repository.getCatalog).not.toHaveBeenCalled();
    view.rerender(<CanonicalBatchSubmitDialog {...props} inlineTarget={nextTarget} submissionBlockedReason="" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交 2 项审核" }));
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith("new-batch"));
    expect(props.fileRepository.getCandidateSourcePreview).toHaveBeenCalledOnce();
    expect(props.conflictClient.listCandidateSourceConflicts).toHaveBeenCalledOnce();
    expect(props.governanceClient.getProjectWorkflowRoleBindings).toHaveBeenCalledOnce();
    view.unmount();
    nextTarget.remove();
  });

  it.each(["pending", "approved"] as const)("opens an existing %s batch receipt instead of submitting again", async (status) => {
    const linked = { ...preview, request: { id: "existing", status, kind: "batch" as const } };
    const props = batchProps(vi.fn(), sourceConflicts(linked.request));
    props.fileRepository.getCandidateSourcePreview.mockResolvedValue(linked);
    render(<CanonicalBatchSubmitDialog {...props} preview={linked} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看已有审核" }));
    expect(props.onSubmitted).toHaveBeenCalledWith("existing");
    expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
    expect(props.repository.submitProjectValueBatchChangeRequest).not.toHaveBeenCalled();
  });

  it.each(["source", "reviewers"])("keeps %s loading failure separate and preserves the reason through recovery", async (failedRequest) => {
    const getPreview = vi.fn().mockResolvedValue(preview);
    const loadReviewers = vi.fn().mockResolvedValue({ bindings: [
      { userId: "reviewer-1", name: "周工", isActive: true, roles: ["software-committer"] }
    ] });
    if (failedRequest === "source") getPreview.mockRejectedValueOnce(new Error("source unavailable"));
    else loadReviewers.mockRejectedValueOnce(new Error("directory unavailable"));
    render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1" candidate={candidate}
      preview={preview} repository={{ submitProjectValueBatchChangeRequest: vi.fn() } as never}
      fileRepository={{ getCandidateSourcePreview: getPreview }}
      conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: [] }) } as never}
      governanceClient={{ getProjectWorkflowRoleBindings: loadReviewers } as never} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "保留原因" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(failedRequest === "source" ? "核对候选变更或来源冲突失败" : "加载软件审核人失败");
    const reviewer = screen.getByRole("combobox", { name: "指定软件审核人" });
    if (failedRequest === "source") expect(reviewer).toHaveAttribute("data-value", "reviewer-1");
    else {
      expect(reviewer).toHaveTextContent("审核人加载失败");
      expect(screen.getByRole("list", { name: "提交前批量目标" })).toHaveTextContent("/node/binding-a");
    }
    expect(screen.queryByRole("link", { name: "配置审核角色" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新核对提交内容" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("保留原因");
    expect(reviewer).toHaveAttribute("data-value", "reviewer-1");
  });

  it("keeps a preflight failure editable and never reports normal loading as a broken proof", async () => {
    const catalog = vi.fn().mockRejectedValueOnce(new Error("catalog offline"))
      .mockResolvedValue({ item: { catalogReleaseId: "release" } });
    const submit = vi.fn().mockResolvedValue(batchResponse({ reason: "补充后的原因" }));
    const governanceClient = { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { userId: "reviewer-1", name: "周工", isActive: true, roles: ["software-committer"] }
    ] }) } as never;
    render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1" candidate={candidate}
      preview={preview} repository={{ getCatalog: catalog, submitProjectValueBatchChangeRequest: submit } as never}
      fileRepository={{ getCandidateSourcePreview: vi.fn().mockResolvedValue(preview) }}
      conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: [] }) } as never}
      governanceClient={governanceClient} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const reason = screen.getByRole("textbox", { name: "修改原因" });
    fireEvent.change(reason, { target: { value: "原始原因" } });
    const button = await screen.findByRole("button", { name: "提交 2 项审核" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("提交前核对失败");
    expect(reason).toBeEnabled();
    expect(reason).toHaveValue("原始原因");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "补充后的原因" } });
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][1].reason).toBe("补充后的原因");
  });

  it.each([
    ["missing proof", { ...preview, proofToken: undefined }],
    ["missing target", { ...preview, bindings: bindings.slice(0, 1) }],
    ["duplicate Binding", { ...preview, bindings: [bindings[0], bindings[0]] }],
    ["missing source pin", { ...preview, bindings: [bindings[0], { ...bindings[1], sourcePinId: "" }] }],
    ["missing target value", { ...preview, bindings: [bindings[0], { ...bindings[1], afterText: undefined }] }]
  ])("blocks submission for %s", async (_reason, invalidPreview) => {
    const submit = vi.fn();
    const repository = { submitProjectValueBatchChangeRequest: submit } as unknown as ParameterCatalogRepository;
    const governanceClient = { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { userId: "reviewer-1", name: "Reviewer", roles: ["software-committer"], isActive: true }
    ] }) } as unknown as ReturnType<typeof createUserGovernanceClient>;
    render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1"
      candidate={candidate} preview={invalidPreview} repository={repository}
      fileRepository={{ getCandidateSourcePreview: vi.fn().mockResolvedValue(invalidPreview) }}
      conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: [] }) } as never}
      governanceClient={governanceClient} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "提交 DTS 批量来源审核" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }),
      { target: { value: "校准" } });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer-1"));
    expect(within(dialog).getByRole("button", { name: /提交 \d+ 项审核|重试同一提交/ })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["pending", "approved", "rejected", "withdrawn"] as const)(
    "blocks an existing %s single request even for two Binding targets", async (status) => {
      const linked = { ...preview, request: { id: "old-single", status, kind: "single" as const } };
      const submit = vi.fn();
      render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1"
        candidate={candidate} preview={linked}
        repository={{ submitProjectValueBatchChangeRequest: submit } as unknown as ParameterCatalogRepository}
        fileRepository={{ getCandidateSourcePreview: vi.fn().mockResolvedValue(linked) }}
        conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ request: linked.request,
          items: [], ineligible: [] }) } as never}
        governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
          { userId: "reviewer-1", name: "Reviewer", roles: ["software-committer"], isActive: true }
        ] }) } as never} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
      const dialog = screen.getByRole("dialog");
      expect(await within(dialog).findByText(/单目标审核请求|单目标请求/)).toBeVisible();
      fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
      expect(within(dialog).getByRole("button", { name: /提交 \d+ 项审核|重试同一提交/ })).toBeDisabled();
      expect(submit).not.toHaveBeenCalled();
    }
  );

  it.each(["rejected", "withdrawn"] as const)(
    "allows a fresh %s batch request with empty conflict items and replays an uncertain network result", async (status) => {
      const linked = { ...preview, request: { id: "old-batch", status, kind: "batch" as const } };
      const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce(batchResponse());
      const onSubmitted = vi.fn();
      render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1"
        candidate={candidate} preview={linked}
        repository={{ getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }),
          submitProjectValueBatchChangeRequest: submit } as unknown as ParameterCatalogRepository}
        fileRepository={{ getCandidateSourcePreview: vi.fn().mockResolvedValue(linked) }}
        conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ request: linked.request,
          items: [], ineligible: [] }) } as never}
        governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
          { userId: "reviewer-1", name: "Reviewer", roles: ["software-committer"], isActive: true }
        ] }) } as never} onDismiss={vi.fn()} onSubmitted={onSubmitted} />);
      const dialog = screen.getByRole("dialog");
      await within(dialog).findByText(/须重新获取来源和冲突证明/);
      fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "reason" } });
      const button = await within(dialog).findByRole("button", { name: /提交 \d+ 项审核|重试同一提交/ });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("同一请求重试");
      fireEvent.click(button);
      await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("new-batch"));
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
      expect(submit.mock.calls[0]![1].targetDecisions).toEqual(bindings.map((binding) => ({
        bindingId: binding.bindingId, choice: "file", expectedConflictProofs: []
      })));
    }
  );

  it("requires explicit file confirmation and submits each current draft proof", async () => {
    const linkedCandidate = { ...candidate, fileId: "file-1", baseVersionId: "version-1" };
    const linked = { ...preview, request: { id: "old-batch", status: "rejected" as const,
      kind: "batch" as const } };
    const conflicts = sourceConflicts(linked.request);
    const submit = vi.fn().mockRejectedValue(new Error("connection lost"));
    render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1"
      candidate={linkedCandidate} preview={linked}
      repository={{ getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }),
        submitProjectValueBatchChangeRequest: submit } as unknown as ParameterCatalogRepository}
      fileRepository={{ getCandidateSourcePreview: vi.fn().mockResolvedValue(linked) }}
      conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue(conflicts) } as never}
      governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { userId: "reviewer-1", name: "Reviewer", roles: ["software-committer"], isActive: true }
      ] }) } as never} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("radio", { name: /采用界面草稿 1.*另一位项目成员/ })).toBeVisible();
    fireEvent.click(within(dialog).getByText("溯源信息", { exact: true }));
    expect(await within(dialog).findByLabelText("完整溯源数据")).toHaveTextContent("other-author");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "retry" } });
    const button = await within(dialog).findByRole("button", { name: /提交 \d+ 项审核|重试同一提交/ });
    expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: "采用文件值" }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![1].targetDecisions).toEqual([
      { bindingId: "binding-a", choice: "file", expectedConflictProofs: [
        { draftId: "draft-1", decisionProofDigest: "a".repeat(64) }] },
      { bindingId: "binding-b", choice: "file", expectedConflictProofs: [] }
    ]);
  });

  it("requires a new proof and request ID after a definite 409", async () => {
    const linked = { ...preview, request: { id: "old-batch", status: "withdrawn" as const,
      kind: "batch" as const } };
    const refreshed = { ...linked, proofToken: "proof-2" };
    const getPreview = vi.fn().mockResolvedValueOnce(linked).mockResolvedValueOnce(refreshed);
    const submit = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "proof changed", {}, "request-1"));
    render(<CanonicalBatchSubmitDialog projectId="project-1" currentUserId="author-1"
      candidate={candidate} preview={linked}
      repository={{ getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }),
        submitProjectValueBatchChangeRequest: submit } as unknown as ParameterCatalogRepository}
      fileRepository={{ getCandidateSourcePreview: getPreview }}
      conflictClient={{ listCandidateSourceConflicts: vi.fn().mockResolvedValue({ request: linked.request,
        items: [], ineligible: [] }) } as never}
      governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { userId: "reviewer-1", name: "Reviewer", roles: ["software-committer"], isActive: true }
      ] }) } as never} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "retry" } });
    const button = await within(dialog).findByRole("button", { name: /提交 \d+ 项审核|重试同一提交/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await within(dialog).findByText(/来源过期或请求冲突（409）/);
    expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新核对提交内容" }));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]![1].expectedProofToken).toBe("proof-1");
    expect(submit.mock.calls[1]![1].expectedProofToken).toBe("proof-2");
    expect(submit.mock.calls[0]![2].idempotencyKey).not.toBe(submit.mock.calls[1]![2].idempotencyKey);
  });
});
