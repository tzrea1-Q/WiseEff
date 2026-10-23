import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowPublicationState } from "@/domain/workflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import { useWorkflowPublication } from "./useWorkflowPublication";

const published: WorkflowPublicationState = { workflows: { "parameter-management": true, debugging: true, "log-analysis": true, knowledge: true }, version: 0 };
function deferred() {
  let resolve!: (value: WorkflowPublicationState) => void;
  const promise = new Promise<WorkflowPublicationState>((complete) => { resolve = complete; });
  return { promise, resolve };
}
function client(getPublication: WorkflowPublicationClient["getPublication"]): WorkflowPublicationClient {
  return { getPublication, getAdministration: vi.fn(), updatePublication: vi.fn() };
}

describe("page-entry publication snapshots", () => {
  it("keeps the open page until entry changes, then waits for a fresh snapshot", async () => {
    const next = deferred();
    const get = vi.fn().mockResolvedValueOnce(published).mockReturnValueOnce(next.promise);
    const api = client(get);
    const { result, rerender } = renderHook(({ path }) => useWorkflowPublication(api, path), { initialProps: { path: "/knowledge" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ path: "/knowledge" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.publication?.workflows.knowledge).toBe(true);
    rerender({ path: "/logs" });
    expect(result.current.status).toBe("loading");
    expect(result.current.publication).toBeNull();
    await act(async () => next.resolve({ ...published, workflows: { ...published.workflows, knowledge: false }, version: 1 }));
    expect(result.current.publication?.workflows.knowledge).toBe(false);
  });

  it("does not reuse a stale A snapshot after a pending B entry is cancelled", async () => {
    const pendingB = deferred(), reenteredA = deferred();
    const api = client(vi.fn().mockResolvedValueOnce(published).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(reenteredA.promise));
    const { result, rerender } = renderHook(({ path }) => useWorkflowPublication(api, path), { initialProps: { path: "A" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ path: "B" });
    rerender({ path: "A" });
    expect(result.current.status).toBe("loading");
    await act(async () => pendingB.resolve(published));
    expect(result.current.status).toBe("loading");
    await act(async () => reenteredA.resolve({ ...published, workflows: { ...published.workflows, knowledge: false }, version: 1 }));
    expect(result.current.publication?.workflows.knowledge).toBe(false);
  });

  it("fails closed on refresh failure and recovers on explicit retry", async () => {
    const api = client(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(published));
    const { result } = renderHook(() => useWorkflowPublication(api, "session:page"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.publication).toBeNull();
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
