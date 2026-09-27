import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ManualSyncPreparation } from "@/infrastructure/http/canonicalManualSyncClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { WorkbenchCanonicalManualSyncDialog, manualSyncProofReady } from "./WorkbenchCanonicalManualSyncDialog";

const digest = "a".repeat(64);
const proof = {
  kind: "canonical-source-batch", projectId: "project", fileId: "file", format: "json",
  baseVersionId: "current", cohortProofToken: "workflow", candidateId: "candidate",
  configSetId: "set",
  proofToken: "candidate-proof", batchProofDigest: digest, baseDigest: digest,
  proposedDigest: "b".repeat(64), members: [{ memberId: "member", fileId: "file", isCandidateFile: true }],
  cohort: ["a", "b"].map((bindingId) => ({ bindingId, sourcePinId: `pin-${bindingId}`,
    oldValueId: `old-${bindingId}`, definitionId: "definition" })),
  targets: ["a", "b"].map((bindingId) => ({ bindingId, sourcePinId: `pin-${bindingId}`,
    baseCurrentValueId: `old-${bindingId}`, definitionId: "definition", configRevisionId: "revision",
    action: "set", beforeText: "1", afterText: "2" }))
} as ManualSyncPreparation;
const context = { projectId: "project", fileId: "file", fileName: "source.json",
  format: "json" as const, currentVersionId: "current", workflowProofToken: "workflow" };

function uploadFile(dialog: HTMLElement, size = 8) {
  const file = new File([new Uint8Array(size)], "source.json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array(size).buffer });
  fireEvent.change(within(dialog).getByLabelText(/选择来源文件/), { target: { files: [file] } });
}

function show(prepared: ManualSyncPreparation = proof, prepareFailure: Error = new Error("connection lost"),
  sourceState?: { currentVersionId: string | null; workflowProofToken: string | null;
    loading: boolean; error: string; canonical: boolean | null }, unproven = false) {
  const prepare = vi.fn().mockRejectedValueOnce(prepareFailure).mockResolvedValue(prepared);
  const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValue({ id: "request", projectId: "project", candidateId: "candidate",
      status: "pending", batchProofDigest: digest, assignedToUserId: "reviewer",
      draftImpactDigest: digest, draftImpact: proof.cohort.map((entry, ordinal) => ({
        ordinal, bindingId: entry.bindingId, role: "target", decision: "file",
        baseCurrentValueId: entry.oldValueId, sourcePinId: entry.sourcePinId, drafts: []
      })), uploadCandidateId: null,
      decisionProofDigest: null, compositionProof: null,
      submitterUserId: "author", cohortCount: 2, sourceProofToken: "candidate-proof",
      cohortProofToken: "workflow", fileId: "file", baseVersionId: "current", configSetId: "set",
      targets: proof.targets.map((target, ordinal) => ({
        ordinal, bindingId: target.bindingId, action: target.action, sourcePinId: target.sourcePinId,
        targetText: target.afterText, decision: "file", draftId: null
      })) });
  const onSubmitted = vi.fn();
  const view = render(<WorkbenchCanonicalManualSyncDialog context={{ ...context, currentUserId: "author",
    client: { prepare, submit } as never,
    conflictClient: { listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: unproven
      ? [{ selectedBindingId: "a", selectedDraftId: "unproven", reason: "source-proof-stale" }] : [] }) } as never,
    governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { isActive: true, userId: "author", name: "Author", roles: ["software-committer"] },
      { isActive: true, userId: "reviewer", name: "Reviewer", roles: ["software-committer"] }
    ] }) } as never, onSubmitted }} sourceState={sourceState} onDismiss={vi.fn()} />);
  return { prepare, submit, onSubmitted, rerender: view.rerender };
}

