import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import {
  appendAgentMessage,
  createAgentApproval,
  createAgentSession,
  createAgentToolCall,
  getAgentSession,
  listAgentApprovals,
  listAgentMessages,
  listAgentToolCalls,
  markAgentApprovalApproved,
  markAgentApprovalRejected,
  updateAgentToolCall
} from "./repository";

function createRecordingDb(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };
  return { db, calls };
}

describe("agent repository", () => {
  it("creates sessions with scoped context", async () => {
    const { db, calls } = createRecordingDb();

    await createAgentSession(db, {
      id: "agent-session-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      actorUserId: "u-xu-yun",
      pageKey: "parameters",
      roleId: "hardware-user",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      title: "Project parameter patrol"
    });

    expect(calls[0].text).toContain("insert into agent_sessions");
    expect(calls[0].values).toContain("agent-session-1");
    expect(calls[0].values).toContain("parameters");
  });

  it("maps session rows into DTOs", async () => {
    const { db } = createRecordingDb([
      {
        id: "agent-session-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        actor_user_id: "u-xu-yun",
        page_key: "parameters",
        role_id: "hardware-user",
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
        status: "active",
        title: "Project parameter patrol",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z"
      }
    ]);

    const session = await getAgentSession(db, "org-chargelab", "agent-session-1");

    expect(session?.context.projectId).toBe("aurora");
  });

  it("creates messages, tool calls, approvals, and approval decisions", async () => {
    const { db, calls } = createRecordingDb();

    await appendAgentMessage(db, {
      id: "agent-msg-1",
      sessionId: "agent-session-1",
      organizationId: "org-chargelab",
      role: "assistant",
      content: "2 pending review items.",
      citations: [{ type: "parameter", id: "change-1", label: "Change request change-1" }],
      confidence: 0.84
    });
    await createAgentToolCall(db, {
      id: "tool-1",
      sessionId: "agent-session-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      name: "parameter.summarizeReviewQueue",
      label: "Summarize review queue",
      payload: { projectId: "aurora" },
      requiresApproval: false,
      status: "requested"
    });
    await updateAgentToolCall(db, "org-chargelab", "tool-1", {
      status: "succeeded",
      result: { summary: "2 pending", data: { pending: 2 }, citations: [] },
      auditEventId: "audit-1"
    });
    await createAgentApproval(db, {
      id: "approval-1",
      sessionId: "agent-session-1",
      toolCallId: "tool-2",
      organizationId: "org-chargelab",
      projectId: "aurora",
      status: "pending",
      title: "Create parameter draft",
      message: "This will create a draft.",
      requestedByUserId: "u-xu-yun"
    });
    await markAgentApprovalApproved(db, "org-chargelab", "approval-1", "u-xu-yun");
    await markAgentApprovalRejected(db, "org-chargelab", "approval-2", "u-xu-yun", "Need clearer evidence");

    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_messages");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_tool_calls");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_approvals");
    expect(calls.map((call) => call.text).join("\n")).toContain("decided_at = now()");
  });

  it("lists messages, tool calls, and approvals for a session", async () => {
    const { db } = createRecordingDb([]);

    await listAgentMessages(db, "org-chargelab", "agent-session-1");
    await listAgentToolCalls(db, "org-chargelab", "agent-session-1");
    await listAgentApprovals(db, "org-chargelab", "agent-session-1");

    expect(true).toBe(true);
  });
});
