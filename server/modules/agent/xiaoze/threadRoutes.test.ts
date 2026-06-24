import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { registerXiaozeThreadRoutes } from "./threadRoutes";

const auth = {
  organization: { id: "org-1" },
  user: { id: "user-1", isActive: true },
  permissions: [],
  roles: []
} as never;

function createTestDb() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    transaction: vi.fn(async (fn: (tx: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) })
    )
  } as unknown as Database;
}

describe("xiaoze thread routes", () => {
  it("returns 404 when renaming a missing thread", async () => {
    const router = createRouter();
    const db = createTestDb();

    registerXiaozeThreadRoutes(router, {
      db,
      getCurrentAuthContext: async () => auth
    });

    await expect(
      router.handle({
        method: "PATCH",
        path: "/api/v1/agent/xiaoze/threads/thread-missing",
        params: { threadId: "thread-missing" },
        query: {},
        headers: {},
        requestId: "req-2",
        body: { title: "新标题" }
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a draft thread id without inserting a session row", async () => {
    const router = createRouter();
    const db = createTestDb();

    registerXiaozeThreadRoutes(router, {
      db,
      getCurrentAuthContext: async () => auth
    });

    const response = await router.handle({
      method: "POST",
      path: "/api/v1/agent/xiaoze/threads",
      params: {},
      query: {},
      headers: {},
      requestId: "req-3",
      body: { id: "thread-draft" }
    });

    expect(response.status).toBe(201);
    if ("body" in response) {
      expect((response.body as { thread: { id: string } }).thread.id).toBe("thread-draft");
    }
    expect(db.query).not.toHaveBeenCalled();
  });
});