describe("canonical manual sync dialog", () => {
  it.each([ ["json", "set", false], ["dts", "set", false], ["json", "delete", false],
    ["dts", "delete", false], ["json", "set", true] ] as const)(
    "checks ordered mixed %s decision with draft %s, stale preview %s", async (format, draftAction, stalePreview) => {
    const upload = { ...proof, format, cohort: [...proof.cohort, {
      ...proof.cohort[0]!, bindingId: "sibling", sourcePinId: "pin-sibling"
    }], targets: proof.targets.map((target, index) => ({ ...target,
      beforeText: String(10 + index * 10), afterText: String(50 + index * 10)
    })) } as ManualSyncPreparation;
    const conflict = { selectedBindingId: "a", selectedDraftId: "draft-88", authorUserId: "other-author",
      choices: {
        file: { candidateId: "candidate", sourceProofToken: "candidate-proof",
          selectedBindingId: "a", selectedDraftId: "draft-88", targetText: "50", choice: "file",
          action: "set", fileId: "file", baseVersionId: "current", configSetId: "set",
          selectedDraftProof: digest, selectedDraftCandidateId: "draft-candidate",
          selectedDraftCandidateDigest: `sha256:${"e".repeat(64)}`, decisionProofDigest: "1".repeat(64),
          cohortProofToken: "workflow", sourceCandidateDigest: upload.proposedDigest,
          selectedSourcePinId: "pin-a", selectedBaseValueId: "old-a", selectedRevisionId: "revision",
          members: upload.members, cohort: upload.cohort },
        draft: { candidateId: "candidate", sourceProofToken: "candidate-proof",
          selectedBindingId: "a", selectedDraftId: "draft-88",
          ...(draftAction === "set" ? { targetText: "88" } : {}), action: draftAction,
          choice: "draft", fileId: "file", baseVersionId: "current", configSetId: "set",
          selectedDraftProof: digest, selectedDraftCandidateId: "draft-candidate",
          decisionProofDigest: "2".repeat(64),
          cohortProofToken: "workflow", sourceCandidateDigest: upload.proposedDigest,
          selectedSourcePinId: "pin-a", selectedBaseValueId: "old-a", selectedRevisionId: "revision",
          selectedDraftCandidateDigest: `sha256:${"e".repeat(64)}`,
          members: upload.members, cohort: upload.cohort }
      } };
    const composition = { uploadCandidateId: "candidate", composedCandidateId: "composed",
      uploadObject: { proofToken: "candidate-proof" }, composedObject: { proofToken: "composed-proof" },
      cohortProofToken: "workflow", batchProofDigest: "b".repeat(64),
      draftImpactDigest: digest, decisionProofDigest: "c".repeat(64),
      members: upload.members, cohort: upload.cohort,
      targetDecisions: [{ ordinal: 0, bindingId: "a", choice: "draft", draft: { id: "draft-88",
        authorUserId: "other-author", baseCurrentValueId: "old-a", sourcePinId: "pin-a",
        configRevisionId: "revision", candidateSha256: "e".repeat(64) },
        action: draftAction, targetText: draftAction === "set" ? "88" : null },
        { ordinal: 1, bindingId: "b", choice: "file", draft: null, action: "set", targetText: "60" }] };
    if (stalePreview) {
      conflict.choices.file.selectedDraftCandidateDigest = `sha256:${"f".repeat(64)}`;
      conflict.choices.draft.selectedDraftCandidateDigest = `sha256:${"f".repeat(64)}`;
    }
    const second = structuredClone(conflict);
    second.selectedDraftId = "draft-99";
    second.authorUserId = "second-author";
    second.choices.file.selectedDraftId = "draft-99";
    second.choices.draft.selectedDraftId = "draft-99";
    second.choices.file.selectedDraftCandidateId = "draft-candidate-99";
    second.choices.draft.selectedDraftCandidateId = "draft-candidate-99";
    second.choices.file.selectedDraftCandidateDigest = `sha256:${"9".repeat(64)}`;
    second.choices.draft.selectedDraftCandidateDigest = `sha256:${"9".repeat(64)}`;
    second.choices.file.decisionProofDigest = "3".repeat(64);
    second.choices.draft.decisionProofDigest = "4".repeat(64);
    second.choices.draft.targetText = "99";
    const prepare = vi.fn().mockResolvedValue(upload);
    const submit = vi.fn().mockResolvedValue({ id: "mixed-request", projectId: "project", candidateId: "composed",
      uploadCandidateId: "candidate", compositionProof: composition, decisionProofDigest: "c".repeat(64),
      draftImpactDigest: digest, draftImpact: upload.cohort.map((entry, ordinal) => ({
        ordinal, bindingId: entry.bindingId, role: ordinal === 2 ? "sibling" : "target",
        decision: ordinal === 0 ? "draft" : ordinal === 1 ? "file" : "re-pin",
        ...(ordinal === 0 ? { selectedDraftId: "draft-88" } : {}),
        baseCurrentValueId: entry.oldValueId, sourcePinId: entry.sourcePinId, drafts: []
      })),
      status: "pending", batchProofDigest: "b".repeat(64), cohortCount: 3,
      sourceProofToken: "composed-proof", cohortProofToken: "workflow", fileId: "file",
      baseVersionId: "current", configSetId: "set", assignedToUserId: "reviewer", submitterUserId: "author",
      targets: upload.targets.map((target, ordinal) => ({ ordinal, bindingId: target.bindingId,
        action: ordinal === 0 ? draftAction : "set", sourcePinId: target.sourcePinId,
        targetText: ordinal === 0 ? draftAction === "set" ? "88" : null : "60",
        decision: ordinal === 0 ? "draft" : "file", draftId: ordinal === 0 ? "draft-88" : null })) });
    const onSubmitted = vi.fn();
    render(<WorkbenchCanonicalManualSyncDialog context={{ ...context, format, currentUserId: "author",
      client: { prepare, submit } as never,
      conflictClient: { listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [conflict, second], ineligible: [] }) } as never,
      governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { isActive: true, userId: "reviewer", name: "Reviewer", roles: ["software-committer"] }
      ] }) } as never, onSubmitted }} onDismiss={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    expect(await within(dialog).findByText("other-author")).toBeVisible();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "sync" } });
    const send = within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" });
    expect(send).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: /采用界面草稿.*draft-88/ }));
    fireEvent.click(within(dialog).getAllByRole("radio", { name: /采用文件值/ })[1]!);
    expect(send).toBeEnabled();
    fireEvent.click(send);
    if (stalePreview) {
      expect(await within(dialog).findByText(/服务端冻结请求与预览目标或证明不一致/)).toBeVisible();
      expect(onSubmitted).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("mixed-request"));
    }
    expect(submit.mock.calls[0]![1].targetDecisions).toEqual([
      { bindingId: "a", choice: "draft", draftId: "draft-88", expectedConflictProofs: [
        { draftId: "draft-88", decisionProofDigest: "2".repeat(64) },
        { draftId: "draft-99", decisionProofDigest: "3".repeat(64) }
      ] },
      { bindingId: "b", choice: "file" }
    ]);
    expect(prepare.mock.calls[0]![3]).not.toBe(submit.mock.calls[0]![2]);
  });
  it("keeps a separate stable key and frozen body for each retry step", async () => {
    const { prepare, submit, onSubmitted } = show();
    const dialog = screen.getByRole("dialog", { name: "上传 JSON 来源并准备批量审核" });
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试准备" }));
    expect(await within(dialog).findByRole("list", { name: "手动同步完整有序目标" })).toHaveTextContent("Binding");
    within(dialog).getAllByRole("radio", { name: /采用文件值/ }).forEach((choice) => fireEvent.click(choice));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "sync" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("request"));
    expect(prepare.mock.calls[1]).toEqual(prepare.mock.calls[0]);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(prepare.mock.calls[0][3]).not.toBe(submit.mock.calls[0][2]);
  });

  it("keeps the upload and choice across a source refresh, then blocks an old proof", async () => {
    const stable = { currentVersionId: "current", workflowProofToken: "workflow",
      loading: false, error: "", canonical: true };
    const { prepare, submit, rerender } = show(proof, new Error("connection lost"), stable);
    const dialog = screen.getByRole("dialog");
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试准备" }));
    await within(dialog).findByRole("list", { name: "手动同步完整有序目标" });
    fireEvent.click(within(dialog).getAllByRole("radio", { name: /采用文件值/ })[0]!);
    fireEvent.click(within(dialog).getAllByRole("radio", { name: /采用文件值/ })[1]!);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "sync" } });
    const currentContext = { ...context, currentUserId: "author", client: { prepare, submit } as never,
      conflictClient: { listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: [] }) } as never,
      governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { isActive: true, userId: "reviewer", name: "Reviewer", roles: ["software-committer"] }
      ] }) } as never, onSubmitted: vi.fn() };
    // Rerender the same dialog instance as the workbench refreshes its workflow proof.
    rerender(<WorkbenchCanonicalManualSyncDialog context={currentContext}
      sourceState={{ ...stable, loading: true, workflowProofToken: null }} onDismiss={vi.fn()} />);
    expect(within(dialog).getByText(/已选择：source.json/)).toBeVisible();
    expect(within(dialog).getAllByRole("radio", { name: /采用文件值/ })[0]).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" })).toBeDisabled();
    rerender(<WorkbenchCanonicalManualSyncDialog context={currentContext}
      sourceState={stable} onDismiss={vi.fn()} />);
    expect(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" })).toBeEnabled();
    rerender(<WorkbenchCanonicalManualSyncDialog context={currentContext}
      sourceState={{ ...stable, currentVersionId: "new-version" }} onDismiss={vi.fn()} />);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("旧候选不能继续提交");
    expect(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" })).toBeDisabled();
    rerender(<WorkbenchCanonicalManualSyncDialog context={currentContext}
      sourceState={stable} onDismiss={vi.fn()} />);
    expect(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks submission when a current competing draft has no choice proof", async () => {
    const { submit } = show(proof, new Error("connection lost"), undefined, true);
    const dialog = screen.getByRole("dialog");
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试准备" }));
    await within(dialog).findByRole("list", { name: "手动同步完整有序目标" });
    for (const radio of within(dialog).getAllByRole("radio", { name: /采用文件值/ })) fireEvent.click(radio);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "sync" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("未取得可验证的选择证明");
    expect(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects oversized files and incomplete or reordered target proofs", async () => {
    expect(manualSyncProofReady(proof, context)).toBe(true);
    expect(manualSyncProofReady({ ...proof, cohort: [...proof.cohort, {
      ...proof.cohort[0]!, bindingId: "sibling", sourcePinId: "pin-sibling"
    }] }, context)).toBe(true);
    expect(manualSyncProofReady({ ...proof, targets: [proof.targets[0]!] }, context)).toBe(false);
    expect(manualSyncProofReady({ ...proof, targets: [...proof.targets].reverse() }, context)).toBe(false);
    const { prepare, submit } = show();
    const dialog = screen.getByRole("dialog", { name: "上传 JSON 来源并准备批量审核" });
    uploadFile(dialog, 2 * 1024 * 1024 + 1);
    expect(within(dialog).getByRole("button", { name: "预览有序目标与证明" })).toBeDisabled();
    expect(prepare).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows a permission refusal without retrying under another identity", async () => {
    const { submit } = show(proof, new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "request"));
    const dialog = screen.getByRole("dialog", { name: "上传 JSON 来源并准备批量审核" });
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("没有权限执行该操作");
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains a one-target file within a larger configuration set", async () => {
    const { submit } = show(proof, new WiseEffApiError("CONFLICT", "No multi-Binding change",
      { reason: "canonical-batch-writer-unavailable" }, "request"));
    const dialog = screen.getByRole("dialog", { name: "上传 JSON 来源并准备批量审核" });
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("当前文件未形成至少两个可验证的变更目标");
    expect(submit).not.toHaveBeenCalled();
  });
});
