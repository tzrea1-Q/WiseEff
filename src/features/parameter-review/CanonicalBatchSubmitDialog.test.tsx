import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterFileCandidate, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { CanonicalBatchSubmitDialog } from "./CanonicalBatchSubmitDialog";

const candidate = { id: "candidate-1", projectId: "project-1", fileName: "config.dts",
  format: "dts", status: "ready", diagnostics: [], impact: {}, blockers: [],
  createdAt: "2026-09-24", updatedAt: "2026-09-24" } as ParameterFileCandidate;
const bindings = ["binding-a", "binding-b"].map((bindingId) => ({
  bindingId, definitionId: "definition-1", baseCurrentValueId: "value-1",
  configRevisionId: "revision-1", sourcePinId: `pin-${bindingId}`,
  locator: `/node/${bindingId}`, baseDigest: "before", proposedDigest: "after",
  action: "set" as const, beforeText: "<36>", afterText: "<77>"
}));
const preview: ParameterFileSourcePreview = { kind: "canonical", canSubmit: true,
  candidateId: candidate.id, format: "dts", proofToken: "proof-1", bindings };

describe("canonical DTS batch submit dialog", () => {
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
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "指定软件审核人" }))
      .toHaveValue("reviewer-1"));
    expect(within(dialog).getByRole("button", { name: /一次提交全部/ })).toBeDisabled();
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
      expect(within(dialog).getByRole("button", { name: /一次提交全部/ })).toBeDisabled();
      expect(submit).not.toHaveBeenCalled();
    }
  );

  it.each(["rejected", "withdrawn"] as const)(
    "allows a fresh %s batch request with empty conflict items and replays an uncertain network result", async (status) => {
      const linked = { ...preview, request: { id: "old-batch", status, kind: "batch" as const } };
      const submit = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({ item: {
        id: "new-batch", status: "pending", candidateId: candidate.id, assignedToUserId: "reviewer-1",
        submitterUserId: "author-1", batchProofDigest: "a".repeat(64), cohortCount: 2,
        targets: bindings.map((binding, ordinal) => ({ ordinal, bindingId: binding.bindingId,
          action: binding.action, sourcePinId: binding.sourcePinId, targetText: binding.afterText }))
      } });
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
      const button = within(dialog).getByRole("button", { name: /一次提交全部/ });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await within(dialog).findByText(/同一请求重试/);
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
    const choice = { candidateId: candidate.id, selectedBindingId: "binding-a",
      selectedDraftId: "draft-1", sourceProofToken: "proof-1", fileId: "file-1",
      baseVersionId: "version-1", selectedSourcePinId: "pin-binding-a",
      selectedBaseValueId: "value-1", selectedRevisionId: "revision-1",
      action: "set" as const, targetText: "<77>", decisionProofDigest: "a".repeat(64) };
    const conflicts = { request: linked.request, items: [{ selectedBindingId: "binding-a",
      selectedDraftId: "draft-1", authorUserId: "other-author",
      choices: { file: choice, draft: { ...choice, action: "set", targetText: "<88>" } } }],
    ineligible: [] };
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
    expect(await within(dialog).findByText("other-author")).toBeVisible();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "retry" } });
    const button = within(dialog).getByRole("button", { name: /一次提交全部/ });
    expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /确认此目标采用文件值/ }));
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
    const button = within(dialog).getByRole("button", { name: /一次提交全部/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await within(dialog).findByText(/来源过期或请求冲突（409）/);
    expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新来源与冲突证明" }));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]![1].expectedProofToken).toBe("proof-1");
    expect(submit.mock.calls[1]![1].expectedProofToken).toBe("proof-2");
    expect(submit.mock.calls[0]![2].idempotencyKey).not.toBe(submit.mock.calls[1]![2].idempotencyKey);
  });
});
