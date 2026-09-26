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
    baseCurrentValueId: `old-${bindingId}`, definitionId: "definition",
    action: "set", beforeText: "1", afterText: "2" }))
} as ManualSyncPreparation;
const context = { projectId: "project", fileId: "file", fileName: "source.json",
  format: "json" as const, currentVersionId: "current", workflowProofToken: "workflow" };

function uploadFile(dialog: HTMLElement, size = 8) {
  const file = new File([new Uint8Array(size)], "source.json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array(size).buffer });
  fireEvent.change(within(dialog).getByLabelText(/选择来源文件/), { target: { files: [file] } });
}

function show(prepared: ManualSyncPreparation = proof, prepareFailure: Error = new Error("connection lost")) {
  const prepare = vi.fn().mockRejectedValueOnce(prepareFailure).mockResolvedValue(prepared);
  const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValue({ id: "request", projectId: "project", candidateId: "candidate",
      status: "pending", batchProofDigest: digest, assignedToUserId: "reviewer",
      submitterUserId: "author", cohortCount: 2, sourceProofToken: "candidate-proof",
      cohortProofToken: "workflow", fileId: "file", baseVersionId: "current", configSetId: "set",
      targets: proof.targets.map((target, ordinal) => ({
        ordinal, bindingId: target.bindingId, action: target.action, sourcePinId: target.sourcePinId,
        targetText: target.afterText
      })) });
  const onSubmitted = vi.fn();
  render(<WorkbenchCanonicalManualSyncDialog context={{ ...context, currentUserId: "author",
    client: { prepare, submit } as never,
    governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { isActive: true, userId: "author", name: "Author", roles: ["software-committer"] },
      { isActive: true, userId: "reviewer", name: "Reviewer", roles: ["software-committer"] }
    ] }) } as never, onSubmitted }} onDismiss={vi.fn()} />);
  return { prepare, submit, onSubmitted };
}

describe("canonical manual sync dialog", () => {
  it("keeps a separate stable key and frozen body for each retry step", async () => {
    const { prepare, submit, onSubmitted } = show();
    const dialog = screen.getByRole("dialog", { name: "上传 JSON 来源并准备批量审核" });
    uploadFile(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "预览有序目标与证明" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试准备" }));
    expect(await within(dialog).findByRole("list", { name: "手动同步完整有序目标" })).toHaveTextContent("Binding");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "sync" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" }));
    await within(dialog).findByText(/可用同一请求重试/);
    fireEvent.click(within(dialog).getByRole("button", { name: "一次提交全部 2 项审核" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("request"));
    expect(prepare.mock.calls[1]).toEqual(prepare.mock.calls[0]);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(prepare.mock.calls[0][3]).not.toBe(submit.mock.calls[0][2]);
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
