import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { developmentAuthContext } from "../auth/routes";
import type { AuthContext } from "../auth/types";
import { createAgentSession } from "./repository";
import type { AgentToolExecutionContext } from "./toolRegistry";
import { createAgentOrchestrator, type ApprovalBeginInput } from "./orchestrator";
import type { AgentToolDefinition } from "./toolRegistry";
import type { AgentToolName, AgentToolResult } from "./types";
import { createMemoryAgentDb as createMemoryDb } from "./testing/memoryAgentDb";

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
        throw new ApiError("VALIDATION_FAILED", "Unknown Agent tool.");
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
    const toolCall = await orchestrator.recordToolRequest({
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

    const toolCall = await orchestrator.recordToolRequest({
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

  it("refuses approval decisions from a same-org user other than the requester", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "executed", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequest({
      auth: developmentAuthContext,
      requestId: "req-owner-turn",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
      }
    });
    const intruderAuth: AuthContext = {
      ...developmentAuthContext,
      user: { ...developmentAuthContext.user, id: "u-intruder" }
    };

    await expect(
      orchestrator.approveToolCall({
        auth: intruderAuth,
        requestId: "req-intruder-approve",
        approvalId: toolCall.approvalId ?? "",
        reason: "hijack"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      orchestrator.rejectToolCall({
        auth: intruderAuth,
        requestId: "req-intruder-reject",
        approvalId: toolCall.approvalId ?? "",
        reason: "hijack"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(registry.run).not.toHaveBeenCalled();
    expect(tables.approvals[0]?.status).toBe("pending");

    // The requesting user can still decide their own approval.
    await orchestrator.approveToolCall({
      auth: developmentAuthContext,
      requestId: "req-owner-approve",
      approvalId: toolCall.approvalId ?? "",
      reason: "Looks safe"
    });
    expect(registry.run).toHaveBeenCalledTimes(1);
  });

  it("refuses resolveApproval edited args from a non-requester before touching the payload", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "executed", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequest({
      auth: developmentAuthContext,
      requestId: "req-owner-turn",
      sessionId,
      request: {
        name: "action.submitParameterChange",
        label: "Submit parameter change",
        payload: { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" }
      }
    });
    const intruderAuth: AuthContext = {
      ...developmentAuthContext,
      user: { ...developmentAuthContext.user, id: "u-intruder" }
    };

    await expect(
      orchestrator.resolveApproval({
        auth: intruderAuth,
        requestId: "req-intruder-resolve",
        approvalId: toolCall.approvalId ?? "",
        decision: "approve",
        editedArgs: { projectId: "aurora", parameterId: "pd-1", targetValue: "9999", reason: "hijacked" }
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(registry.run).not.toHaveBeenCalled();
    expect(tables.approvals[0]?.status).toBe("pending");
    expect(JSON.stringify(tables.toolCalls)).not.toContain("9999");
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

    await orchestrator.recordToolRequest({
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
    const toolCall = await orchestrator.recordToolRequest({
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

  it("approveToolCall re-checks registry execution, approves, and succeeds the tool without appending an assistant message", async () => {
    const { db, tables } = createMemoryDb();
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
    const toolCall = await orchestrator.recordToolRequest({
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

    const turn = await orchestrator.approveToolCall({
      auth: developmentAuthContext,
      requestId: "req-approve",
      approvalId: toolCall.approvalId ?? "",
      reason: "Looks safe"
    });

    expect(registry.run).toHaveBeenCalledTimes(1);
    expect(turn.approvals[0]).toMatchObject({ status: "approved", decidedByUserId: developmentAuthContext.user.id });
    expect(turn.toolCalls[0]).toMatchObject({ status: "succeeded" });
    expect(turn.toolCalls[0].result?.summary).toContain("Submitted parameter change request");
    expect(tables.messages).toHaveLength(messageCount);
    expect(turn.messages.filter((message) => message.role === "assistant")).toEqual([]);
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
    const toolCall = await orchestrator.recordToolRequest({
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
    const toolCall = await orchestrator.recordToolRequest({
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
    // Same requesting user, but their permissions were downgraded between the
    // request and the approval, so approval-time re-authorization must refuse.
    const guestAuthContext: AuthContext = {
      ...developmentAuthContext,
      roles: [{ projectId: "aurora", roleId: "guest" }],
      permissions: ["parameter:view"]
    };
    const registry = createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async () => ({ summary: "should not run", data: {}, citations: [] })
    );
    registry.authorize.mockImplementationOnce(() => {
      throw new ApiError("FORBIDDEN", "Missing permission: parameter:edit.", { permission: "parameter:edit" });
    });
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const sessionId = await createTestSession(db);
    const toolCall = await orchestrator.recordToolRequest({
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
    const toolCall = await orchestrator.recordToolRequest({
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
    expect(tables.messages.filter((row) => row.role === "assistant")).toEqual([]);
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
    const toolCall = await orchestrator.recordToolRequest({
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
    const toolCall = await orchestrator.recordToolRequest({
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
    const toolCall = await orchestrator.recordToolRequest({
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
      orchestrator.recordToolRequest({
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

describe("agent approval chain (beginApproval / resolveApproval)", () => {
  const mutatingPayload = { projectId: "aurora", parameterId: "pd-1", targetValue: "3100", reason: "Stage draft" };

  function createMutatingRegistry() {
    return createRegistry(
      [createToolDefinition({ name: "action.submitParameterChange", kind: "mutating", requiresApproval: true })],
      async (_name, _context, payload) => ({
        summary: `Submitted parameter change with target ${String(payload.targetValue)}.`,
        data: { payload },
        citations: []
      })
    );
  }

  function beginInput(sessionId: string, overrides: Partial<ApprovalBeginInput> = {}): ApprovalBeginInput {
    return {
      auth: developmentAuthContext,
      requestId: "req-begin",
      sessionId,
      toolName: "action.submitParameterChange",
      payload: mutatingPayload,
      citations: [],
      pageKey: "xiaoze",
      projectId: "aurora",
      ...overrides
    };
  }

  it("beginApproval creates the session when missing and opens a pending approval without executing", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createMutatingRegistry();
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });

    const begun = await orchestrator.beginApproval(beginInput("thread-begin"));

    expect(begun.approvalId).toBeTruthy();
    expect(begun.toolCallId).toBeTruthy();
    expect(begun.payload).toEqual(mutatingPayload);
    expect(registry.run).not.toHaveBeenCalled();
    expect(tables.sessions).toHaveLength(1);
    expect(tables.sessions[0]).toMatchObject({ id: "thread-begin", page_key: "xiaoze" });
    expect(tables.toolCalls[0]).toMatchObject({ status: "pending_approval" });
    expect(tables.approvals[0]).toMatchObject({ status: "pending", tool_call_id: begun.toolCallId });
  });

  it("beginApproval refuses tools that do not require approval", async () => {
    const { db } = createMemoryDb();
    const registry = createRegistry(
      [createToolDefinition({ name: "perception.getProjectOverview", requiresApproval: false })],
      async () => ({ summary: "ok", data: {}, citations: [] })
    );
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });

    await expect(
      orchestrator.beginApproval(beginInput("thread-read", { toolName: "perception.getProjectOverview" }))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("resolveApproval reject uses the default Xiaoze reason and does not execute", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createMutatingRegistry();
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const begun = await orchestrator.beginApproval(beginInput("thread-reject"));

    const resolved = await orchestrator.resolveApproval({
      auth: developmentAuthContext,
      requestId: "req-reject",
      approvalId: begun.approvalId,
      decision: "reject"
    });

    expect(registry.run).not.toHaveBeenCalled();
    expect(tables.approvals[0]).toMatchObject({ status: "rejected", decision_reason: "Rejected from Xiaoze chat." });
    expect(tables.toolCalls[0]).toMatchObject({ status: "rejected" });
    expect(resolved.text.toLowerCase()).toContain("rejected");
  });

  it("resolveApproval approve with editedArgs replaces the payload before authorization and execution", async () => {
    const { db, tables } = createMemoryDb();
    const registry = createMutatingRegistry();
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const begun = await orchestrator.beginApproval(beginInput("thread-edited"));
    const editedArgs = { ...mutatingPayload, targetValue: "9999" };

    const resolved = await orchestrator.resolveApproval({
      auth: developmentAuthContext,
      requestId: "req-approve",
      approvalId: begun.approvalId,
      decision: "approve",
      editedArgs
    });

    expect(registry.run).toHaveBeenCalledTimes(1);
    expect(registry.run).toHaveBeenCalledWith(
      "action.submitParameterChange",
      expect.anything(),
      expect.objectContaining({ targetValue: "9999" })
    );
    expect(JSON.parse(String(tables.toolCalls[0].payload))).toMatchObject({ targetValue: "9999" });
    expect(tables.toolCalls[0]).toMatchObject({ status: "succeeded" });
    expect(tables.approvals[0]).toMatchObject({ status: "approved" });
    expect(resolved.text).toContain("9999");
  });

  it("resolveApproval with editedArgs on a decided approval raises an invalid-state conflict", async () => {
    const { db } = createMemoryDb();
    const registry = createMutatingRegistry();
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const begun = await orchestrator.beginApproval(beginInput("thread-decided"));
    await orchestrator.resolveApproval({
      auth: developmentAuthContext,
      requestId: "req-approve",
      approvalId: begun.approvalId,
      decision: "approve"
    });

    await expect(
      orchestrator.resolveApproval({
        auth: developmentAuthContext,
        requestId: "req-approve-again",
        approvalId: begun.approvalId,
        decision: "approve",
        editedArgs: { ...mutatingPayload, targetValue: "1" }
      })
    ).rejects.toMatchObject({ code: "INVALID_APPROVAL_STATE", status: 409 });
  });

  it("resolves an approval begun by a different orchestrator instance over the same database", async () => {
    const { db, tables } = createMemoryDb();
    const registryA = createMutatingRegistry();
    const registryB = createMutatingRegistry();
    const instanceA = createAgentOrchestrator({ db, toolRegistry: registryA });
    const instanceB = createAgentOrchestrator({ db, toolRegistry: registryB });

    const begun = await instanceA.beginApproval(beginInput("thread-replica"));
    const resolved = await instanceB.resolveApproval({
      auth: developmentAuthContext,
      requestId: "req-replica",
      approvalId: begun.approvalId,
      decision: "approve",
      editedArgs: { ...mutatingPayload, targetValue: "4242" }
    });

    expect(registryA.run).not.toHaveBeenCalled();
    expect(registryB.run).toHaveBeenCalledWith(
      "action.submitParameterChange",
      expect.anything(),
      expect.objectContaining({ targetValue: "4242" })
    );
    expect(JSON.parse(String(tables.toolCalls[0].payload))).toMatchObject({ targetValue: "4242" });
    expect(resolved.text).toContain("4242");
  });
});
