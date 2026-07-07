import { describe, expect, it, vi } from "vitest";
import { createXiaozeTurnPersister } from "./threadPersistence";

describe("xiaoze thread persistence", () => {
  it("writes session started and message appended audit events on first turn", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.includes("from agent_sessions") && text.includes("limit 1")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      })
    } as never;

    const persist = createXiaozeTurnPersister({ db });
    await persist({
      auth: {
        organization: { id: "org-1" },
        user: { id: "user-1", isActive: true },
        permissions: [],
        roles: []
      } as never,
      requestId: "req-1",
      threadId: "thread-1",
      runId: "run-1",
      pageContext: { pageKey: "parameters", projectId: "aurora" },
      userMessage: { id: "msg-user", content: "hello" },
      assistantMessage: { id: "msg-assistant", content: "answer" }
    });

    expect(calls.some((call) => call.text.includes("insert into audit_events") && call.values.includes("started"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into audit_events") && call.values.includes("appended"))).toBe(true);
  });

  it("does not persist projectId for org-scoped log pages", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.includes("from agent_sessions") && text.includes("limit 1")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      })
    } as never;

    const persist = createXiaozeTurnPersister({ db });
    await persist({
      auth: {
        organization: { id: "org-1" },
        user: { id: "user-1", isActive: true },
        permissions: [],
        roles: []
      } as never,
      requestId: "req-1",
      threadId: "thread-logs",
      runId: "run-1",
      pageContext: { pageKey: "logs", projectId: "aurora" },
      userMessage: { id: "msg-user", content: "hello" },
      assistantMessage: { id: "msg-assistant", content: "answer" }
    });

    const sessionInsert = calls.find((call) => call.text.includes("insert into agent_sessions"));
    expect(sessionInsert?.values[2]).toBeNull();
    const auditStarted = calls.find(
      (call) => call.text.includes("insert into audit_events") && call.values.includes("started")
    );
    expect(auditStarted?.values.some((value) => value === null)).toBe(true);
  });
});
