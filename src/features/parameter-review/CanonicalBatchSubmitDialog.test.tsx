import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterFileCandidate, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
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
      governanceClient={governanceClient} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "提交 DTS 批量来源审核" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }),
      { target: { value: "校准" } });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "指定软件审核人" }))
      .toHaveValue("reviewer-1"));
    expect(within(dialog).getByRole("button", { name: /一次提交全部/ })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
});
