import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectParameterFileVersion } from "@/application/ports/ParameterFileRepository";
import type { BatchRollbackPreparation } from "@/infrastructure/http/canonicalBatchRollbackClient";
import { WorkbenchSourceRollbackDialog } from "./WorkbenchSourceRollbackDialog";

const digest = "a".repeat(64);
const version = { id: "history", versionNumber: 1 } as ProjectParameterFileVersion;
const proof = {
  kind: "canonical-source-batch", projectId: "project", fileId: "file",
  historicalVersionId: "history", expectedCurrentVersionId: "current", baseVersionId: "current",
  expectedWorkflowProofToken: "workflow", cohortProofToken: "workflow",
  candidateId: "candidate", proofToken: "candidate-proof", batchProofDigest: digest, format: "dts",
  members: [{ memberId: "member" }],
  cohort: ["a", "b"].map((bindingId) => ({ bindingId, sourcePinId: `pin-${bindingId}`,
    oldValueId: `old-${bindingId}`, definitionId: "definition" })),
  targets: ["a", "b"].map((bindingId) => ({ bindingId, sourcePinId: `pin-${bindingId}`,
    baseCurrentValueId: `old-${bindingId}`, definitionId: "definition",
    action: "set", beforeText: "1", afterText: "2" }))
} as BatchRollbackPreparation;

function show(prepared: BatchRollbackPreparation = proof, failFirstPrepare = false) {
  const prepare = failFirstPrepare
    ? vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(prepared)
    : vi.fn().mockResolvedValue(prepared);
  const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValue({ candidateId: "candidate", requestId: "review-request",
      batchProofDigest: digest, status: "pending", replayed: true });
  const onSubmitted = vi.fn();
  render(<WorkbenchSourceRollbackDialog open version={version} currentVersionId="current"
    pending={false} error="" onCancel={vi.fn()} onConfirm={vi.fn()}
    batch={{ projectId: "project", fileId: "file", currentUserId: "author",
      workflowProofToken: "workflow", client: { prepare, submit } as never,
      governanceClient: { getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { isActive: true, userId: "author", name: "Author", roles: ["software-committer"] },
        { isActive: true, userId: "reviewer", name: "Reviewer", roles: ["software-committer"] }
      ] }) } as never, onSubmitted }} />);
  return { prepare, submit, onSubmitted };
}

describe("historical multi-target rollback dialog", () => {
  it("shows the ordered DTS proof and reuses exact step keys on retry", async () => {
    const { prepare, submit, onSubmitted } = show();
    const dialog = screen.getByRole("dialog", { name: "提交多目标历史回滚审核" });
    expect(await within(dialog).findByRole("list", { name: "历史回滚完整有序目标" })).toHaveTextContent("Binding");
    expect(within(dialog).getByText(digest)).toBeVisible();
    expect(within(dialog).getByRole("combobox", { name: "指定软件审核人" })).toHaveValue("reviewer");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "来源回滚原因" }), {
      target: { value: "restore history" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交审核" }));
    await within(dialog).findByText(/可用同一请求重试/);
    expect(within(dialog).getByRole("textbox", { name: "来源回滚原因" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "提交审核" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("review-request"));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(prepare.mock.calls[0][3]).not.toBe(submit.mock.calls[0][3]);
  });

  it.each([
    ["missing", { ...proof, targets: proof.targets.slice(0, 1) }],
    ["reordered", { ...proof, targets: [...proof.targets].reverse() }],
    ["wrong cohort pin", { ...proof, cohort: [{ bindingId: "a", sourcePinId: "wrong" }, proof.cohort[1]!] }]
  ])("blocks %s preparation before submit", async (_case, prepared) => {
    const { submit } = show(prepared as BatchRollbackPreparation);
    const dialog = screen.getByRole("dialog", { name: "提交多目标历史回滚审核" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("不一致");
    expect(within(dialog).getByRole("button", { name: "提交审核" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("retries preparation with the same request ID and frozen selection", async () => {
    const { prepare, submit } = show(proof, true);
    const dialog = screen.getByRole("dialog", { name: "提交多目标历史回滚审核" });
    await within(dialog).findByText("准备历史回滚候选失败。");
    expect(within(dialog).getByRole("button", { name: "提交审核" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重试准备" }));
    await within(dialog).findByRole("list", { name: "历史回滚完整有序目标" });
    expect(prepare.mock.calls[1]).toEqual(prepare.mock.calls[0]);
    expect(submit).not.toHaveBeenCalled();
  });
});
