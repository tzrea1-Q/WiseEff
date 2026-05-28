import { describe, expect, it, vi } from "vitest";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { developmentAuthContext } from "../auth/routes";
import type { AgentToolExecutionContext } from "./toolRegistry";
import { createAgentOrchestrator } from "./orchestrator";
import { createDeterministicAgentProvider } from "./provider";
import type { AgentProviderPlan } from "./provider";
import type { AgentToolDefinition } from "./toolRegistry";
import type { AgentToolName, AgentToolResult } from "./types";

describe("deterministic agent provider", () => {
  it("selects parameter review and draft tools from parameter context", () => {
    const provider = createDeterministicAgentProvider();
    const plan = provider.planTurn({
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      message: "帮我总结审阅队列，并准备一个参数草稿"
    });

    expect(plan.toolRequests.map((tool) => tool.name)).toEqual([
      "parameter.summarizeReviewQueue",
      "parameter.submitChangeDraft"
    ]);
    expect(plan.assistantDraft.confidence).toBeGreaterThan(0.7);
  });
});

type MemoryRow = Record<string, unknown>;

function isoNow() {
  return "2026-05-28T00:00:00.000Z";
}

function createMemoryDb() {
  const tables = {
    sessions: [] as MemoryRow[],
    messages: [] as MemoryRow[],
    toolCalls: [] as MemoryRow[],
    approvals: [] as MemoryRow[],
    traces: [] as MemoryRow[]
  };

  const queryable: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql.includes("insert into agent_sessions")) {
        tables.sessions.push({
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          actor_user_id: values[3],
          page_key: values[4],
          role_id: values[5],
          context: values[6],
          title: values[7],
          status: "active",
          created_at: isoNow(),
          updated_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_sessions")) {
        return {
          rows: tables.sessions.filter((row) => row.organization_id === values[0] && row.id === values[1]) as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into agent_messages")) {
        tables.messages.push({
          id: values[0],
          session_id: values[1],
          organization_id: values[2],
          role: values[3],
          content: values[4],
          citations: values[5],
          confidence: values[6],
          created_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_messages")) {
        return {
          rows: tables.messages.filter((row) => row.organization_id === values[0] && row.session_id === values[1]) as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into agent_tool_calls")) {
        tables.toolCalls.push({
          id: values[0],
          session_id: values[1],
          organization_id: values[2],
          project_id: values[3],
          name: values[4],
          label: values[5],
          payload: values[6],
          requires_approval: values[7],
          status: values[8],
          result: null,
          error_message: null,
          audit_event_id: null,
          created_at: isoNow(),
          updated_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("update agent_tool_calls")) {
        const row = tables.toolCalls.find((item) => item.organization_id === values[0] && item.id === values[1]);
        if (!row) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        const nextStatus = values[2];
        const isTerminal = ["succeeded", "failed", "rejected"].includes(String(row.status));
        if (nextStatus !== null && row.status !== nextStatus && isTerminal) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        row.status = nextStatus ?? row.status;
        row.result = values[3] ?? row.result;
        row.error_message = values[4] ?? row.error_message;
        row.audit_event_id = values[5] ?? row.audit_event_id;
        row.updated_at = isoNow();
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_tool_calls")) {
        const rows = tables.toolCalls
          .filter((row) =>
            sql.includes("and session_id = $2")
              ? row.organization_id === values[0] && row.session_id === values[1]
              : row.organization_id === values[0] && row.id === values[1]
          )
          .map((row) => ({
            ...row,
            approval_id: tables.approvals.find((approval) => approval.tool_call_id === row.id)?.id ?? null
          }));
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_approvals")) {
        tables.approvals.push({
          id: values[0],
          session_id: values[1],
          tool_call_id: values[2],
          organization_id: values[3],
          project_id: values[4],
          status: values[5],
          title: values[6],
          message: values[7],
          requested_by_user_id: values[8],
          requested_at: isoNow(),
          decided_at: null,
          decided_by_user_id: null,
          decision_reason: null
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("update agent_approvals")) {
        const row = tables.approvals.find(
          (item) => item.organization_id === values[0] && item.id === values[1] && item.status === "pending"
        );
        if (!row) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        row.status = sql.includes("status = 'approved'") ? "approved" : "rejected";
        row.decided_by_user_id = values[2];
        row.decision_reason = values[3] ?? null;
        row.decided_at = isoNow();
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_approvals")) {
        return {
          rows: tables.approvals.filter((row) =>
            sql.includes("and session_id = $2")
              ? row.organization_id === values[0] && row.session_id === values[1]
              : row.organization_id === values[0] && row.id === values[1]
          ) as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into agent_run_traces")) {
        tables.traces.push({
          id: values[0],
          session_id: values[1],
          message_id: values[2],
          organization_id: values[3],
          provider: values[4],
          model: values[5],
          prompt_version: values[6],
          input_summary: values[7],
          output_summary: values[8],
          tool_call_ids: values[9],
          trace_id: values[10],
          created_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("insert into audit_events")) {
        return { rows: [] as Row[], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in test DB: ${sql}`);
    }
  };

  const db: Database = {
    ...queryable,
    transaction: async (fn) => fn(queryable)
  };

  return { db, tables };
}

function createProvider(plan: AgentProviderPlan) {
  return {
    planTurn: vi.fn(() => plan)
  };
}

function createToolDefinition(input: {
  name: AgentToolName;
  requiresApproval: boolean;
  kind?: AgentToolDefinition["kind"];
}): AgentToolDefinition {
  return {
    name: input.name,
    label: input.name,
    kind: input.kind ?? "read",
    permission: input.name === "parameter.submitChangeDraft" ? "parameter:edit" : "parameter:review",
    requiresApproval: input.requiresApproval,
    run: vi.fn()
  };
}

function createRegistry(
  definitions: AgentToolDefinition[],
  run: (name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) => Promise<AgentToolResult>
) {
  const byName = new Map<AgentToolName, AgentToolDefinition>(
    definitions.map((definition) => [definition.name, definition])
  );
  return {
    list: () => definitions,
    get: vi.fn((name: string) => byName.get(name as AgentToolName)),
    require: vi.fn((name: string) => {
      const definition = byName.get(name as AgentToolName);
      if (!definition) {
        throw new ApiError("VALIDATION_FAILED", "Unknown Agent tool.", 400);
      }
      return definition;
    }),
    run: vi.fn(run)
  };
}

function createPlan(toolRequests: AgentProviderPlan["toolRequests"]): AgentProviderPlan {
  return {
    assistantDraft: { content: "Planned deterministic tools.", citations: [], confidence: 0.8 },
    toolRequests,
    provider: "deterministic",
    model: "wiseeff-rules-m4",
    promptVersion: "m4-agent-v1"
  };
}

describe("agent orchestrator", () => {
  it("startSession creates a session, system message, and audit event", async () => {
    const { db } = createMemoryDb();
    const createAuditEvent = vi.fn();
    const orchestrator = createAgentOrchestrator({ db, createAuditEvent });

    const turn = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-session",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    expect(turn.session.context.projectId).toBe("aurora");
    expect(turn.messages[0]).toMatchObject({ role: "system" });
    expect(createAuditEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        kind: "agent-session",
        traceId: "req-session",
        targetType: "agent_session",
        targetId: turn.session.id
      })
    );
  });

  it("approval-required tool requests create pending approvals without running the tool", async () => {
    const { db } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({
      db,
      toolRegistry: registry,
      provider: createProvider(
        createPlan([
          {
            name: "parameter.submitChangeDraft",
            label: "Create parameter draft",
            payload: { projectId: "aurora", reason: "Stage draft" }
          }
        ])
      )
    });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    const turn = await orchestrator.sendMessage({
      auth: developmentAuthContext,
      requestId: "req-turn",
      sessionId: start.session.id,
      message: "准备一个参数草稿"
    });

    expect(registry.run).not.toHaveBeenCalled();
    expect(turn.toolCalls[0]).toMatchObject({ status: "pending_approval", requiresApproval: true });
    expect(turn.approvals[0]).toMatchObject({ toolCallId: turn.toolCalls[0].id, status: "pending" });
  });

  it("read-only tool requests execute immediately and record success or failure", async () => {
    const { db } = createMemoryDb();
    const registry = createRegistry(
      [
        createToolDefinition({ name: "parameter.summarizeReviewQueue", requiresApproval: false }),
        createToolDefinition({ name: "audit.summarizeRecentEvents", requiresApproval: false })
      ],
      async (name) => {
        if (name === "audit.summarizeRecentEvents") {
          throw new Error("Audit warehouse unavailable");
        }
        return { summary: "1 pending review item.", data: { pending: 1 }, citations: [] };
      }
    );
    const orchestrator = createAgentOrchestrator({
      db,
      toolRegistry: registry,
      provider: createProvider(
        createPlan([
          {
            name: "parameter.summarizeReviewQueue",
            label: "Summarize review queue",
            payload: { projectId: "aurora" }
          },
          {
            name: "audit.summarizeRecentEvents",
            label: "Summarize audit events",
            payload: { projectId: "aurora" }
          }
        ])
      )
    });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    const turn = await orchestrator.sendMessage({
      auth: developmentAuthContext,
      requestId: "req-turn",
      sessionId: start.session.id,
      message: "总结审阅队列和审计"
    });

    expect(registry.run).toHaveBeenCalledTimes(2);
    expect(turn.toolCalls.map((tool) => tool.status)).toEqual(["succeeded", "failed"]);
    expect(turn.toolCalls[0].result?.summary).toBe("1 pending review item.");
    expect(turn.toolCalls[1].error).toBe("Audit warehouse unavailable");
  });

  it("runToolCall rejects pending approval calls with an approval-required ApiError", async () => {
    const { db } = createMemoryDb();
    const orchestrator = createAgentOrchestrator({ db });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId: start.session.id,
      request: {
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: { projectId: "aurora", reason: "Stage draft" }
      }
    });

    await expect(
      orchestrator.runToolCall({
        auth: developmentAuthContext,
        requestId: "req-run",
        toolCallId: toolCall.id
      })
    ).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
      status: 409,
      message: "Tool call requires approval."
    });
  });

  it("approveToolCall re-checks registry execution, approves, succeeds the tool, and appends an assistant message", async () => {
    const { db } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({
        summary: "Created one parameter draft for human review.",
        data: { draftId: "draft-1", projectId: "aurora" },
        citations: [{ type: "parameter", id: "draft-1", label: "Parameter draft draft-1" }]
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId: start.session.id,
      request: {
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: { projectId: "aurora", reason: "Stage draft" }
      }
    });

    const turn = await orchestrator.approveToolCall({
      auth: developmentAuthContext,
      requestId: "req-approve",
      approvalId: toolCall.approvalId ?? "",
      reason: "Looks safe"
    });

    expect(registry.run).toHaveBeenCalledTimes(1);
    expect(turn.approvals[0]).toMatchObject({ status: "approved", decidedByUserId: developmentAuthContext.user.id });
    expect(turn.toolCalls[0]).toMatchObject({ status: "succeeded" });
    expect(turn.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("Created one parameter draft")
    });
  });

  it("rejectToolCall marks approval and tool rejected, then appends an assistant message", async () => {
    const { db } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId: start.session.id,
      request: {
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: { projectId: "aurora", reason: "Stage draft" }
      }
    });

    const turn = await orchestrator.rejectToolCall({
      auth: developmentAuthContext,
      requestId: "req-reject",
      approvalId: toolCall.approvalId ?? "",
      reason: "Need clearer evidence"
    });

    expect(registry.run).not.toHaveBeenCalled();
    expect(turn.approvals[0]).toMatchObject({ status: "rejected", reason: "Need clearer evidence" });
    expect(turn.toolCalls[0]).toMatchObject({ status: "rejected", error: "Need clearer evidence" });
    expect(turn.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("rejected")
    });
  });
});
