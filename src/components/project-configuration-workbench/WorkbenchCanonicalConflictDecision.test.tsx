import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createCanonicalConflictClient } from "@/infrastructure/http/canonicalConflictClient";
import { WorkbenchCanonicalConflictDecision } from "./WorkbenchCanonicalConflictDecision";

const digest = "a".repeat(64);
const candidate = { id: "candidate-1", status: "ready", fileId: "file-1", baseVersionId: "version-1",
  fileName: "config.json", format: "json" } as Parameters<typeof WorkbenchCanonicalConflictDecision>[0]["candidate"];
const preview = { kind: "canonical", candidateId: candidate.id, proofToken: "source-proof" } as
  Parameters<typeof WorkbenchCanonicalConflictDecision>[0]["preview"];
const baseProof = {
  candidateId: candidate.id, selectedBindingId: "binding-1", selectedDraftId: "draft-1",
  fileId: "file-1", baseVersionId: "version-1", configSetId: "set-1",
  sourceProofToken: "source-proof", cohortProofToken: "cohort-proof", sourceCandidateDigest: "candidate-digest",
  selectedDraftCandidateId: "draft-candidate", selectedDraftCandidateDigest: "draft-digest",
  selectedDraftProof: digest, selectedSourcePinId: "pin-1", selectedBaseValueId: "value-1",
  selectedRevisionId: "revision-1", action: "set", decisionProofDigest: digest,
  members: [{ memberId: "member-1", fileId: "file-1", fileVersionId: "version-1", sourceName: "config.json",
    format: "json", role: "base", sortOrder: 0, checksum: "checksum", sizeBytes: 10,
    configSetId: "set-1", isCandidateFile: true }],
  cohort: [{ bindingId: "binding-1", oldValueId: "value-1", sourcePinId: "pin-1",
    sourceOccurrenceId: "occurrence-1", definitionId: "definition-1", effectiveRevisionId: "revision-1",
    catalogReleaseId: "release-1", locator: {}, valueKind: "number", valueDigest: "value-digest",
    configSetId: "set-1" }]
};
const conflict = { selectedBindingId: "binding-1", selectedDraftId: "draft-1", authorUserId: "author-2",
  choices: { file: { ...baseProof, choice: "file", targetText: "50" },
    draft: { ...baseProof, choice: "draft", targetText: "99", decisionProofDigest: "b".repeat(64) } } };

function setup(items = [conflict]) {
  const submitCandidateSourceConflict = vi.fn().mockResolvedValue({ requestId: "request-1", status: "pending", replayed: true });
  const repository = { listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items, ineligible: [] }),
    submitCandidateSourceConflict } as unknown as ReturnType<typeof createCanonicalConflictClient>;
  const onSubmitted = vi.fn();
  render(<WorkbenchCanonicalConflictDecision projectId="project-1" currentUserId="author-1"
    candidate={candidate} preview={preview} repository={repository} allowed onSubmitted={onSubmitted}
    governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
      { userId: "reviewer-1", name: "审核员", isActive: true, roles: ["software-committer"] }
    ] }) } as never} />);
  return { submitCandidateSourceConflict, onSubmitted };
}

describe("WorkbenchCanonicalConflictDecision", () => {
  it("submits only the selected draft choice and navigates to a replayed request", async () => {
    const { submitCandidateSourceConflict, onSubmitted } = setup();
    fireEvent.click(await screen.findByRole("radio", { name: /保留界面草稿值/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "决策理由" }), { target: { value: "采用校准草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "提交所选一项人工审核" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("request-1"));
    expect(submitCandidateSourceConflict).toHaveBeenCalledWith("project-1", "candidate-1", {
      selectedBindingId: "binding-1", selectedDraftId: "draft-1", choice: "draft",
      expectedDecisionProofDigest: "b".repeat(64), reason: "采用校准草稿", assignedToUserId: "reviewer-1"
    });
  });

  it("blocks an incomplete proof while showing the other choice", async () => {
    const { submitCandidateSourceConflict } = setup([{ ...conflict,
      choices: { ...conflict.choices, draft: { ...conflict.choices.draft, targetText: undefined } } }]);
    expect(await screen.findByRole("radio", { name: /保留界面草稿值/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /使用文件值/ })).toBeEnabled();
    expect(submitCandidateSourceConflict).not.toHaveBeenCalled();
  });
});
