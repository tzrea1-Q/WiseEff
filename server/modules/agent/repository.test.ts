import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { getAgentSession, listAgentMessages, listAgentToolCalls } from "./repository";

/**
 * Driver-boundary resilience only: a real database returns parsed JSONB, so
 * string-shaped and malformed JSON payloads can only be exercised with a fake
 * row source. Behavioral coverage lives in repository.integration.test.ts.
 */
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

describe("agent repository JSON mapping resilience", () => {
  it("maps session context when JSONB arrives as a string", async () => {
    const { db } = createRecordingDb([
      {
        id: "agent-session-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        actor_user_id: "u-xu-yun",
        page_key: "parameters",
        role_id: "hardware-user",
        context: JSON.stringify({
          path: "/parameters",
          pageKey: "parameters",
          projectId: "aurora",
          roleId: "hardware-user"
        }),
        status: "active",
        title: "Project parameter patrol",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z"
      }
    ]);

    const session = await getAgentSession(db, "org-chargelab", "agent-session-1");

    expect(session?.context).toEqual({
      path: "/parameters",
      pageKey: "parameters",
      projectId: "aurora",
      roleId: "hardware-user"
    });
  });

  it("falls back safely for malformed JSON strings", async () => {
    const { db: sessionDb } = createRecordingDb([
      {
        id: "agent-session-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        actor_user_id: "u-xu-yun",
        page_key: "parameters",
        role_id: "hardware-user",
        context: "{broken",
        status: "active",
        title: "Project parameter patrol",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z"
      }
    ]);
    const { db: messageDb } = createRecordingDb([
      {
        id: "agent-msg-1",
        role: "assistant",
        content: "Malformed citations should not break mapping.",
        citations: "{broken",
        confidence: null,
        created_at: "2026-05-27T00:00:00.000Z"
      }
    ]);
    const { db: toolDb } = createRecordingDb([
      {
        id: "tool-1",
        name: "perception.getProjectOverview",
        label: "Summarize review queue",
        payload: "{broken",
        requires_approval: false,
        status: "failed",
        result: "{broken",
        error_message: "Bad upstream JSON",
        audit_event_id: null,
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:01:00.000Z"
      }
    ]);

    const session = await getAgentSession(sessionDb, "org-chargelab", "agent-session-1");
    const messages = await listAgentMessages(messageDb, "org-chargelab", "agent-session-1");
    const toolCalls = await listAgentToolCalls(toolDb, "org-chargelab", "agent-session-1");

    expect(session?.context).toEqual({ path: "", pageKey: "" });
    expect(messages[0].citations).toEqual([]);
    expect(toolCalls[0].payload).toEqual({});
    expect(toolCalls[0].result).toEqual({});
  });
});
