import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { initialState } from "@/mockData";
import { ReviewInbox } from "./ReviewInbox";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/parameter-review"); });

const digest = "a".repeat(64);
const common = { id: "request-1", projectId: "aurora", status: "pending", reason: "校准电压",
  submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null, reviewerNote: null,
  createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z" };
const target = { ordinal: 0, draftId: null, decision: "file", bindingId: "binding-1", definitionId: "definition",
  definitionRevisionId: "revision", catalogReleaseId: "release", baseCurrentValueId: "old-value",
  configRevisionId: "config-revision", sourceRef: "source", sourcePinId: "pin", action: "set", targetText: "4600" };
const members = ["removed", "retained"].map((fileId, sortOrder) => ({ fileId, fileVersionId: `version-${fileId}`,
  sourceName: `${fileId}.json`, format: "json", role: sortOrder ? "overlay" : "base", sortOrder,
  checksum: `checksum-${fileId}`, sizeBytes: 20 }));

function setup(kind: "single" | "batch" | "member") {
  const request = kind === "single" ? { ...common, bindingId: "binding-1", targetValue: "4600", action: "set",
    sourceFormat: "json", sourceTarget: { format: "json", sourceText: "4600" }, sourcePinId: "pin", candidateId: "candidate" }
    : kind === "batch" ? { ...common, candidateId: "candidate", batchProofDigest: digest, cohortCount: 1,
      draftImpactDigest: digest, draftImpact: [{ ...target, role: "target", drafts: [] }], targets: [target] }
      : { ...common, configSetId: "set", fileId: "removed", fileVersionId: "version-removed", proofDigest: digest,
        frozenProof: { kind: "canonical-member-removal", organizationId: "org", projectId: "aurora", configSetId: "set",
          fileId: "removed", fileVersionId: "version-removed", configRevisionId: "config-revision", members,
          cohort: members.map((member, index) => ({ bindingId: `binding-${index}`, oldValueId: `value-${index}`,
            sourcePinId: `pin-${index}`, sourceOccurrenceId: `occurrence-${index}`, definitionId: "definition",
            effectiveRevisionId: "revision", catalogReleaseId: "release", fileId: member.fileId,
            fileVersionId: member.fileVersionId, locator: { pointer: "/limit" }, valueDigest: `digest-${index}` })), proofDigest: digest } };
  let failure = false;
  const list = (include: boolean) => vi.fn(async () => {
    if (failure) throw new Error("offline");
    return { items: include ? [request] : [] };
  });
  const values = list(kind === "single"), batches = list(kind === "batch"), removals = list(kind === "member");
  const repo = { listProjectValueChangeRequests: values, listProjectValueBatchChangeRequests: batches,
    listMemberRemovalRequests: removals, getMemberRemovalRequest: vi.fn(async () => ({ item: request })),
    getProjectValueBatchChangeRequest: vi.fn(async () => ({ item: request })),
    getProjectValueChangeSourceDiff: vi.fn(async () => ({ item: { requestId: request.id,
      ...(kind === "batch" ? { kind: "batch", batchProofDigest: digest, targets: [{ ...target, beforeText: "4500", afterText: "4600" }] } : {}),
      candidateId: "candidate", format: "json", sourceName: "config.json", before: "4500", after: "4600",
      bindings: [{ bindingId: "binding-1", oldValueId: "old-value", sourcePinId: "pin" }] } })),
    reviewProjectValueChangeRequest: vi.fn(), reviewMemberRemovalRequest: vi.fn(), withdrawMemberRemovalRequest: vi.fn()
  } as unknown as ParameterCatalogRepository;
  const element = (userId = "reviewer") => <ReviewInbox projectId="aurora" repository={repo}
    state={{ ...initialState, currentUserId: userId }} canReview search="?request=request-1" legacyRows={[]}
    renderLegacyDetail={() => null} />;
  return { repo, values, batches, removals, element, fail: (value: boolean) => { failure = value; } };
}

describe("review inbox refresh with real detail panels", () => {
  it.each(["single", "batch", "member"] as const)("preserves a cancelled %s reason through refresh and failed refresh without writing", async (kind) => {
    const subject = setup(kind);
    render(subject.element());
    await act(async () => {});
    const rejection = kind === "batch" ? "驳回全部 1 项" : "驳回";
    fireEvent.click(await screen.findByRole("button", { name: rejection }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("驳回原因"), { target: { value: "补充验证依据" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    for (const failed of [false, true, false]) {
      const before = subject.values.mock.calls.length;
      subject.fail(failed);
      fireEvent.click(screen.getByRole("button", { name: "刷新队列" }));
      expect(screen.getByRole("table", { name: "审阅队列" })).toHaveTextContent("校准电压");
      await waitFor(() => expect(screen.getByRole("button", { name: "刷新队列" })).toBeEnabled());
      expect(subject.values.mock.calls.length).toBeGreaterThan(before);
      if (failed) {
        expect(screen.getByText(/队列未能更新，以下为上次读取的结果/)).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "待处理" })).toHaveTextContent("—");
        expect(screen.queryByRole("button", { name: rejection })).not.toBeInTheDocument();
      } else {
        fireEvent.click(await screen.findByRole("button", { name: rejection }));
        dialog = screen.getByRole("dialog");
        expect(within(dialog).getByLabelText("驳回原因")).toHaveValue("补充验证依据");
        fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
      }
    }
    expect(subject.repo.reviewProjectValueChangeRequest).not.toHaveBeenCalled();
    expect(subject.repo.reviewMemberRemovalRequest).not.toHaveBeenCalled();
    expect(subject.repo.getProjectValueChangeSourceDiff).toHaveBeenCalledTimes(kind === "member" ? 0 : 3);
    expect(subject.repo.getMemberRemovalRequest).toHaveBeenCalledTimes(kind === "member" ? 3 : 0);
  });

  it.each(["single", "batch", "member"] as const)("immediately hides %s details and clears the reason across accounts sharing an ID", async (kind) => {
    const subject = setup(kind);
    const mounted = render(subject.element());
    await act(async () => {});
    const rejection = kind === "batch" ? "驳回全部 1 项" : "驳回";
    fireEvent.click(await screen.findByRole("button", { name: rejection }));
    fireEvent.change(screen.getByLabelText("驳回原因"), { target: { value: "私人未提交原因" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
    mounted.rerender(subject.element("another-reviewer"));
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    await act(async () => {});
    mounted.rerender(subject.element());
    fireEvent.click(await screen.findByRole("button", { name: rejection }));
    expect(screen.getByLabelText("驳回原因")).toHaveValue("");
  });
});
