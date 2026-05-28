import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createAuditEvent as defaultCreateAuditEvent } from "../audit/repository";
import { createAgentToolRegistry } from "./toolRegistry";
import type { AgentToolExecutionContext } from "./toolRegistry";
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
import { createDeterministicAgentProvider } from "./provider";
import type { AgentToolRequest } from "./provider";
import type { AgentContext, AgentToolCallDto, AgentTurnDto } from "./types";

type AgentRequestContext = {
  auth: AuthContext;
  requestId: string;
};

type StartSessionInput = AgentRequestContext & {
  context: AgentContext;
  title?: string;
};

type SendMessageInput = AgentRequestContext & {
  sessionId: string;
  message: string;
};

type ToolCallInput = AgentRequestContext & {
  toolCallId: string;
};

type ApprovalInput = AgentRequestContext & {
  approvalId: string;
  reason: string;
};

type ToolRegistry = ReturnType<typeof createAgentToolRegistry>;

function newId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent tool failed.";
}

export function createAgentOrchestrator(options: {
  db: Database;
  toolRegistry?: ToolRegistry;
  provider?: ReturnType<typeof createDeterministicAgentProvider>;
  createAuditEvent?: typeof defaultCreateAuditEvent;
}) {
  const db = options.db;
  const toolRegistry = options.toolRegistry ?? createAgentToolRegistry({ db });
  const provider = options.provider ?? createDeterministicAgentProvider();
  const createAuditEvent = options.createAuditEvent ?? defaultCreateAuditEvent;

  async function audit(input: {
    context: AgentRequestContext;
    projectId?: string;
    kind: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
    severity?: "High" | "Medium" | "Low";
  }) {
    await createAuditEvent(db, {
      id: newId("audit"),
      organizationId: input.context.auth.organization.id,
      projectId: input.projectId ?? null,
      actorUserId: input.context.auth.user.id,
      actorType: "user",
      app: "wiseeff",
      kind: input.kind,
      action: input.action,
      severity: input.severity ?? "Low",
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      traceId: input.context.requestId
    });
  }

  async function loadSessionOrThrow(context: AgentRequestContext, sessionId: string) {
    const session = await getAgentSession(db, context.auth.organization.id, sessionId);
    if (!session) {
      throw new ApiError("NOT_FOUND", "Agent session was not found.", 404, { sessionId });
    }
    return session;
  }

  async function assembleTurn(context: AgentRequestContext, sessionId: string): Promise<AgentTurnDto> {
    const session = await loadSessionOrThrow(context, sessionId);
    const messages = await listAgentMessages(db, context.auth.organization.id, sessionId);
    const toolCalls = await listAgentToolCalls(db, context.auth.organization.id, sessionId);
    const approvals = await listAgentApprovals(db, context.auth.organization.id, sessionId);

    return {
      session: { id: session.id, context: session.context, messages },
      messages,
      toolCalls,
      approvals
    };
  }

  async function startSession(input: StartSessionInput): Promise<AgentTurnDto> {
    const sessionId = newId("agent-session");
    const messageId = newId("agent-msg");
    const title = input.title ?? "WiseEff Agent Session";

    await createAgentSession(db, {
      id: sessionId,
      organizationId: input.auth.organization.id,
      projectId: input.context.projectId,
      actorUserId: input.auth.user.id,
      pageKey: input.context.pageKey,
      roleId: input.context.roleId,
      context: input.context,
      title
    });
    await appendAgentMessage(db, {
      id: messageId,
      sessionId,
      organizationId: input.auth.organization.id,
      role: "system",
      content: "WiseEff Agent is operating in deterministic M4 mode.",
      citations: []
    });
    await audit({
      context: input,
      projectId: input.context.projectId,
      kind: "agent-session",
      action: "started",
      targetType: "agent_session",
      targetId: sessionId,
      metadata: { pageKey: input.context.pageKey }
    });

    return assembleTurn(input, sessionId);
  }

  async function createApprovalForToolCall(input: AgentRequestContext, toolCall: AgentToolCallDto, sessionId: string) {
    const approvalId = newId("agent-approval");
    await createAgentApproval(db, {
      id: approvalId,
      sessionId,
      toolCallId: toolCall.id,
      organizationId: input.auth.organization.id,
      projectId: typeof toolCall.payload.projectId === "string" ? toolCall.payload.projectId : undefined,
      status: "pending",
      title: toolCall.label,
      message: `Approval is required before running ${toolCall.label}.`,
      requestedByUserId: input.auth.user.id
    });
    await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, { status: "pending_approval" });
    await audit({
      context: input,
      projectId: typeof toolCall.payload.projectId === "string" ? toolCall.payload.projectId : undefined,
      kind: "agent-tool",
      action: "approval-requested",
      targetType: "agent_tool_call",
      targetId: toolCall.id,
      metadata: { approvalId, toolName: toolCall.name }
    });
  }

  async function executeToolCall(input: AgentRequestContext, toolCall: AgentToolCallDto, sessionId: string) {
    const executionContext: AgentToolExecutionContext = {
      auth: input.auth,
      requestId: input.requestId,
      sessionId,
      projectId: typeof toolCall.payload.projectId === "string" ? toolCall.payload.projectId : undefined
    };

    await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, { status: "running" });
    try {
      const result = await toolRegistry.run(toolCall.name, executionContext, toolCall.payload);
      await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, {
        status: "succeeded",
        result
      });
      await audit({
        context: input,
        projectId: executionContext.projectId,
        kind: "agent-tool",
        action: "succeeded",
        targetType: "agent_tool_call",
        targetId: toolCall.id,
        metadata: { toolName: toolCall.name, summary: result.summary }
      });
      return result;
    } catch (error) {
      await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, {
        status: "failed",
        errorMessage: errorMessage(error)
      });
      await audit({
        context: input,
        projectId: executionContext.projectId,
        kind: "agent-tool",
        action: "failed",
        targetType: "agent_tool_call",
        targetId: toolCall.id,
        metadata: { toolName: toolCall.name, error: errorMessage(error) },
        severity: "Medium"
      });
      return null;
    }
  }

  async function recordToolRequest(
    input: AgentRequestContext,
    sessionId: string,
    request: AgentToolRequest
  ): Promise<AgentToolCallDto> {
    const definition = toolRegistry.require(request.name);
    const toolCallId = newId("agent-tool");
    const projectId = typeof request.payload.projectId === "string" ? request.payload.projectId : undefined;

    await createAgentToolCall(db, {
      id: toolCallId,
      sessionId,
      organizationId: input.auth.organization.id,
      projectId,
      name: request.name,
      label: request.label,
      payload: request.payload,
      requiresApproval: definition.requiresApproval,
      status: "requested"
    });

    const toolCall = await getAgentToolCall(db, input.auth.organization.id, toolCallId);
    if (!toolCall) {
      throw new ApiError("INTERNAL_ERROR", "Agent tool call was not recorded.", 500, { toolCallId });
    }

    if (definition.requiresApproval) {
      await createApprovalForToolCall(input, toolCall, sessionId);
    } else {
      await executeToolCall(input, toolCall, sessionId);
    }

    const recorded = await getAgentToolCall(db, input.auth.organization.id, toolCallId);
    if (!recorded) {
      throw new ApiError("INTERNAL_ERROR", "Agent tool call was not found after recording.", 500, { toolCallId });
    }
    return recorded;
  }

  async function sendMessage(input: SendMessageInput): Promise<AgentTurnDto> {
    const session = await loadSessionOrThrow(input, input.sessionId);
    const userMessageId = newId("agent-msg");
    await appendAgentMessage(db, {
      id: userMessageId,
      sessionId: input.sessionId,
      organizationId: input.auth.organization.id,
      role: "user",
      content: input.message,
      citations: []
    });

    const plan = provider.planTurn({ context: session.context, message: input.message });
    const toolCallIds: string[] = [];
    for (const request of plan.toolRequests) {
      const toolCall = await recordToolRequest(input, input.sessionId, request);
      toolCallIds.push(toolCall.id);
    }

    await createAgentRunTrace(db, {
      id: newId("agent-trace"),
      sessionId: input.sessionId,
      messageId: userMessageId,
      organizationId: input.auth.organization.id,
      provider: plan.provider,
      model: plan.model,
      promptVersion: plan.promptVersion,
      inputSummary: input.message,
      outputSummary: plan.assistantDraft.content,
      toolCallIds,
      traceId: input.requestId
    });
    await appendAgentMessage(db, {
      id: newId("agent-msg"),
      sessionId: input.sessionId,
      organizationId: input.auth.organization.id,
      role: "assistant",
      content: plan.assistantDraft.content,
      citations: plan.assistantDraft.citations,
      confidence: plan.assistantDraft.confidence
    });

    return assembleTurn(input, input.sessionId);
  }

  async function runToolCall(input: ToolCallInput): Promise<AgentTurnDto> {
    const toolCall = await getAgentToolCall(db, input.auth.organization.id, input.toolCallId);
    if (!toolCall) {
      throw new ApiError("NOT_FOUND", "Agent tool call was not found.", 404, { toolCallId: input.toolCallId });
    }
    if (toolCall.status === "pending_approval") {
      throw new ApiError("APPROVAL_REQUIRED", "Tool call requires approval.", 409, { toolCallId: input.toolCallId });
    }
    if (!["succeeded", "failed", "rejected"].includes(toolCall.status)) {
      await executeToolCall(input, toolCall, toolCall.sessionId);
    }
    return assembleTurn(input, toolCall.sessionId);
  }

  async function approveToolCall(input: ApprovalInput): Promise<AgentTurnDto> {
    const approval = await getAgentApproval(db, input.auth.organization.id, input.approvalId);
    if (!approval || approval.status !== "pending") {
      throw new ApiError("NOT_FOUND", "Pending Agent approval was not found.", 404, { approvalId: input.approvalId });
    }
    const toolCall = await getAgentToolCall(db, input.auth.organization.id, approval.toolCallId);
    if (!toolCall) {
      throw new ApiError("NOT_FOUND", "Agent tool call was not found.", 404, { toolCallId: approval.toolCallId });
    }

    const result = await toolRegistry.run(
      toolCall.name,
      {
        auth: input.auth,
        requestId: input.requestId,
        sessionId: approval.sessionId,
        projectId: toolCall.projectId ?? approval.projectId
      },
      toolCall.payload
    );
    await markAgentApprovalApproved(db, input.auth.organization.id, approval.id, input.auth.user.id);
    await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, { status: "succeeded", result });
    await appendAgentMessage(db, {
      id: newId("agent-msg"),
      sessionId: approval.sessionId,
      organizationId: input.auth.organization.id,
      role: "assistant",
      content: result.summary,
      citations: result.citations
    });
    await audit({
      context: input,
      projectId: toolCall.projectId ?? approval.projectId,
      kind: "agent-tool",
      action: "approval-executed",
      targetType: "agent_tool_call",
      targetId: toolCall.id,
      metadata: { approvalId: approval.id, toolName: toolCall.name, summary: result.summary }
    });

    return assembleTurn(input, approval.sessionId);
  }

  async function rejectToolCall(input: ApprovalInput): Promise<AgentTurnDto> {
    const approval = await getAgentApproval(db, input.auth.organization.id, input.approvalId);
    if (!approval || approval.status !== "pending") {
      throw new ApiError("NOT_FOUND", "Pending Agent approval was not found.", 404, { approvalId: input.approvalId });
    }

    await markAgentApprovalRejected(db, input.auth.organization.id, approval.id, input.auth.user.id, input.reason);
    await updateAgentToolCall(db, input.auth.organization.id, approval.toolCallId, {
      status: "rejected",
      errorMessage: input.reason
    });
    await appendAgentMessage(db, {
      id: newId("agent-msg"),
      sessionId: approval.sessionId,
      organizationId: input.auth.organization.id,
      role: "assistant",
      content: `Tool request rejected: ${input.reason}`,
      citations: []
    });
    await audit({
      context: input,
      projectId: approval.projectId,
      kind: "agent-tool",
      action: "approval-rejected",
      targetType: "agent_tool_call",
      targetId: approval.toolCallId,
      metadata: { approvalId: approval.id, reason: input.reason }
    });

    return assembleTurn(input, approval.sessionId);
  }

  async function recordToolRequestForTest(input: AgentRequestContext & { sessionId: string; request: AgentToolRequest }) {
    await loadSessionOrThrow(input, input.sessionId);
    return recordToolRequest(input, input.sessionId, input.request);
  }

  return {
    startSession,
    sendMessage,
    runToolCall,
    approveToolCall,
    rejectToolCall,
    recordToolRequestForTest
  };
}
