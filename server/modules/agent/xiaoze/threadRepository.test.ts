import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/client";
import {
  archiveXiaozeThread,
  deriveThreadPreviewFromMessages,
  deriveThreadTitleFromMessages,
  getXiaozeThread,
  listXiaozeThreads,
  persistXiaozeTurnMessages,
  updateXiaozeThreadTitle,
  XIAOZE_PAGE_KEY
} from "./threadRepository";

function createRecordingDb(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: rows as Row[], rowCount };
    }
  };
  return { db, calls };
}

describe("xiaoze threadRepository", () => {
  it("derives title and preview from messages", () => {
    const messages = [
      { id: "m1", role: "user" as const, content: "aurora charge 参数有哪些？" },
      { id: "m2", role: "assistant" as const, content: "和 charge 相关的参数有 A、B、C。" }
    ];
    expect(deriveThreadTitleFromMessages(messages)).toBe("aurora charge 参数有哪些？");
    expect(deriveThreadPreviewFromMessages(messages)).toBe("和 charge 相关的参数有 A、B、C。");
  });

  it("lists xiaoze threads scoped to actor and page key", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "thread-1",
        title: "charge 参数",
        context: { xiaoze: { preview: "和 charge 相关" } },
        created_at: "2026-06-24T08:00:00.000Z",
        updated_at: "2026-06-24T08:05:00.000Z",
        message_count: 2
      }
    ]);

    const result = await listXiaozeThreads(db, {
      organizationId: "org-1",
      actorUserId: "user-1"
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("thread-1");
    expect(calls[0].text).toContain("from agent_sessions s");
    expect(calls[0].values).toContain(XIAOZE_PAGE_KEY);
    expect(calls[0].values).toContain("user-1");
  });

  it("returns null for missing or non-owned threads", async () => {
    const { db } = createRecordingDb([]);
    const thread = await getXiaozeThread(db, "org-1", "user-1", "missing");
    expect(thread).toBeNull();
  });

  it("persists a new turn with idempotent message inserts", async () => {
    let sessionLookupCount = 0;
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async (text, values = []) => {
        calls.push({ text, values });
        if (text.includes("from agent_sessions") && text.includes("limit 1")) {
          sessionLookupCount += 1;
          return {
            rows:
              sessionLookupCount > 1
                ? [
                    {
                      id: "thread-1",
                      organization_id: "org-1",
                      project_id: "aurora",
                      actor_user_id: "user-1",
                      page_key: XIAOZE_PAGE_KEY,
                      role_id: null,
                      context: { xiaoze: { preview: "answer" } },
                      status: "active",
                      title: "hello",
                      created_at: "2026-06-24T08:00:00.000Z",
                      updated_at: "2026-06-24T08:01:00.000Z"
                    }
                  ]
                : [],
            rowCount: sessionLookupCount > 1 ? 1 : 0
          } as never;
        }
        if (text.includes("from agent_messages")) {
          return {
            rows: [
              {
                id: "msg-user",
                role: "user",
                content: "hello",
                citations: [],
                confidence: null,
                created_at: "2026-06-24T08:00:00.000Z"
              },
              {
                id: "msg-assistant",
                role: "assistant",
                content: "answer",
                citations: [],
                confidence: null,
                created_at: "2026-06-24T08:01:00.000Z"
              }
            ],
            rowCount: 2
          } as never;
        }
        return { rows: [], rowCount: 1 } as never;
      }
    };

    const persisted = await persistXiaozeTurnMessages(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      threadId: "thread-1",
      runId: "run-1",
      pageContext: { pageKey: "parameters", projectId: "aurora", path: "/parameters" },
      messages: [
        { id: "msg-user", role: "user", content: "hello" },
        { id: "msg-assistant", role: "assistant", content: "answer" }
      ]
    });

    expect(persisted).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into agent_sessions"))).toBe(true);
    expect(calls.some((call) => call.text.includes("on conflict (id) do nothing"))).toBe(true);
    expect(calls.some((call) => call.text.includes("update agent_sessions"))).toBe(true);
  });

  it("archives and renames owned threads", async () => {
    const { db: archiveDb, calls: archiveCalls } = createRecordingDb([], 1);
    await expect(archiveXiaozeThread(archiveDb, "org-1", "user-1", "thread-1")).resolves.toBe(true);
    expect(archiveCalls[0].text).toContain("status = 'archived'");

    const { db: titleDb, calls: titleCalls } = createRecordingDb([], 1);
    await expect(updateXiaozeThreadTitle(titleDb, "org-1", "user-1", "thread-1", "自定义标题")).resolves.toBe(true);
    expect(titleCalls[0].values).toContain("自定义标题");
  });
});
