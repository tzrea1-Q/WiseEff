import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { archiveXiaozeThread, getXiaozeThread, listXiaozeThreads } from "./xiaozeThreadsClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("xiaozeThreadsClient", () => {
  it("lists threads from the API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            id: "thread-1",
            title: "charge",
            preview: "answer",
            createdAt: "2026-06-24T08:00:00.000Z",
            updatedAt: "2026-06-24T08:01:00.000Z",
            messageCount: 2
          }
        ],
        nextCursor: null
      })
    );
    const apiClient = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(listXiaozeThreads(apiClient)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/agent/xiaoze/threads?limit=30", expect.objectContaining({ method: "GET" }));
  });

  it("loads a thread with messages", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        thread: {
          id: "thread-1",
          title: "charge",
          preview: "answer",
          createdAt: "2026-06-24T08:00:00.000Z",
          updatedAt: "2026-06-24T08:01:00.000Z",
          context: { pageKey: "parameters" },
          messages: []
        },
        messages: [{ id: "m1", role: "user", content: "hello", createdAt: "2026-06-24T08:00:00.000Z" }]
      })
    );
    const apiClient = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(getXiaozeThread("thread-1", apiClient)).resolves.toMatchObject({
      id: "thread-1",
      messages: [{ content: "hello" }]
    });
  });

  it("archives a thread through DELETE", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const apiClient = createApiClient({ baseUrl: "", fetchImpl: fetchMock });

    await expect(archiveXiaozeThread("thread-1", apiClient)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agent/xiaoze/threads/thread-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
