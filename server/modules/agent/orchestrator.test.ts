import { describe, expect, it, vi } from "vitest";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { developmentAuthContext } from "../auth/routes";
import type { AuthContext } from "../auth/types";
import type { AgentToolExecutionContext } from "./toolRegistry";
import { createAgentOrchestrator } from "./orchestrator";
import { createDeterministicAgentProvider } from "./provider";
import type { AgentProviderPlan } from "./provider";
import type { AgentToolDefinition } from "./toolRegistry";
import type { AgentToolName, AgentToolResult } from "./types";
import { createHttpLiveAgentTransport, createLiveAgentProvider, LiveAgentProviderOutageError } from "./liveProvider";

describe("deterministic agent provider", () => {
  it("selects parameter review and draft tools from parameter context", async () => {
    const provider = createDeterministicAgentProvider();
    const plan = await provider.planTurn({
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

function createMemoryDb(
  options: { failApprovalUpdates?: boolean; failToolUpdateStatuses?: string[]; failAuditActions?: string[] } = {}
) {
  const tables = {
    sessions: [] as MemoryRow[],
    messages: [] as MemoryRow[],
    toolCalls: [] as MemoryRow[],
    approvals: [] as MemoryRow[],
    traces: [] as MemoryRow[],
    audits: [] as MemoryRow[],
    parameterDrafts: [] as MemoryRow[]
  };

  function cloneTables() {
    return {
      sessions: tables.sessions.map((row) => ({ ...row })),
      messages: tables.messages.map((row) => ({ ...row })),
      toolCalls: tables.toolCalls.map((row) => ({ ...row })),
      approvals: tables.approvals.map((row) => ({ ...row })),
      traces: tables.traces.map((row) => ({ ...row })),
      audits: tables.audits.map((row) => ({ ...row })),
      parameterDrafts: tables.parameterDrafts.map((row) => ({ ...row }))
    };
  }

  function replaceTables(nextTables: typeof tables) {
    for (const key of Object.keys(tables) as Array<keyof typeof tables>) {
      tables[key].splice(0, tables[key].length, ...nextTables[key].map((row) => ({ ...row })));
    }
  }

  function queryableFor(targetTables: typeof tables): Queryable {
    return {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        const sql = text.replace(/\s+/g, " ").trim();

        if (sql.includes("insert into agent_sessions")) {
          targetTables.sessions.push({
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
            rows: targetTables.sessions.filter((row) => row.organization_id === values[0] && row.id === values[1]) as Row[],
            rowCount: 1
          };
        }
        if (sql.includes("insert into agent_messages")) {
          targetTables.messages.push({
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
            rows: targetTables.messages.filter((row) => row.organization_id === values[0] && row.session_id === values[1]) as Row[],
            rowCount: 1
          };
        }
        if (sql.includes("insert into agent_tool_calls")) {
          targetTables.toolCalls.push({
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
        if (options.failToolUpdateStatuses?.includes(String(values[2]))) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        const row = targetTables.toolCalls.find((item) => item.organization_id === values[0] && item.id === values[1]);
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
        const rows = targetTables.toolCalls
          .filter((row) =>
            sql.includes("session_id = $2")
              ? row.organization_id === values[0] && row.session_id === values[1]
              : row.organization_id === values[0] && row.id === values[1]
          )
          .map((row) => ({
            ...row,
            approval_id: targetTables.approvals.find((approval) => approval.tool_call_id === row.id)?.id ?? null
          }));
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_approvals")) {
        targetTables.approvals.push({
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
        if (options.failApprovalUpdates) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        const row = targetTables.approvals.find(
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
          rows: targetTables.approvals.filter((row) =>
            sql.includes("session_id = $2")
              ? row.organization_id === values[0] && row.session_id === values[1]
              : row.organization_id === values[0] && row.id === values[1]
          ) as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into agent_run_traces")) {
        targetTables.traces.push({
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
          latency_ms: values[11],
          input_tokens: values[12],
          output_tokens: values[13],
          estimated_cost_usd: values[14],
          safety_status: values[15],
          safety_reasons: values[16],
          fallback_reason: values[17],
          created_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("insert into audit_events")) {
        if (options.failAuditActions?.includes(String(values[7]))) {
          throw new Error("Audit sink unavailable");
        }
        targetTables.audits.push({
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          actor_user_id: values[3],
          actor_type: values[4],
          app: values[5],
          kind: values[6],
          action: values[7],
          severity: values[8],
          target_type: values[9],
          target_id: values[10],
          metadata: values[11],
          trace_id: values[12]
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from project_parameter_values ppv")) {
        return {
          rows: [
            {
              id: "project-param-1",
              project_id: values[1],
              parameter_definition_id: "parameter-definition-1",
              current_value: "3000"
            }
          ] as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into parameter_drafts")) {
        const existing = targetTables.parameterDrafts.find(
          (row) => row.project_id === values[2] && row.project_parameter_value_id === values[3] && row.user_id === values[4]
        );
        const row = existing ?? {
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          project_parameter_value_id: values[3],
          user_id: values[4]
        };
        row.target_value = values[5];
        row.reason = values[6];
        if (!existing) {
          targetTables.parameterDrafts.push(row);
        }
        return { rows: [{ id: row.id }] as Row[], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in test DB: ${sql}`);
    }
  };
  }

  const queryable = queryableFor(tables);

  const db: Database = {
    ...queryable,
    transaction: async (fn) => {
      const txTables = cloneTables();
      const tx = queryableFor(txTables);
      const result = await fn(tx);
      replaceTables(txTables);
      return result;
    }
  };

  return { db, tables };
}

function createProvider(plan: AgentProviderPlan) {
  return {
    metadata: vi.fn(() => ({
      provider: plan.provider,
      model: plan.model,
      promptVersion: plan.promptVersion
    })),
    planTurn: vi.fn(() => plan)
  };
}

function createOutageProvider(message = "Live Agent provider is temporarily unavailable.") {
  return {
    metadata: vi.fn(() => ({
      provider: "live" as const,
      model: "pilot-model",
      promptVersion: "m5-agent-v1"
    })),
    checkHealth: vi.fn(async () => ({
      ok: false as const,
      status: "failed" as const,
      message
    })),
    planTurn: vi.fn()
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
    authorize: vi.fn(),
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

function createAgentMetricsSpy() {
  return {
    recordAgentProviderCall: vi.fn()
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

  it("records Agent audit events with human initiator correlation", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({
        summary: "Created one parameter draft for human review.",
        data: { draftId: "draft-1", projectId: "aurora" },
        citations: []
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });

    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-agent-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-agent-tool",
      sessionId: start.session.id,
      request: {
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: { projectId: "aurora", reason: "Stage draft" }
      }
    });
    await orchestrator.approveToolCall({
      auth: developmentAuthContext,
      requestId: "req-agent-approve",
      approvalId: toolCall.approvalId ?? "",
      reason: "Looks safe"
    });
    const auditRows = tables.audits.map((audit) => ({
      ...audit,
      metadata: typeof audit.metadata === "string" ? JSON.parse(audit.metadata) : audit.metadata
    }));

    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "started",
          actor_type: "agent",
          actor_user_id: developmentAuthContext.user.id,
          trace_id: "req-agent-start",
          metadata: expect.objectContaining({
            initiatedByUserId: developmentAuthContext.user.id,
            sessionId: start.session.id,
            pageKey: "parameters"
          })
        }),
        expect.objectContaining({
          action: "approval-requested",
          actor_type: "agent",
          actor_user_id: developmentAuthContext.user.id,
          trace_id: "req-agent-tool",
          metadata: expect.objectContaining({
            initiatedByUserId: developmentAuthContext.user.id,
            sessionId: start.session.id,
            toolCallId: toolCall.id,
            approvalId: toolCall.approvalId,
            toolName: "parameter.submitChangeDraft"
          })
        }),
        expect.objectContaining({
          action: "approval-executed",
          actor_type: "agent",
          actor_user_id: developmentAuthContext.user.id,
          trace_id: "req-agent-approve",
          metadata: expect.objectContaining({
            initiatedByUserId: developmentAuthContext.user.id,
            sessionId: start.session.id,
            toolCallId: toolCall.id,
            approvalId: toolCall.approvalId,
            toolName: "parameter.submitChangeDraft"
          })
        })
      ])
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

  it("records provider call metrics for successful Agent turns", async () => {
    const { db } = createMemoryDb();
    const provider = createProvider(createPlan([]));
    const metrics = createAgentMetricsSpy();
    const orchestrator = createAgentOrchestrator({ db, provider, metrics });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    await orchestrator.sendMessage({
      auth: developmentAuthContext,
      requestId: "req-message",
      sessionId: start.session.id,
      message: "Summarize"
    });

    expect(metrics.recordAgentProviderCall).toHaveBeenCalledWith({
      provider: "deterministic",
      status: "succeeded",
      durationMs: expect.any(Number)
    });
  });

  it("read-only tool requests record failure audit and rethrow execution failures", async () => {
    const { db, tables } = createMemoryDb();
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

    await expect(
      orchestrator.sendMessage({
        auth: developmentAuthContext,
        requestId: "req-turn",
        sessionId: start.session.id,
        message: "总结审阅队列和审计"
      })
    ).rejects.toThrow("Audit warehouse unavailable");

    expect(registry.run).toHaveBeenCalledTimes(2);
    expect(tables.toolCalls.map((tool) => tool.status)).toEqual(["succeeded", "failed"]);
    expect(tables.toolCalls[1].error_message).toBe("Audit warehouse unavailable");
    expect(tables.audits.at(-1)).toMatchObject({ action: "failed", trace_id: "req-turn" });
  });

  it("sendMessage records degraded output and fallback reason when the live provider is unavailable", async () => {
    const { db, tables } = createMemoryDb();
    const provider = createOutageProvider("model health check failed");
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, provider, toolRegistry: registry, metrics });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    const turn = await orchestrator.sendMessage({
      auth: developmentAuthContext,
      requestId: "req-message",
      sessionId: start.session.id,
      message: "Create a draft"
    });

    expect(provider.checkHealth).toHaveBeenCalledTimes(1);
    expect(provider.planTurn).not.toHaveBeenCalled();
    expect(registry.run).not.toHaveBeenCalled();
    expect(turn.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("temporarily unavailable")
    });
    expect(tables.traces[0]).toMatchObject({
      provider: "live",
      model: "pilot-model",
      prompt_version: "m5-agent-v1",
      fallback_reason: "model health check failed",
      tool_call_ids: []
    });
    expect(metrics.recordAgentProviderCall).toHaveBeenCalledWith({
      provider: "live",
      status: "health_unavailable",
      durationMs: expect.any(Number)
    });
  });

  it("records outage fallback metrics when live provider planning is unavailable", async () => {
    const { db, tables } = createMemoryDb();
    const metrics = createAgentMetricsSpy();
    const provider = {
      metadata: vi.fn(() => ({
        provider: "live" as const,
        model: "pilot-model",
        promptVersion: "m5-agent-v1"
      })),
      checkHealth: vi.fn(async () => ({ ok: true as const, status: "ready" as const })),
      planTurn: vi.fn(async () => {
        throw new LiveAgentProviderOutageError("provider timed out");
      })
    };
    const orchestrator = createAgentOrchestrator({ db, provider, metrics });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    const turn = await orchestrator.sendMessage({
      auth: developmentAuthContext,
      requestId: "req-message",
      sessionId: start.session.id,
      message: "Summarize"
    });

    expect(turn.messages.at(-1)).toMatchObject({ content: expect.stringContaining("temporarily unavailable") });
    expect(tables.traces[0]).toMatchObject({ fallback_reason: "provider timed out" });
    expect(metrics.recordAgentProviderCall).toHaveBeenCalledWith({
      provider: "live",
      status: "outage_fallback",
      durationMs: expect.any(Number)
    });
  });

  it("does not fall back when the live provider response is malformed", async () => {
    const { db, tables } = createMemoryDb();
    const metrics = createAgentMetricsSpy();
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "I can do that.",
          toolRequests: { name: "parameter.summarizeReviewQueue" } as unknown as never[],
          citations: [],
          confidence: 0.9,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 10,
          safety: { status: "safe", reasons: [] }
        } as any)),
        checkHealth: vi.fn(async () => ({ ok: true as const, status: "ready" as const }))
      }
    });
    const orchestrator = createAgentOrchestrator({ db, provider, metrics });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    await expect(
      orchestrator.sendMessage({
        auth: developmentAuthContext,
        requestId: "req-message",
        sessionId: start.session.id,
        message: "Summarize"
      })
    ).rejects.toThrow("malformed toolRequests");

    expect(tables.messages.at(-1)?.content).not.toContain("temporarily unavailable");
    expect(tables.traces).toHaveLength(0);
    expect(metrics.recordAgentProviderCall).toHaveBeenCalledWith({
      provider: "live",
      status: "failed",
      durationMs: expect.any(Number)
    });
  });

  it("does not fall back when the live provider returns a contract error response", async () => {
    const { db, tables } = createMemoryDb();
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/agent/health") && init?.method === "GET") {
          return new Response(JSON.stringify({ ok: true, status: "ready" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: "unprocessable" }), {
          status: 422,
          headers: { "content-type": "application/json" }
        });
      })
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });
    const orchestrator = createAgentOrchestrator({ db, provider });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    await expect(
      orchestrator.sendMessage({
        auth: developmentAuthContext,
        requestId: "req-message",
        sessionId: start.session.id,
        message: "Summarize"
      })
    ).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });

    expect(tables.messages.at(-1)?.content).not.toContain("temporarily unavailable");
    expect(tables.traces).toHaveLength(0);
  });

  it("does not fall back when live provider health is a contract error", async () => {
    const { db, tables } = createMemoryDb();
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/agent/health") && init?.method === "GET") {
          return new Response("{not-json", {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(
          JSON.stringify({
            content: "I can do that.",
            toolRequests: [],
            citations: [],
            confidence: 0.9,
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
            latencyMs: 10,
            safety: { status: "safe", reasons: [] }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      })
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });
    const orchestrator = createAgentOrchestrator({ db, provider });
    const start = await orchestrator.startSession({
      auth: developmentAuthContext,
      requestId: "req-start",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    await expect(
      orchestrator.sendMessage({
        auth: developmentAuthContext,
        requestId: "req-message",
        sessionId: start.session.id,
        message: "Summarize"
      })
    ).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });

    expect(tables.messages.at(-1)?.content).not.toContain("temporarily unavailable");
    expect(tables.traces).toHaveLength(0);
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

  it("approveToolCall does not execute when the pending approval claim is stale", async () => {
    const { db } = createMemoryDb({ failApprovalUpdates: true });
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

    await expect(
      orchestrator.approveToolCall({
        auth: developmentAuthContext,
        requestId: "req-approve",
        approvalId: toolCall.approvalId ?? "",
        reason: "Looks safe"
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(registry.run).not.toHaveBeenCalled();
  });

  it("approveToolCall preserves pending approval state when approval-time authorization fails", async () => {
    const { db, tables } = createMemoryDb();
    const guestAuthContext: AuthContext = {
      ...developmentAuthContext,
      user: { ...developmentAuthContext.user, id: "u-guest" },
      roles: [{ projectId: "aurora", roleId: "guest" }],
      permissions: ["parameter:view"]
    };
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    registry.authorize.mockImplementationOnce(() => {
      throw new ApiError("FORBIDDEN", "Missing permission: parameter:edit.", 403, { permission: "parameter:edit" });
    });
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

    await expect(
      orchestrator.approveToolCall({
        auth: guestAuthContext,
        requestId: "req-approve",
        approvalId: toolCall.approvalId ?? "",
        reason: "Looks safe"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(registry.authorize).toHaveBeenCalledTimes(1);
    expect(registry.run).not.toHaveBeenCalled();
    expect(tables.approvals[0]).toMatchObject({ status: "pending", decided_by_user_id: null });
    expect(tables.toolCalls[0]).toMatchObject({ status: "pending_approval", error_message: null });
  });

  it("approveToolCall records a failed tool call and failure audit when execution fails after approval claim", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "parameter.submitChangeDraft", kind: "preparation", requiresApproval: true })],
      async () => {
        throw new Error("Draft service unavailable");
      }
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

    await expect(
      orchestrator.approveToolCall({
        auth: developmentAuthContext,
        requestId: "req-approve",
        approvalId: toolCall.approvalId ?? "",
        reason: "Looks safe"
      })
    ).rejects.toThrow("Draft service unavailable");

    expect(tables.approvals[0].status).toBe("approved");
    expect(tables.toolCalls[0]).toMatchObject({ status: "failed", error_message: "Draft service unavailable" });
    expect(tables.audits.at(-1)).toMatchObject({ action: "approval-execution-failed", trace_id: "req-approve" });
  });

  it("rolls back approval execution writes when the approval audit event cannot be recorded", async () => {
    const { db, tables } = createMemoryDb({ failAuditActions: ["approval-executed"] });
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
    const messageCount = tables.messages.length;

    await expect(
      orchestrator.approveToolCall({
        auth: developmentAuthContext,
        requestId: "req-approve",
        approvalId: toolCall.approvalId ?? "",
        reason: "Looks safe"
      })
    ).rejects.toThrow("Audit sink unavailable");

    expect(tables.parameterDrafts).toHaveLength(0);
    expect(tables.approvals[0]).toMatchObject({ status: "pending", decided_by_user_id: null });
    expect(tables.toolCalls[0]).toMatchObject({ status: "pending_approval", result: null });
    expect(tables.messages).toHaveLength(messageCount);
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

  it("rejectToolCall does not append assistant message or audit when the reject claim is stale", async () => {
    const { db, tables } = createMemoryDb({ failApprovalUpdates: true });
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
    const messageCount = tables.messages.length;
    const auditCount = tables.audits.length;

    await expect(
      orchestrator.rejectToolCall({
        auth: developmentAuthContext,
        requestId: "req-reject",
        approvalId: toolCall.approvalId ?? "",
        reason: "Need clearer evidence"
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(tables.messages).toHaveLength(messageCount);
    expect(tables.audits).toHaveLength(auditCount);
    expect(tables.toolCalls[0].status).toBe("pending_approval");
  });

  it("raises a conflict when an important tool call transition is stale", async () => {
    const { db } = createMemoryDb({ failToolUpdateStatuses: ["pending_approval"] });
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

    await expect(
      orchestrator.recordToolRequestForTest({
        auth: developmentAuthContext,
        requestId: "req-tool",
        sessionId: start.session.id,
        request: {
          name: "parameter.submitChangeDraft",
          label: "Create parameter draft",
          payload: { projectId: "aurora", reason: "Stage draft" }
        }
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(registry.run).not.toHaveBeenCalled();
  });
});
