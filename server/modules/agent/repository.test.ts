import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import {
  appendAgentMessage,
  createAgentApproval,
  createAgentRunTrace,
  createAgentSession,
  createAgentToolCall,
  getAgentApproval,
  getAgentSession,
  getAgentToolCall,
  listAgentApprovals,
  listAgentMessages,
  listAgentToolCalls,
  markAgentApprovalApproved,
  markAgentApprovalRejected,
  updateAgentToolCall
} from "./repository";

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
        name: "parameter.summarizeReviewQueue",
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
    const toolUpdated = await updateAgentToolCall(db, "org-chargelab", "tool-1", {
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
    const approved = await markAgentApprovalApproved(db, "org-chargelab", "approval-1", "u-xu-yun");
    const rejected = await markAgentApprovalRejected(db, "org-chargelab", "approval-2", "u-xu-yun", "Need clearer evidence");

    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_messages");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_tool_calls");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_approvals");
    expect(calls.map((call) => call.text).join("\n")).toContain("decided_at = now()");
    expect(toolUpdated).toBe(false);
    expect(approved).toBe(false);
    expect(rejected).toBe(false);
  });

  it("creates run traces with provider metadata and tool call ids", async () => {
    const { db, calls } = createRecordingDb();

    await createAgentRunTrace(db, {
      id: "trace-1",
      sessionId: "agent-session-1",
      messageId: "agent-msg-user-1",
      organizationId: "org-chargelab",
      provider: "deterministic",
      model: "wiseeff-rules-m4",
      promptVersion: "m4-agent-v1",
      inputSummary: "Summarize review queue",
      outputSummary: "I will call controlled tools.",
      toolCallIds: ["tool-1", "tool-2"],
      traceId: "req-1"
    });

    expect(calls[0].text).toContain("insert into agent_run_traces");
    expect(calls[0].values).toContain("wiseeff-rules-m4");
    expect(calls[0].values).toContain("req-1");
    expect(calls[0].values).toContainEqual(["tool-1", "tool-2"]);
  });

  it("loads a scoped tool call with session and project metadata", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "tool-1",
        session_id: "agent-session-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: JSON.stringify({ projectId: "aurora", reason: "Stage draft" }),
        requires_approval: true,
        status: "pending_approval",
        result: null,
        error_message: null,
        audit_event_id: null,
        approval_id: "approval-1",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z"
      }
    ]);

    const toolCall = await getAgentToolCall(db, "org-chargelab", "tool-1");

    expect(calls[0].text).toContain("from agent_tool_calls");
    expect(calls[0].text).toContain("left join agent_approvals");
    expect(toolCall).toMatchObject({
      id: "tool-1",
      sessionId: "agent-session-1",
      projectId: "aurora",
      approvalId: "approval-1",
      status: "pending_approval"
    });
  });

  it("loads a pending approval with tool call payload for approved execution", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "approval-1",
        session_id: "agent-session-1",
        tool_call_id: "tool-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        title: "Create parameter draft",
        message: "This will create a draft.",
        status: "pending",
        requested_at: "2026-05-27T00:00:00.000Z",
        decided_at: null,
        decided_by_user_id: null,
        decision_reason: null
      }
    ]);

    const approval = await getAgentApproval(db, "org-chargelab", "approval-1");

    expect(calls[0].text).toContain("from agent_approvals");
    expect(calls[0].text).toContain("where organization_id = $1");
    expect(approval).toMatchObject({
      id: "approval-1",
      sessionId: "agent-session-1",
      toolCallId: "tool-1",
      projectId: "aurora",
      status: "pending"
    });
  });

  it("returns update success from tool call rowCount and keeps scoped updated SQL", async () => {
    const { db: matchedDb, calls: matchedCalls } = createRecordingDb([], 1);
    const { db: missedDb } = createRecordingDb([], 0);

    const matched = await updateAgentToolCall(matchedDb, "org-chargelab", "tool-1", {
      status: "succeeded",
      result: { summary: "2 pending", data: { pending: 2 }, citations: [] }
    });
    const missed = await updateAgentToolCall(missedDb, "org-chargelab", "tool-missing", {
      status: "failed",
      errorMessage: "No such tool call"
    });

    expect(matched).toBe(true);
    expect(missed).toBe(false);
    expect(matchedCalls[0].text).toContain("where organization_id = $1");
    expect(matchedCalls[0].text).toContain("and id = $2");
    expect(matchedCalls[0].text).toContain("updated_at = now()");
  });

  it("guards terminal tool call status updates while allowing idempotent updates", async () => {
    const { db, calls } = createRecordingDb([], 1);

    const updated = await updateAgentToolCall(db, "org-chargelab", "tool-1", {
      status: "succeeded",
      result: { summary: "2 pending", data: { pending: 2 }, citations: [] }
    });

    expect(updated).toBe(true);
    expect(calls[0].text).toContain("status not in ('succeeded', 'failed', 'rejected')");
    expect(calls[0].text).toContain("status = $3");
    expect(calls[0].text).toContain("$3 is null");
  });

  it("returns approval decision success from rowCount and keeps pending guard", async () => {
    const { db: matchedDb, calls: matchedCalls } = createRecordingDb([], 1);
    const { db: missedDb } = createRecordingDb([], 0);

    const approved = await markAgentApprovalApproved(matchedDb, "org-chargelab", "approval-1", "u-xu-yun");
    const approveMissed = await markAgentApprovalApproved(missedDb, "org-chargelab", "approval-2", "u-xu-yun");
    const rejected = await markAgentApprovalRejected(matchedDb, "org-chargelab", "approval-3", "u-xu-yun", "Need clearer evidence");
    const rejectMissed = await markAgentApprovalRejected(
      missedDb,
      "org-chargelab",
      "approval-4",
      "u-xu-yun",
      "Need clearer evidence"
    );

    expect(approved).toBe(true);
    expect(approveMissed).toBe(false);
    expect(rejected).toBe(true);
    expect(rejectMissed).toBe(false);
    expect(matchedCalls[0].text).toContain("where organization_id = $1");
    expect(matchedCalls[0].text).toContain("and status = 'pending'");
    expect(matchedCalls[1].text).toContain("where organization_id = $1");
    expect(matchedCalls[1].text).toContain("and status = 'pending'");
  });

  it("lists messages with organization/session filters and maps JSON string citations", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "agent-msg-1",
        role: "assistant",
        content: "2 pending review items.",
        citations: JSON.stringify([{ type: "parameter", id: "change-1", label: "Change request change-1" }]),
        confidence: "0.84",
        created_at: "2026-05-27T00:00:00.000Z"
      }
    ]);

    const messages = await listAgentMessages(db, "org-chargelab", "agent-session-1");

    expect(calls[0].text).toContain("where organization_id = $1");
    expect(calls[0].text).toContain("and session_id = $2");
    expect(calls[0].text).not.toContain("agent_tool_calls.");
    expect(calls[0].values).toEqual(["org-chargelab", "agent-session-1"]);
    expect(messages[0]).toMatchObject({
      id: "agent-msg-1",
      role: "assistant",
      content: "2 pending review items.",
      confidence: 0.84
    });
    expect(messages[0].citations?.[0]).toEqual({
      type: "parameter",
      id: "change-1",
      label: "Change request change-1"
    });
  });

  it("lists tool calls with organization/session filters and maps JSON string payload and result", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "tool-1",
        name: "parameter.summarizeReviewQueue",
        label: "Summarize review queue",
        payload: JSON.stringify({ projectId: "aurora" }),
        requires_approval: false,
        status: "succeeded",
        result: JSON.stringify({ summary: "2 pending", data: { pending: 2 }, citations: [] }),
        error_message: null,
        audit_event_id: "audit-1",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:01:00.000Z"
      }
    ]);

    const toolCalls = await listAgentToolCalls(db, "org-chargelab", "agent-session-1");

    expect(calls[0].text).toContain("where organization_id = $1");
    expect(calls[0].text).toContain("and session_id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "agent-session-1"]);
    expect(toolCalls[0].payload).toEqual({ projectId: "aurora" });
    expect(toolCalls[0].result).toEqual({ summary: "2 pending", data: { pending: 2 }, citations: [] });
    expect(toolCalls[0].auditEventId).toBe("audit-1");
  });

  it("lists approvals with organization/session filters and maps decision data", async () => {
    const { db, calls } = createRecordingDb([
      {
        id: "approval-1",
        tool_call_id: "tool-2",
        title: "Create parameter draft",
        message: "This will create a draft.",
        status: "rejected",
        requested_at: "2026-05-27T00:00:00.000Z",
        decided_at: "2026-05-27T00:02:00.000Z",
        decided_by_user_id: "u-xu-yun",
        decision_reason: "Need clearer evidence"
      }
    ]);

    const approvals = await listAgentApprovals(db, "org-chargelab", "agent-session-1");

    expect(calls[0].text).toContain("where organization_id = $1");
    expect(calls[0].text).toContain("and session_id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "agent-session-1"]);
    expect(approvals[0]).toEqual({
      id: "approval-1",
      toolCallId: "tool-2",
      title: "Create parameter draft",
      message: "This will create a draft.",
      status: "rejected",
      createdAt: "2026-05-27T00:00:00.000Z",
      decidedAt: "2026-05-27T00:02:00.000Z",
      decidedByUserId: "u-xu-yun",
      reason: "Need clearer evidence"
    });
  });
});
