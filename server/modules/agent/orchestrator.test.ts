import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { developmentAuthContext } from "../auth/routes";
import type { AuthContext } from "../auth/types";
import { createAgentSession } from "./repository";
import type { AgentToolExecutionContext } from "./toolRegistry";
import { createAgentOrchestrator } from "./orchestrator";
import type { AgentToolDefinition } from "./toolRegistry";
import type { AgentToolName, AgentToolResult } from "./types";

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
    audits: [] as MemoryRow[]
  };

  function cloneTables() {
    return {
      sessions: tables.sessions.map((row) => ({ ...row })),
      messages: tables.messages.map((row) => ({ ...row })),
      toolCalls: tables.toolCalls.map((row) => ({ ...row })),
      approvals: tables.approvals.map((row) => ({ ...row })),
      traces: tables.traces.map((row) => ({ ...row })),
      audits: tables.audits.map((row) => ({ ...row }))
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

function createToolDefinition(input: {
  name: AgentToolName;
  requiresApproval: boolean;
  kind?: AgentToolDefinition["kind"];
}): AgentToolDefinition {
  return {
    name: input.name,
    label: input.name,
    kind: input.kind ?? "read",
    permission: input.name === "action.submitParameterChange" ? "parameter:edit" : "parameter:view",
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

function createAgentMetricsSpy() {
  return {
    recordAgentApproval: vi.fn(),
    recordAgentToolResult: vi.fn(),
    recordAuditWriteFailure: vi.fn()
  };
}

function createTraceRecorder() {
  const spans: Parameters<TraceExporter>[0][] = [];
  return {
    spans,
    tracing: createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    })
  };
}

async function createTestSession(db: Database) {
  const sessionId = `agent-session-${randomUUID()}`;
  await createAgentSession(db, {
    id: sessionId,
    organizationId: developmentAuthContext.organization.id,
    projectId: "aurora",
    actorUserId: developmentAuthContext.user.id,
    pageKey: "xiaoze",
    roleId: "hardware-user",
    context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
    title: "Test Agent Session"
  });
  return sessionId;
}

describe("agent orchestrator", () => {
  it("records Agent audit events with human initiator correlation", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({
        summary: "Submitted parameter change request draft-1 for review.",
        data: { changeRequestId: "draft-1", projectId: "aurora" },
        citations: []
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-agent-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
          action: "approval-requested",
          actor_type: "agent",
          actor_user_id: developmentAuthContext.user.id,
          trace_id: "req-agent-tool",
          metadata: expect.objectContaining({
            initiatedByUserId: developmentAuthContext.user.id,
            sessionId,
            toolCallId: toolCall.id,
            approvalId: toolCall.approvalId,
            toolName: "action.submitParameterChange"
          })
        }),
        expect.objectContaining({
          action: "approval-executed",
          actor_type: "agent",
          actor_user_id: developmentAuthContext.user.id,
          trace_id: "req-agent-approve",
          metadata: expect.objectContaining({
            initiatedByUserId: developmentAuthContext.user.id,
            sessionId,
            toolCallId: toolCall.id,
            approvalId: toolCall.approvalId,
            toolName: "action.submitParameterChange"
          })
        })
      ])
    );
  });

  it("approval-required tool requests create pending approvals without running the tool", async () => {
    const { db } = createMemoryDb();
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, metrics });
    const sessionId = await createTestSession(db);

    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-turn",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
      }
    });

    expect(registry.run).not.toHaveBeenCalled();
    expect(toolCall).toMatchObject({ status: "pending_approval", requiresApproval: true });
    expect(metrics.recordAgentApproval).toHaveBeenCalledWith({
      action: "requested",
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true
    });
  });

  it("exports low-cardinality direct tool execution spans without payload or identifiers", async () => {
    const { db } = createMemoryDb();
    const { spans, tracing } = createTraceRecorder();
    const registry = createRegistry(
      [createToolDefinition({ name: "perception.getProjectOverview", requiresApproval: false })],
      async () => ({ summary: "Project overview ready.", data: { parameterCount: 1 }, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, tracing });
    const sessionId = await createTestSession(db);

    await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-turn-secret",
      sessionId,
      request: {
        name: "perception.getProjectOverview",
        label: "Get project overview",
        payload: { projectId: "aurora", secretFilter: "do-not-export" }
      }
    });

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent.tool.execute",
          attributes: expect.objectContaining({
            service: "wiseeff-api",
            tool: "perception.getProjectOverview",
            kind: "read",
            requiresApproval: false,
            status: "succeeded"
          })
        })
      ])
    );
    expect(JSON.stringify(spans)).not.toContain(sessionId);
    expect(JSON.stringify(spans)).not.toContain("agent-tool");
    expect(JSON.stringify(spans)).not.toContain("aurora");
    expect(JSON.stringify(spans)).not.toContain("do-not-export");
    expect(JSON.stringify(spans)).not.toContain("req-turn-secret");
  });

  it("runToolCall rejects pending approval calls with an approval-required ApiError", async () => {
    const { db } = createMemoryDb();
    const orchestrator = createAgentOrchestrator({ db });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({
        summary: "Submitted parameter change request draft-1 for review.",
        data: { changeRequestId: "draft-1", projectId: "aurora" },
        citations: [{ type: "parameter", id: "draft-1", label: "Change request draft-1" }]
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, metrics });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
      content: expect.stringContaining("Submitted parameter change request")
    });
    expect(metrics.recordAgentApproval).toHaveBeenCalledWith({
      action: "approved",
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true
    });
    expect(metrics.recordAgentToolResult).toHaveBeenCalledWith({
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true,
      status: "succeeded"
    });
  });

  it("exports low-cardinality approval-time tool execution spans without approval payload or result details", async () => {
    const { db } = createMemoryDb();
    const { spans, tracing } = createTraceRecorder();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({
        summary: "Submitted parameter change request draft-secret for review.",
        data: { changeRequestId: "draft-secret", projectId: "aurora" },
        citations: [{ type: "parameter", id: "draft-secret", label: "Change request draft-secret" }]
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, tracing });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool-secret",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "secret reason" }
      }
    });

    await orchestrator.approveToolCall({
      auth: developmentAuthContext,
      requestId: "req-approve-secret",
      approvalId: toolCall.approvalId ?? "",
      reason: "Looks safe"
    });

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent.tool.execute",
          attributes: expect.objectContaining({
            service: "wiseeff-api",
            tool: "action.submitParameterChange",
            kind: "mutating",
            requiresApproval: true,
            status: "succeeded"
          })
        })
      ])
    );
    expect(JSON.stringify(spans)).not.toContain(sessionId);
    expect(JSON.stringify(spans)).not.toContain(toolCall.id);
    expect(JSON.stringify(spans)).not.toContain(toolCall.approvalId ?? "");
    expect(JSON.stringify(spans)).not.toContain("aurora");
    expect(JSON.stringify(spans)).not.toContain("secret reason");
    expect(JSON.stringify(spans)).not.toContain("draft-secret");
    expect(JSON.stringify(spans)).not.toContain("req-approve-secret");
  });

  it("approveToolCall does not execute when the pending approval claim is stale", async () => {
    const { db } = createMemoryDb({ failApprovalUpdates: true });
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    registry.authorize.mockImplementationOnce(() => {
      throw new ApiError("FORBIDDEN", "Missing permission: parameter:edit.", 403, { permission: "parameter:edit" });
    });
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => {
        throw new Error("Draft service unavailable");
      }
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, metrics });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
    expect(metrics.recordAgentApproval).toHaveBeenCalledWith({
      action: "approved",
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true
    });
    expect(metrics.recordAgentToolResult).toHaveBeenCalledWith({
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true,
      status: "failed"
    });
  });

  it("rolls back approval execution writes when the approval audit event cannot be recorded", async () => {
    const { db, tables } = createMemoryDb({ failAuditActions: ["approval-executed"] });
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({
        summary: "Submitted parameter change request draft-1 for review.",
        data: { changeRequestId: "draft-1", projectId: "aurora" },
        citations: []
      })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, metrics });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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

    expect(tables.approvals[0]).toMatchObject({ status: "pending", decided_by_user_id: null });
    expect(tables.toolCalls[0]).toMatchObject({ status: "pending_approval", result: null });
    expect(tables.messages).toHaveLength(messageCount);
    expect(metrics.recordAuditWriteFailure).toHaveBeenCalledWith({
      kind: "agent-tool",
      action: "approval-executed",
      targetType: "agent_tool_call"
    });
  });

  it("rejectToolCall marks approval and tool rejected, then appends an assistant message", async () => {
    const { db } = createMemoryDb();
    const metrics = createAgentMetricsSpy();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry, metrics });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
    expect(metrics.recordAgentApproval).toHaveBeenCalledWith({
      action: "rejected",
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true
    });
    expect(metrics.recordAgentToolResult).toHaveBeenCalledWith({
      tool: "action.submitParameterChange",
      kind: "mutating",
      requiresApproval: true,
      status: "rejected"
    });
  });

  it("rejectToolCall does not append assistant message or audit when the reject claim is stale", async () => {
    const { db, tables } = createMemoryDb({ failApprovalUpdates: true });
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequestForTest({
      auth: developmentAuthContext,
      requestId: "req-tool",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
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
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);

    await expect(
      orchestrator.recordToolRequestForTest({
        auth: developmentAuthContext,
        requestId: "req-tool",
        sessionId,
        request: {
          name: "action.submitParameterChange",
          label: "Submit parameter change",
          payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
        }
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(registry.run).not.toHaveBeenCalled();
  });
});
