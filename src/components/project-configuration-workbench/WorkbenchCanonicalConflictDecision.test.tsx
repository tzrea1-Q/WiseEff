import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalSourceConflictList, CanonicalSourceConflictSubmitResult, createCanonicalConflictClient } from "@/infrastructure/http/canonicalConflictClient";
import { WorkbenchCanonicalConflictDecision } from "./WorkbenchCanonicalConflictDecision";

const digest = "a".repeat(64);
const candidate = { id: "candidate-1", status: "ready", fileId: "file-1", baseVersionId: "version-1",
  fileName: "config.json", format: "json" } as Parameters<typeof WorkbenchCanonicalConflictDecision>[0]["candidate"];
const preview = { kind: "canonical", candidateId: candidate.id, proofToken: "source-proof" } as
  Parameters<typeof WorkbenchCanonicalConflictDecision>[0]["preview"];
const baseProof: Omit<CanonicalSourceConflictList["items"][number]["choices"]["file"], "choice" | "targetText"> = {
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
const conflict: CanonicalSourceConflictList["items"][number] = { selectedBindingId: "binding-1", selectedDraftId: "draft-1", authorUserId: "author-2",
  choices: { file: { ...baseProof, choice: "file", targetText: "50" },
    draft: { ...baseProof, choice: "draft", targetText: "99", decisionProofDigest: "b".repeat(64) } } };

function setup(items: CanonicalSourceConflictList["items"] = [conflict], overrides: Partial<Parameters<typeof WorkbenchCanonicalConflictDecision>[0]> = {}) {
  const submitCandidateSourceConflict = vi.fn<ReturnType<typeof createCanonicalConflictClient>["submitCandidateSourceConflict"]>()
    .mockResolvedValue({ requestId: "request-1", status: "pending", replayed: true });
  const listCandidateSourceConflicts = vi.fn().mockResolvedValue({ items, ineligible: [] });
  const loadReviewers = vi.fn().mockResolvedValue({ bindings: [
    { userId: "reviewer-1", name: "审核员", isActive: true, roles: ["software-committer"] }
  ] });
  const repository: ReturnType<typeof createCanonicalConflictClient> = { listCandidateSourceConflicts,
    submitCandidateSourceConflict };
  const onSubmitted = vi.fn();
  const props: Parameters<typeof WorkbenchCanonicalConflictDecision>[0] = { projectId: "project-1", currentUserId: "author-1",
    candidate, preview, repository, allowed: true, onSubmitted,
    governanceClient: { getProjectWorkflowRoleBindings: loadReviewers } as never, ...overrides };
  const view = render(<WorkbenchCanonicalConflictDecision {...props} />);
  return { submitCandidateSourceConflict, onSubmitted, listCandidateSourceConflicts, loadReviewers, props, rerender: view.rerender };
}

describe("WorkbenchCanonicalConflictDecision", () => {
  it("keeps the previous empty-conflict presentation for callers without an inline target", async () => {
    setup([]);
    expect(await screen.findByText("当前候选没有来源冲突。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新核对冲突" })).toBeInTheDocument();
  });

  it("mounts loads before the portal exists and submits one empty-conflict form with its selected reviewer", async () => {
    const onSubmitWithoutConflict = vi.fn().mockResolvedValue(undefined);
    const { props, rerender, listCandidateSourceConflicts, submitCandidateSourceConflict } = setup([], {
      inlineTarget: null, preview: { ...preview, canSubmit: true }, onSubmitWithoutConflict
    });
    await waitFor(() => expect(listCandidateSourceConflicts).toHaveBeenCalledOnce());
    expect(screen.queryByRole("region", { name: "来源变更审核" })).not.toBeInTheDocument();
    const inlineTarget = render(<div />).container;
    rerender(<WorkbenchCanonicalConflictDecision {...props} inlineTarget={inlineTarget} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "修改原因" }), { target: { value: "  更新配置  " } });
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer-1");
    expect(screen.queryByText("来源冲突：一次选择一项")).not.toBeInTheDocument();
    expect(screen.queryByText("当前候选没有来源冲突。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新核对冲突" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => expect(onSubmitWithoutConflict).toHaveBeenCalledExactlyOnceWith("更新配置", "reviewer-1"));
    expect(submitCandidateSourceConflict).not.toHaveBeenCalled();
    expect(listCandidateSourceConflicts).toHaveBeenCalledOnce();
  });

  it("keeps inline conflict choices in the same reviewer form and never uses ordinary submit", async () => {
    const onSubmitWithoutConflict = vi.fn();
    const { submitCandidateSourceConflict } = setup([conflict], { inlineTarget: render(<div />).container, onSubmitWithoutConflict });
    fireEvent.click(await screen.findByRole("radio", { name: /保留界面草稿值/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "采用草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => expect(submitCandidateSourceConflict).toHaveBeenCalledOnce());
    expect(onSubmitWithoutConflict).not.toHaveBeenCalled();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("combobox", { name: "指定软件审核人" })).toHaveLength(1);
  });

  it("prevents switching to a batch while its single conflict is submitting", async () => {
    let finish!: (result: CanonicalSourceConflictSubmitResult) => void;
    const onReturnToBatch = vi.fn();
    const { submitCandidateSourceConflict } = setup([conflict], {
      inlineTarget: render(<div />).container, onReturnToBatch
    });
    submitCandidateSourceConflict.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(await screen.findByRole("radio", { name: /保留界面草稿值/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "采用草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    const back = screen.getByRole("button", { name: "返回整批更新" });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onReturnToBatch).not.toHaveBeenCalled();
    await act(async () => { finish({ requestId: "request-1", status: "pending", replayed: false }); });
    expect(back).toBeEnabled();
  });

  it("does not expose ordinary submit while reviewers are still loading after an empty conflict result", async () => {
    let finishReviewers!: () => void;
    const gate = new Promise<void>((resolve) => { finishReviewers = resolve; });
    const loadReviewers = vi.fn(async () => { await gate; return { bindings: [
      { userId: "reviewer-1", name: "审核员", isActive: true, roles: ["software-committer"] }
    ] }; });
    const onSubmitWithoutConflict = vi.fn();
    setup([], { inlineTarget: render(<div />).container, preview: { ...preview, canSubmit: true }, onSubmitWithoutConflict,
      governanceClient: { getProjectWorkflowRoleBindings: loadReviewers } as never });
    await waitFor(() => expect(screen.queryByText("正在读取来源冲突…")).not.toBeInTheDocument());
    expect(screen.getByText("正在加载审核人…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
    expect(onSubmitWithoutConflict).not.toHaveBeenCalled();
    await act(async () => { finishReviewers(); });
    expect(await screen.findByRole("textbox", { name: "修改原因" })).toBeInTheDocument();
  });

  it("does not offer ordinary submission for ineligible conflicts", async () => {
    const onSubmitWithoutConflict = vi.fn();
    setup([], { inlineTarget: render(<div />).container, onSubmitWithoutConflict, repository: {
      listCandidateSourceConflicts: vi.fn().mockResolvedValue({ items: [], ineligible: [
        { selectedBindingId: "binding-2", selectedDraftId: "draft-2", reason: "source-proof-stale" }
      ] }), submitCandidateSourceConflict: vi.fn()
    } });
    expect(await screen.findByText(/暂不可选，请重新核对来源与候选/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
    expect(onSubmitWithoutConflict).not.toHaveBeenCalled();
  });

  it.each(["conflicts", "reviewers"])("keeps inline ordinary submission blocked on %s failure until a successful recheck", async (failedRequest) => {
    const onSubmitWithoutConflict = vi.fn();
    const listCandidateSourceConflicts = vi.fn().mockResolvedValue({ items: [], ineligible: [] });
    const loadReviewers = vi.fn().mockResolvedValue({ bindings: [] });
    (failedRequest === "conflicts" ? listCandidateSourceConflicts : loadReviewers).mockRejectedValueOnce(new Error("network failed"));
    setup([], { inlineTarget: render(<div />).container, onSubmitWithoutConflict,
      repository: { listCandidateSourceConflicts, submitCandidateSourceConflict: vi.fn() },
      governanceClient: { getProjectWorkflowRoleBindings: loadReviewers } as never });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "重新核对冲突" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
    expect(onSubmitWithoutConflict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新核对冲突" }));
    expect(await screen.findByRole("textbox", { name: "修改原因" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });

  it.each(["pending", "approved"] as const)("offers only the existing %s review receipt instead of another inline submit", async (status) => {
    const { onSubmitted } = setup([], { inlineTarget: render(<div />).container,
      preview: { ...preview, request: { id: "existing-review", kind: "single", status } } });
    fireEvent.click(screen.getByRole("button", { name: "查看已有审核" }));
    expect(onSubmitted).toHaveBeenCalledExactlyOnceWith("existing-review");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交审核" })).not.toBeInTheDocument();
    await act(async () => {});
  });

  it.each(["conflicts", "reviewers"])("separates %s failure and keeps the reason on recheck", async (failedRequest) => {
    const { listCandidateSourceConflicts, loadReviewers, submitCandidateSourceConflict } = setup();
    await screen.findByRole("radio", { name: /保留界面草稿值/ });
    await waitFor(() => expect(screen.getByRole("button", { name: "重新核对冲突" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "决策理由" }), { target: { value: "保留决策理由" } });
    (failedRequest === "conflicts" ? listCandidateSourceConflicts : loadReviewers).mockRejectedValueOnce(new Error("network failed"));
    fireEvent.click(screen.getByRole("button", { name: "重新核对冲突" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failedRequest === "conflicts" ? "加载来源冲突失败" : "加载软件审核人失败");
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer-1");
    expect(screen.queryByRole("link", { name: "配置审核角色" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交所选一项人工审核" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新核对冲突" }));
    fireEvent.click(await screen.findByRole("radio", { name: /保留界面草稿值/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交所选一项人工审核" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "决策理由" })).toHaveValue("保留决策理由");
    expect(submitCandidateSourceConflict).not.toHaveBeenCalled();
  });
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
