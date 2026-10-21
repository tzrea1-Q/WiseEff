import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterFileRepository, SourceRevisionRequest } from "@/application/ports/ParameterFileRepository";
import { SourceRevisionReviewPanel } from "./SourceRevisionReviewPanel";

const pending: SourceRevisionRequest = { id: "request", projectId: "project", candidateId: "candidate", fileId: "file", fileName: "board.dts",
  configSetId: "set", status: "pending", applicationMode: "separate_review", reason: "保留源码表达", submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null,
  reviewerNote: null, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", proofDigest: "a".repeat(64),
  impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0 },
  before: '/ { names = "", "same", "same"; values = /bits/ 64 <9007199254740993>; };\n',
  after: '/ { names = "", "same", "same"; values = /bits/ 64 <9007199254740993>; }; // comment\n' };

afterEach(cleanup);

function setup() {
  const { before: _before, after: _after, ...summary } = pending;
  const get = vi.fn(async () => pending);
  const review = vi.fn(async (_project: string, _id: string, input: { decision: "approve" | "reject"; proofDigest: string; note?: string }) => ({
    ...summary, status: input.decision === "approve" ? "approved" : "rejected", reviewerNote: input.note ?? null
  } as SourceRevisionRequest));
  const withdraw = vi.fn(async () => ({ ...summary, status: "withdrawn" } as SourceRevisionRequest));
  const repository = { getSourceRevisionRequest: get, reviewSourceRevisionRequest: review, withdrawSourceRevisionRequest: withdraw } as unknown as ParameterFileRepository;
  const changed = vi.fn(), busy = vi.fn();
  const element = (options: { userId?: string; canReview?: boolean; requestId?: string; refreshVersion?: number } = {}) => <SourceRevisionReviewPanel
    projectId="project" requestId={options.requestId ?? pending.id} repository={repository} currentUserId={options.userId ?? "reviewer"}
    canReview={options.canReview ?? true} refreshVersion={options.refreshVersion ?? 0} onRequestsChanged={changed} onBusyChange={busy} />;
  return { get, review, withdraw, changed, busy, element };
}

describe("whole-DTS source review", () => {
  it("labels an administrator's own application honestly without naming a separate reviewer", async () => {
    const f = setup();
    f.get.mockResolvedValue({ ...pending, status: "approved", applicationMode: "administrator_direct", assignedToUserId: null, submitterName: "管理员" });
    render(f.element({ userId: "author" }));
    expect(await screen.findByText("管理员本人直接应用 · 未经过独立审核")).toBeInTheDocument();
    expect(screen.queryByText(/指定软件审核人/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准并应用 DTS" })).not.toBeInTheDocument();
  });
  it("submits the exact frozen proof and trimmed note, preserving verified source after a summary-only receipt", async () => {
    const f = setup(); render(f.element());
    const approve = await screen.findByRole("button", { name: "批准并应用 DTS" });
    expect(screen.getByLabelText("DTS 来源变更后")).toHaveTextContent("9007199254740993");
    fireEvent.change(screen.getByLabelText("DTS 审核说明"), { target: { value: "  已核对固定差异  " } });
    fireEvent.click(approve);
    await waitFor(() => expect(f.review).toHaveBeenCalledWith("project", "request", { decision: "approve", proofDigest: pending.proofDigest, note: "已核对固定差异" }));
    await waitFor(() => expect(f.changed).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("DTS 来源变更后").textContent).toBe(pending.after);
    expect(screen.queryByText("固定来源差异不可用，不能批准。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准并应用 DTS" })).not.toBeInTheDocument();
  });

  it.each([{ userId: "viewer", canReview: false }, { userId: "unassigned", canReview: true }, { userId: "author", canReview: true }])("shows review actions only to a separate assigned reviewer: %o", async (options) => {
    const f = setup(); render(f.element(options));
    await screen.findByRole("heading", { name: "board.dts" });
    expect(screen.queryByRole("button", { name: "批准并应用 DTS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
    expect(f.review).not.toHaveBeenCalled();
    if (options.userId === "author") {
      fireEvent.click(screen.getByRole("button", { name: "撤回审核" }));
      await waitFor(() => expect(f.withdraw).toHaveBeenCalledWith("project", "request"));
      await waitFor(() => expect(f.changed).toHaveBeenCalledOnce());
      expect(screen.getByLabelText("DTS 来源变更后").textContent).toBe(pending.after);
    } else expect(screen.queryByRole("button", { name: "撤回审核" })).not.toBeInTheDocument();
  });

  it("allows explicit rejection but disables approval when verified before/after bytes are unavailable", async () => {
    const f = setup(); f.get.mockResolvedValue({ ...pending, before: undefined, after: undefined });
    render(f.element());
    expect(await screen.findByRole("button", { name: "批准并应用 DTS" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    await waitFor(() => expect(f.review).toHaveBeenCalledWith("project", "request", { decision: "reject", proofDigest: pending.proofDigest, note: undefined }));
  });

  it("unlocks a refreshed scope while an older operation is pending and ignores its late response", async () => {
    const f = setup();
    let resolveReview!: (request: SourceRevisionRequest) => void;
    f.review.mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    const mounted = render(f.element());
    fireEvent.click(await screen.findByRole("button", { name: "批准并应用 DTS" }));
    expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
    f.get.mockResolvedValue({ ...pending, id: "second", fileName: "second.dts", proofDigest: "b".repeat(64) });
    mounted.rerender(f.element({ requestId: "second", refreshVersion: 1 }));
    expect(await screen.findByRole("heading", { name: "second.dts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准并应用 DTS" })).toBeEnabled();
    await act(async () => { resolveReview({ ...pending, status: "approved" }); });
    expect(screen.getByRole("heading", { name: "second.dts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准并应用 DTS" })).toBeEnabled();
    expect(f.changed).not.toHaveBeenCalled();
  });
});
