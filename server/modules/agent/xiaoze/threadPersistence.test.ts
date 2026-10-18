import { describe, expect, it, vi } from "vitest";
import { createXiaozeTurnPersister } from "./threadPersistence";
import { createAgentInvocation, createUserInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";

const auth = makeTestAuthContext({ userId: "user-1", organizationId: "org-1" });

describe("xiaoze thread persistence", () => {
  it.each(["user", "agent"] as const)("preserves %s provenance in first-turn audits", async (initiator) => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queryable = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.includes("from agent_sessions") && text.includes("limit 1")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      })
    };
    const db = {
      ...queryable,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(queryable)
    } as never;

    const persist = createXiaozeTurnPersister({ db });
    await persist({
      auth,
      invocation: initiator === "user" ? createUserInvocation(auth) : createAgentInvocation(auth, {
        sessionId: "thread-1",
        toolCallId: "tool-1",
        approval: { required: true, approvalId: "approval-1" }
      }),
      requestId: "req-1",
      threadId: "thread-1",
      runId: "run-1",
      pageContext: { pageKey: "parameters", projectId: "aurora" },
      userMessage: { id: "msg-user", content: "hello" },
      assistantMessage: { id: "msg-assistant", content: "answer" }
    });

    expect(calls.some((call) => call.text.includes("insert into audit_events") && call.values.includes("started"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into audit_events") && call.values.includes("appended"))).toBe(true);
    const audits = calls.filter((call) => call.text.includes("insert into audit_events"));
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit.values).toContain(initiator);
      const metadata = audit.values.find((value) => typeof value === "string" && value.startsWith("{"));
      expect(JSON.parse(String(metadata))).toMatchObject(initiator === "agent"
        ? { initiator, sessionId: "thread-1", toolCallId: "tool-1", approvalId: "approval-1" }
        : { initiator });
    }
  });

  it("does not persist projectId for org-scoped log pages", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queryable = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.includes("from agent_sessions") && text.includes("limit 1")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      })
    };
    const db = {
      ...queryable,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(queryable)
    } as never;

    const persist = createXiaozeTurnPersister({ db });
    await persist({
      auth,
      invocation: createUserInvocation(auth),
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
