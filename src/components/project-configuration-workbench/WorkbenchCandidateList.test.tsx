import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterFileCandidate, ParameterFileSourceReviewStatus } from "@/application/ports/ParameterFileRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { WorkbenchCandidateList, useWorkbenchCandidates } from "./WorkbenchCandidateList";

afterEach(cleanup);

function candidate(id: string, overrides: Partial<ParameterFileCandidate> = {}): ParameterFileCandidate {
  return {
    id, projectId: "project-1", fileId: "file-1", fileName: `${id}.dts`, format: "dts", status: "ready",
    diagnostics: [], impact: {}, blockers: [], createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
    ...overrides
  };
}

function review(id: string, candidateId: string | null, status: ParameterFileSourceReviewStatus,
  overrides: { projectId?: string; createdAt?: string; updatedAt?: string; uploadCandidateId?: string | null } = {}) {
  return { id, projectId: "project-1", candidateId, status,
    createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z", ...overrides };
}

function CandidateHarness({ selectedId, onSelect, ...options }: Parameters<typeof useWorkbenchCandidates>[0] & {
  selectedId: string | null;
  onSelect: (item: ParameterFileCandidate) => void;
}) {
  const state = useWorkbenchCandidates(options);
  return <WorkbenchCandidateList state={state} selectedId={selectedId} onSelect={onSelect} />;
}

describe("WorkbenchCandidateList", () => {
  it("indexes single and mixed batch receipts once per project, including the original upload", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([candidate("upload"), candidate("ordinary")]) };
    const reviewRepository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [review("single", "ordinary", "pending"),
        review("foreign", "foreign", "approved", { projectId: "project-2" }), review("not-file", null, "approved"),
        { ...review("unknown-status", "unknown", "pending"), status: "unknown" }] }),
      listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [
        review("mixed", "composed", "approved", { uploadCandidateId: "upload" })] })
    };
    const { result } = renderHook(() => useWorkbenchCandidates({ projectId: "project-1", repository, reviewRepository }));
    await waitFor(() => expect(result.current.reviewStatusById).toEqual({ ordinary: "pending", composed: "approved", upload: "approved" }));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.reviewStatusError).toBe("");
    expect(reviewRepository.listProjectValueChangeRequests).toHaveBeenCalledExactlyOnceWith("project-1", { mine: true });
    expect(reviewRepository.listProjectValueBatchChangeRequests).toHaveBeenCalledExactlyOnceWith("project-1", { mine: true });
    render(<WorkbenchCandidateList state={result.current} selectedId="upload" reviewStatusById={result.current.reviewStatusById} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /upload.dts/ })).toHaveTextContent("审核通过");
    expect(screen.getByRole("button", { name: /ordinary.dts/ })).toHaveTextContent("待审核");
  });

  it("matches preview receipt priority across both request kinds, then prefers the latest timestamp and ID", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([]) };
    const reviewRepository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [
        review("old-pending", "pending-first", "pending"),
        review("old-approved", "approved-first", "approved"),
        review("older", "latest", "rejected"),
        review("created", "created-only", "rejected"),
        review("aaa", "tie", "rejected")
      ] }),
      listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [
        review("new-approved", "pending-first", "approved", { updatedAt: "2026-10-18T00:00:00Z" }),
        review("new-withdrawn", "approved-first", "withdrawn", { updatedAt: "2026-10-18T00:00:00Z" }),
        review("updated", "latest", "withdrawn", { updatedAt: "2026-10-19T00:00:00Z" }),
        { ...review("new-created", "created-only", "withdrawn", { createdAt: "2026-10-20T00:00:00Z" }), updatedAt: undefined },
        review("zzz", "tie", "withdrawn")
      ] })
    };
    const { result } = renderHook(() => useWorkbenchCandidates({ projectId: "project-1", repository, reviewRepository }));
    await waitFor(() => expect(result.current.reviewStatusById).toEqual({
      "pending-first": "pending", "approved-first": "approved", latest: "withdrawn", "created-only": "withdrawn", tie: "withdrawn"
    }));
  });

  it.each(["success", "failure"] as const)("clears the status index on project changes and ignores the old %s", async (oldResult) => {
    let resolveOld!: (value: { items: ReturnType<typeof review>[] }) => void;
    let rejectOld!: (cause: Error) => void;
    const repository = { listCandidates: vi.fn().mockResolvedValue([]) };
    const reviewRepository = {
      listProjectValueChangeRequests: vi.fn().mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
        .mockResolvedValueOnce({ items: [review("current", "current-candidate", "approved", { projectId: "project-2" })] }),
      listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [] })
    };
    const { result, rerender } = renderHook(({ projectId }) => useWorkbenchCandidates({ projectId, repository, reviewRepository }),
      { initialProps: { projectId: "project-1" } });
    rerender({ projectId: "project-2" });
    expect(result.current.reviewStatusById).toEqual({});
    await waitFor(() => expect(result.current.reviewStatusById).toEqual({ "current-candidate": "approved" }));
    await act(async () => {
      if (oldResult === "success") resolveOld({ items: [review("old", "old-candidate", "pending")] });
      else rejectOld(new Error("old project denied"));
    });
    expect(result.current.reviewStatusById).toEqual({ "current-candidate": "approved" });
    expect(result.current.reviewStatusError).toBe("");
  });

  it("clears an already loaded old project index while the next project's requests are pending", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([]) };
    const reviewRepository = { listProjectValueChangeRequests: vi.fn()
      .mockResolvedValueOnce({ items: [review("old", "old-candidate", "approved")] })
      .mockImplementationOnce(() => new Promise(() => {})) };
    const { result, rerender } = renderHook(({ projectId }) => useWorkbenchCandidates({ projectId, repository, reviewRepository }),
      { initialProps: { projectId: "project-1" } });
    await waitFor(() => expect(result.current.reviewStatusById).toEqual({ "old-candidate": "approved" }));
    rerender({ projectId: "project-2" });
    expect(result.current.reviewStatusById).toEqual({});
    expect(result.current.reviewStatusError).toBe("");
  });

  it("keeps candidates usable when either receipt list fails and retries both without inventing a partial status", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([candidate("upload")]) };
    const reviewRepository = {
      listProjectValueChangeRequests: vi.fn().mockRejectedValueOnce(new WiseEffApiError("FORBIDDEN", "denied", {}, "request"))
        .mockResolvedValue({ items: [] }),
      listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [
        review("mixed", "composed", "approved", { uploadCandidateId: "upload" })] })
    };
    const { result, rerender } = renderHook(({ reloadToken }) => useWorkbenchCandidates({ projectId: "project-1", repository, reviewRepository, reloadToken }),
      { initialProps: { reloadToken: "before" } });
    await waitFor(() => expect(result.current.reviewStatusError).not.toBe(""));
    expect(result.current.items).toEqual([candidate("upload")]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
    expect(result.current.reviewStatusById).toEqual({});
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.reviewStatusById).toEqual({ composed: "approved", upload: "approved" }));
    expect(result.current.reviewStatusError).toBe("");
    expect(reviewRepository.listProjectValueChangeRequests).toHaveBeenCalledTimes(2);
    expect(reviewRepository.listProjectValueBatchChangeRequests).toHaveBeenCalledTimes(2);
    rerender({ reloadToken: "after" });
    await waitFor(() => expect(reviewRepository.listProjectValueChangeRequests).toHaveBeenCalledTimes(3));
    expect(reviewRepository.listProjectValueBatchChangeRequests).toHaveBeenCalledTimes(3);
  });

  it("does not fetch review records for mock repositories without optional methods", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([candidate("unsubmitted")]) };
    const { result } = renderHook(() => useWorkbenchCandidates({ projectId: "project-1", repository, reviewRepository: {} }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reviewStatusById).toEqual({});
    expect(result.current.reviewStatusError).toBe("");
    render(<WorkbenchCandidateList state={result.current} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /unsubmitted.dts/ })).toHaveTextContent("状态待核对");
    expect(screen.queryByText("待审核")).not.toBeInTheDocument();
  });
  it.each([
    { status: "active", reviewStatus: "pending", label: "已生效" },
    { status: "active", reviewStatus: "approved", label: "已生效" },
    { status: "abandoned", reviewStatus: "approved", label: "已放弃" },
    { status: "ready", reviewStatus: "pending", label: "待审核" },
    { status: "ready", reviewStatus: "approved", label: "审核通过" },
    { status: "ready", reviewStatus: "rejected", label: "审核驳回" },
    { status: "ready", reviewStatus: "withdrawn", label: "已撤回" }
  ] satisfies Array<{ status: ParameterFileCandidate["status"]; reviewStatus: ParameterFileSourceReviewStatus; label: string }>)
  ("uses known review status while preserving $status precedence over $reviewStatus", ({ status, reviewStatus, label }) => {
    render(<WorkbenchCandidateList state={{ items: [candidate("record", { status })], loading: false, error: "", retry: vi.fn() }}
      selectedId="record" reviewStatusById={{ record: reviewStatus }} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /record.dts/ })).toHaveTextContent(label);
  });

  it("moves an approved review into completed records and expands it when the selected review cache updates", () => {
    const props = { state: { items: [candidate("reviewed")], loading: false, error: "", retry: vi.fn() }, selectedId: "reviewed", onSelect: vi.fn() };
    const { rerender } = render(<WorkbenchCandidateList {...props} reviewStatusById={{ reviewed: "pending" }} />);
    expect(screen.getByText("待审核")).toBeVisible();
    expect(screen.queryByText(/已完成与已放弃/)).not.toBeInTheDocument();
    rerender(<WorkbenchCandidateList {...props} reviewStatusById={{ reviewed: "approved" }} />);
    expect(screen.getByText("已完成与已放弃（1）").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /reviewed.dts/ })).toHaveTextContent("审核通过");
    expect(screen.getByText("审核通过")).toBeVisible();
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
  });

  it("prioritizes unfinished updates for the current file without hiding project records or changing time order within each group", () => {
    const items = [
      candidate("other-new", { fileId: "file-2", createdAt: "2026-10-17T05:00:00Z" }),
      candidate("current-old", { status: "failed", createdAt: "2026-10-17T01:00:00Z" }),
      candidate("done", { status: "active", createdAt: "2026-10-17T06:00:00Z" }),
      candidate("other-old", { fileId: "file-2", status: "blocked", createdAt: "2026-10-17T02:00:00Z" }),
      candidate("current-new", { status: "stale", createdAt: "2026-10-17T03:00:00Z" })
    ];
    const props = { state: { items, loading: false, error: "", retry: vi.fn() }, selectedId: null, onSelect: vi.fn() };
    const { rerender } = render(<WorkbenchCandidateList {...props} currentFileId="file-1" />);
    expect(screen.getAllByRole("button").filter((button) => !button.closest("details")).map((button) => button.querySelector("strong")?.textContent))
      .toEqual(["current-new.dts", "current-old.dts", "other-new.dts", "other-old.dts"]);
    expect(screen.getByText("需要重新核对")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.queryByText("待审核")).not.toBeInTheDocument();
    rerender(<WorkbenchCandidateList {...props} />);
    expect(screen.getAllByRole("button").filter((button) => !button.closest("details")).map((button) => button.querySelector("strong")?.textContent))
      .toEqual(["other-new.dts", "current-new.dts", "other-old.dts", "current-old.dts"]);
  });

  it("folds completed and abandoned records by default and reopens them when another completed record is selected", () => {
    const abandoned = candidate("abandoned", { status: "abandoned", createdAt: "2026-10-17T02:00:00Z" });
    const applied = candidate("applied", { status: "active" });
    const props = { state: { items: [applied, candidate("unfinished"), abandoned], loading: false, error: "", retry: vi.fn() }, onSelect: vi.fn() };
    const { rerender } = render(<WorkbenchCandidateList {...props} selectedId={null} />);
    const summary = screen.getByText("已完成与已放弃（2）");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /applied.dts/ })).not.toBeVisible();
    expect(screen.getByRole("button", { name: /unfinished.dts/ })).toBeVisible();

    rerender(<WorkbenchCandidateList {...props} selectedId="applied" />);
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /applied.dts/ })).toHaveAttribute("aria-pressed", "true");
    expect(Array.from(details.querySelectorAll("strong")).map((item) => item.textContent)).toEqual(["abandoned.dts", "applied.dts"]);
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute("open");
    rerender(<WorkbenchCandidateList {...props} selectedId="abandoned" />);
    expect(details).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: /abandoned.dts/ }));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(abandoned);
  });

  it("gives a source update next step when no records exist", () => {
    render(<WorkbenchCandidateList state={{ items: [], loading: false, error: "", retry: vi.fn() }} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText("暂无来源更新记录。上传来源文件后，可在这里继续核对或查看处理结果。")).toBeInTheDocument();
    expect(screen.queryByText(/提交审核/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已完成与已放弃/)).not.toBeInTheDocument();
  });

  it("loads project candidates before the record list is mounted and renders the supplied state without fetching again", async () => {
    const item = candidate("pending");
    const repository = { listCandidates: vi.fn().mockResolvedValue([item]) };
    const { result } = renderHook(() => useWorkbenchCandidates({ projectId: "project-1", repository }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items).toEqual([item]));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
    expect(screen.queryByLabelText("候选记录")).not.toBeInTheDocument();
    const onSelect = vi.fn();
    render(<WorkbenchCandidateList state={result.current} selectedId="pending" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /pending.dts/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(item);
    expect(repository.listCandidates).toHaveBeenCalledExactlyOnceWith("project-1", { fileId: undefined, includeAbandoned: true });
  });

  it("scopes records by project and file while retaining failed, applied and abandoned candidates", async () => {
    const applied = candidate("applied", { status: "active" });
    const failed = candidate("failed", { status: "failed", createdAt: "2026-10-17T02:00:00Z" });
    const abandoned = candidate("abandoned", { status: "abandoned" });
    const repository = { listCandidates: vi.fn().mockResolvedValue([
      applied, candidate("foreign-project", { projectId: "project-2" }),
      candidate("foreign-file", { fileId: "file-2" }), failed, abandoned
    ]) };
    const onSelect = vi.fn();
    render(<CandidateHarness projectId="project-1" fileId="file-1" repository={repository} selectedId="applied" onSelect={onSelect} />);
    expect(await screen.findByText("已生效")).toBeInTheDocument();
    expect(repository.listCandidates).toHaveBeenCalledWith("project-1", { fileId: "file-1", includeAbandoned: true });
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.getByText("已放弃")).toBeInTheDocument();
    expect(screen.queryByText("foreign-project.dts")).not.toBeInTheDocument();
    expect(screen.queryByText("foreign-file.dts")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("failed.dts");
    expect(screen.getByRole("button", { name: /applied.dts/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /failed.dts/ }));
    expect(onSelect).toHaveBeenCalledWith(failed);
  });

  it("allows a project-wide list without including another project's records", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValue([
      candidate("first"), candidate("second", { fileId: "file-2" }), candidate("foreign", { projectId: "other" })
    ]) };
    render(<CandidateHarness projectId="project-1" repository={repository} selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByText("second.dts")).toBeInTheDocument();
    expect(screen.getByText("first.dts")).toBeInTheDocument();
    expect(screen.queryByText("foreign.dts")).not.toBeInTheDocument();
  });

  it("retries a failed request and replaces the error with current records", async () => {
    const repository = { listCandidates: vi.fn().mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce([candidate("recovered")]) };
    render(<CandidateHarness projectId="project-1" fileId="file-1" repository={repository} selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("recovered.dts")).toBeInTheDocument();
    expect(repository.listCandidates).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the same file when a candidate changes status", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValueOnce([candidate("updated")])
      .mockResolvedValueOnce([candidate("updated", { status: "active", updatedAt: "2026-10-17T03:00:00Z" })]) };
    const props = { projectId: "project-1", fileId: "file-1", repository, selectedId: "updated", onSelect: vi.fn() };
    const { rerender } = render(<CandidateHarness {...props} reloadToken="updated:ready:2026-10-17T00:00:00Z" />);
    expect(await screen.findByText("状态待核对")).toBeInTheDocument();
    rerender(<CandidateHarness {...props} reloadToken="updated:active:2026-10-17T03:00:00Z" />);
    expect(await screen.findByText("已生效")).toBeInTheDocument();
    expect(screen.queryByText("状态待核对")).not.toBeInTheDocument();
    expect(repository.listCandidates).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /updated.dts/ })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["file", "project"] as const)("ignores a late response after the selected %s changes", async (changed) => {
    let resolveOld!: (items: ParameterFileCandidate[]) => void;
    const repository = { listCandidates: vi.fn()
      .mockImplementationOnce(() => new Promise<ParameterFileCandidate[]>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([candidate("current", changed === "file" ? { fileId: "file-2" } : { projectId: "project-2" })]) };
    const props = { projectId: "project-1", fileId: "file-1", repository, selectedId: null, onSelect: vi.fn() };
    const { rerender } = render(<CandidateHarness {...props} />);
    rerender(<CandidateHarness {...props} {...(changed === "file" ? { fileId: "file-2" } : { projectId: "project-2" })} />);
    expect(await screen.findByText("current.dts")).toBeInTheDocument();
    await act(async () => { resolveOld([candidate("outdated")]); });
    expect(screen.queryByText("outdated.dts")).not.toBeInTheDocument();
    expect(screen.getByText("current.dts")).toBeInTheDocument();
  });

  it("clears the previous file immediately while the new file loads", async () => {
    const repository = { listCandidates: vi.fn().mockResolvedValueOnce([candidate("previous")])
      .mockImplementationOnce(() => new Promise<ParameterFileCandidate[]>(() => {})) };
    const props = { projectId: "project-1", fileId: "file-1", repository, selectedId: null, onSelect: vi.fn() };
    const { rerender } = render(<CandidateHarness {...props} />);
    expect(await screen.findByText("previous.dts")).toBeInTheDocument();
    rerender(<CandidateHarness {...props} fileId="file-2" />);
    await waitFor(() => expect(screen.queryByText("previous.dts")).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "正在加载候选记录…" })).toBeInTheDocument();
  });
});
