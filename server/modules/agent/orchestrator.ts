import { randomUUID } from "node:crypto";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { asAuditTx, withAuditedWrite, writeTrustedAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import { createAgentInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { createAgentToolRegistry } from "./toolRegistry";
import type { AgentToolExecutionContext } from "./toolRegistry";
import {
  appendAgentMessage,
  createAgentApproval,
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
import type { AgentToolCallRecord } from "./repository";
import type {
  AgentCitation,
  AgentToolCallDto,
  AgentToolName,
  AgentToolRequest,
  AgentToolResult,
  AgentTurnDto
} from "./types";

type AgentRequestContext = {
  auth: AuthContext;
  requestId: string;
};

type ToolCallInput = AgentRequestContext & {
  toolCallId: string;
};

type ApprovalInput = AgentRequestContext & {
  approvalId: string;
  reason: string;
  expectedSessionId?: string;
  expectedToolCallId?: string;
  editedArgs?: Record<string, unknown>;
};

export type ApprovalBeginInput = {
  auth: AuthContext;
  requestId: string;
  sessionId: string;
  toolName: AgentToolName;
  payload: Record<string, unknown>;
  citations: AgentCitation[];
  pageKey?: string;
  projectId?: string;
  /** Internal server-owned id from the checkpointed pending action. */
  toolCallId?: string;
};

export type ApprovalBeginResult = {
  approvalId: string;
  toolCallId: string;
  toolName: AgentToolName;
  payload: Record<string, unknown>;
  citations: AgentCitation[];
};

export type ApprovalResolveInput = {
  auth: AuthContext;
  requestId: string;
  approvalId: string;
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
  /** Internal checkpoint binding; never accepted from the public request body. */
  expectedSessionId?: string;
  /** Internal checkpoint binding; never accepted from the public request body. */
  expectedToolCallId?: string;
};

export type ApprovalResolveResult = {
  text: string;
};

type ToolRegistry = ReturnType<typeof createAgentToolRegistry>;

function newId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent tool failed.";
}

function staleTransition(message: string, details: Record<string, unknown>) {
  return new ApiError("CONFLICT", message, details);
}

function resumeTargetMismatch(approvalId: string) {
  return staleTransition("Agent approval does not match the interrupted tool call.", { approvalId });
}

/**
 * HITL approvals are personal: the user whose turn requested the tool call is
 * the only one who may approve, edit, or reject it. Without this gate any
 * same-organization user holding an approvalId could execute someone else's
 * pending write under their own auth.
 */
function requireApprovalRequester(approval: { id: string; requestedByUserId: string }, auth: AuthContext) {
  if (approval.requestedByUserId !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "Only the user who requested this approval may decide it.", {
      approvalId: approval.id
    });
  }
}

export function createAgentOrchestrator(options: {
  db: Database;
  toolRegistry?: ToolRegistry;
  metrics?: Pick<MetricsRegistry, "recordAgentApproval" | "recordAgentToolResult" | "recordAuditWriteFailure">;
  tracing?: Pick<TracingBoundary, "withSpan">;
}) {
  const db = options.db;
  const metrics = options.metrics;
  const tracing = options.tracing;
  const registryFor = (database: Database) => options.toolRegistry ?? createAgentToolRegistry({ db: database });
  const toolRegistry = registryFor(db);

  function toolMetricLabels(toolCall: Pick<AgentToolCallDto, "name">) {
    const definition = toolRegistry.require(toolCall.name);
    return {
      tool: definition.name,
      kind: definition.kind,
      requiresApproval: definition.requiresApproval
    };
  }

  function recordAgentApprovalMetric(action: "requested" | "approved" | "rejected", toolCall: Pick<AgentToolCallDto, "name">) {
    metrics?.recordAgentApproval({ action, ...toolMetricLabels(toolCall) });
  }

  function recordAgentToolResultMetric(
    status: "succeeded" | "failed" | "rejected",
    toolCall: Pick<AgentToolCallDto, "name">
  ) {
    metrics?.recordAgentToolResult({ status, ...toolMetricLabels(toolCall) });
  }

  async function withToolExecutionSpan<T>(
    toolCall: Pick<AgentToolCallDto, "name">,
    fn: () => Promise<T>
  ) {
    const labels = toolMetricLabels(toolCall);
    const attributes: Record<string, string | number | boolean> = {
      tool: labels.tool,
      kind: labels.kind,
      requiresApproval: labels.requiresApproval
    };
    const execute = async () => {
      try {
        const result = await fn();
        attributes.status = "succeeded";
        return result;
      } catch (error) {
        attributes.status = "failed";
        attributes.errorType = error instanceof Error ? error.name : "unknown";
        throw error;
      }
    };

    return tracing ? tracing.withSpan("agent.tool.execute", attributes, execute) : execute();
  }

  /** Step-result audit: commits with the step's state write (ADR-0027). */
  async function audit(input: {
    context: AgentRequestContext;
    invocation: TrustedInvocationContext;
    projectId?: string;
    kind: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
    severity?: "High" | "Medium" | "Low";
  }, auditTx: AuditTx) {
    try {
      await writeTrustedAuditEventInTx(auditTx, {
        id: newId("audit"),
        invocation: input.invocation,
        traceId: input.context.requestId,
        projectId: input.projectId ?? null,
        app: "wiseeff",
        kind: input.kind,
        action: input.action,
        severity: input.severity ?? "Low",
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: { initiatedByUserId: input.context.auth.user.id, ...(input.metadata ?? {}) }
      });
    } catch (error) {
      metrics?.recordAuditWriteFailure({
        kind: input.kind,
        action: input.action,
        targetType: input.targetType
      });
      throw error;
    }
  }

  async function loadSessionOrThrow(context: AgentRequestContext, sessionId: string) {
    const session = await getAgentSession(db, context.auth.organization.id, sessionId);
    if (!session) {
      throw new ApiError("NOT_FOUND", "Agent session was not found.", { sessionId });
    }
    if (session.actorUserId !== context.auth.user.id) {
      throw new ApiError("FORBIDDEN", "This Agent session belongs to another user.", { sessionId });
    }
    return session;
  }

  function buildAgentExecutionContext(
    input: AgentRequestContext,
    toolCall: AgentToolCallRecord,
    approvalId?: string
  ): AgentToolExecutionContext {
    const effectiveApprovalId = approvalId ?? toolCall.approvalId;
    if (toolCall.requiresApproval && !effectiveApprovalId) {
      throw new ApiError("INTERNAL_ERROR", "Approved Agent tool call is missing approval correlation.", {
        toolCallId: toolCall.id
      });
    }
    const approval = toolCall.requiresApproval
      ? { required: true as const, approvalId: effectiveApprovalId! }
      : { required: false as const };
    const invocation = createAgentInvocation(input.auth, {
      sessionId: toolCall.sessionId,
      toolCallId: toolCall.id,
      approval
    });
    return {
      auth: input.auth,
      invocation,
      requestId: input.requestId,
      sessionId: toolCall.sessionId,
      projectId: typeof toolCall.payload.projectId === "string" ? toolCall.payload.projectId : toolCall.projectId,
      approvalId: invocation.initiator === "agent" ? invocation.approvalId ?? undefined : undefined
    };
  }

  function assertApprovalTarget(
    approval: { id: string; sessionId: string; toolCallId: string },
    toolCall: AgentToolCallRecord,
    input: Pick<ApprovalInput, "expectedSessionId" | "expectedToolCallId">
  ) {
    if (
      !toolCall.requiresApproval ||
      approval.toolCallId !== toolCall.id ||
      approval.sessionId !== toolCall.sessionId ||
      toolCall.approvalId !== approval.id ||
      (input.expectedSessionId !== undefined && input.expectedSessionId !== approval.sessionId) ||
      (input.expectedToolCallId !== undefined && input.expectedToolCallId !== toolCall.id)
    ) {
      throw resumeTargetMismatch(approval.id);
    }
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

  async function createApprovalForToolCall(input: AgentRequestContext, toolCall: AgentToolCallRecord, sessionId: string) {
    const approvalId = newId("agent-approval");
    const invocation = createAgentInvocation(input.auth, {
      sessionId: toolCall.sessionId,
      toolCallId: toolCall.id,
      approval: { required: true, approvalId }
    });
    // Approval row, tool-call transition, and audit commit together (ADR-0027);
    // previously each auto-committed and the audit could be lost after them.
    await withAuditedWrite(db, input.auth, { requestId: input.requestId }, async (tx) => {
      await createAgentApproval(tx, {
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
      const updated = await updateAgentToolCall(tx, input.auth.organization.id, toolCall.id, { status: "pending_approval" });
      if (!updated) {
        throw staleTransition("Agent tool call could not be moved to pending approval.", { toolCallId: toolCall.id });
      }
      await audit({
        context: input,
        invocation,
        projectId: typeof toolCall.payload.projectId === "string" ? toolCall.payload.projectId : undefined,
        kind: "agent-tool",
        action: "approval-requested",
        targetType: "agent_tool_call",
        targetId: toolCall.id,
        metadata: { sessionId, toolCallId: toolCall.id, approvalId, toolName: toolCall.name }
      }, asAuditTx(tx));
      return { result: undefined, audit: null };
    });
    recordAgentApprovalMetric("requested", toolCall);
  }

  async function executeToolCall(input: AgentRequestContext, toolCall: AgentToolCallRecord) {
    await loadSessionOrThrow(input, toolCall.sessionId);
    const executionContext = buildAgentExecutionContext(input, toolCall);
    const sessionId = toolCall.sessionId;

    const running = await updateAgentToolCall(db, input.auth.organization.id, toolCall.id, { status: "running" });
    if (!running) {
      throw staleTransition("Agent tool call could not be started.", { toolCallId: toolCall.id });
    }
    try {
      const result = await withToolExecutionSpan(toolCall, () => toolRegistry.run(toolCall.name, executionContext, toolCall.payload));
      // Result transition and audit commit together (ADR-0027); the "running"
      // transition above deliberately stays outside so it is visible during execution.
      await withAuditedWrite(db, input.auth, { requestId: input.requestId }, async (tx) => {
        const succeeded = await updateAgentToolCall(tx, input.auth.organization.id, toolCall.id, {
          status: "succeeded",
          result
        });
        if (!succeeded) {
          throw staleTransition("Agent tool call could not be marked succeeded.", { toolCallId: toolCall.id });
        }
        await audit({
          context: input,
          invocation: executionContext.invocation!,
          projectId: executionContext.projectId,
          kind: "agent-tool",
          action: "succeeded",
          targetType: "agent_tool_call",
          targetId: toolCall.id,
          metadata: { sessionId, toolCallId: toolCall.id, toolName: toolCall.name, summary: result.summary }
        }, asAuditTx(tx));
        return { result: undefined, audit: null };
      });
      recordAgentToolResultMetric("succeeded", toolCall);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        throw error;
      }
      // Failure transition and audit commit together, then the error propagates.
      await withAuditedWrite(db, input.auth, { requestId: input.requestId }, async (tx) => {
        const failed = await updateAgentToolCall(tx, input.auth.organization.id, toolCall.id, {
          status: "failed",
          errorMessage: errorMessage(error)
        });
        if (!failed) {
          throw staleTransition("Agent tool call could not be marked failed.", { toolCallId: toolCall.id });
        }
        await audit({
          context: input,
          invocation: executionContext.invocation!,
          projectId: executionContext.projectId,
          kind: "agent-tool",
          action: "failed",
          targetType: "agent_tool_call",
          targetId: toolCall.id,
          metadata: { sessionId, toolCallId: toolCall.id, toolName: toolCall.name, error: errorMessage(error) },
          severity: "Medium"
        }, asAuditTx(tx));
        return { result: undefined, audit: null };
      });
      recordAgentToolResultMetric("failed", toolCall);
      throw error;
    }
  }

  async function recordToolRequest(
    input: AgentRequestContext,
    sessionId: string,
    request: AgentToolRequest,
    durableToolCallId?: string
  ): Promise<AgentToolCallDto> {
    const definition = toolRegistry.require(request.name);
    const toolCallId = durableToolCallId?.trim() || newId("agent-tool");
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
      throw new ApiError("INTERNAL_ERROR", "Agent tool call was not recorded.", { toolCallId });
    }

    if (definition.requiresApproval) {
      await createApprovalForToolCall(input, toolCall, sessionId);
    } else {
      await executeToolCall(input, toolCall);
    }

    const recorded = await getAgentToolCall(db, input.auth.organization.id, toolCallId);
    if (!recorded) {
      throw new ApiError("INTERNAL_ERROR", "Agent tool call was not found after recording.", { toolCallId });
    }
    return recorded;
  }

  async function runToolCall(input: ToolCallInput): Promise<AgentTurnDto> {
    const toolCall = await getAgentToolCall(db, input.auth.organization.id, input.toolCallId);
    if (!toolCall) {
      throw new ApiError("NOT_FOUND", "Agent tool call was not found.", { toolCallId: input.toolCallId });
    }
    await loadSessionOrThrow(input, toolCall.sessionId);
    if (toolCall.status === "pending_approval") {
      throw new ApiError("APPROVAL_REQUIRED", "Tool call requires approval.", { toolCallId: input.toolCallId });
    }
    if (!["succeeded", "failed", "rejected"].includes(toolCall.status)) {
      await executeToolCall(input, toolCall);
    }
    return assembleTurn(input, toolCall.sessionId);
  }

  async function approveToolCall(input: ApprovalInput): Promise<AgentTurnDto> {
    const approval = await getAgentApproval(db, input.auth.organization.id, input.approvalId);
    if (!approval) {
      throw new ApiError("NOT_FOUND", "Agent approval was not found.", { approvalId: input.approvalId });
    }
    if (approval.status !== "pending") {
      throw new ApiError("INVALID_APPROVAL_STATE", "Approval is not pending.", { approvalId: input.approvalId });
    }
    requireApprovalRequester(approval, input.auth);
    const toolCall = await getAgentToolCall(db, input.auth.organization.id, approval.toolCallId);
    if (!toolCall) {
      throw new ApiError("NOT_FOUND", "Agent tool call was not found.", { toolCallId: approval.toolCallId });
    }
    await loadSessionOrThrow(input, toolCall.sessionId);
    assertApprovalTarget(approval, toolCall, input);

    const executionError = await db.transaction(async (tx) => {
      const persistedApproval = await getAgentApproval(tx, input.auth.organization.id, approval.id);
      if (!persistedApproval || persistedApproval.status !== "pending") {
        throw staleTransition("Agent approval was already decided.", { approvalId: approval.id });
      }
      const persistedToolCall = await getAgentToolCall(tx, input.auth.organization.id, persistedApproval.toolCallId);
      if (!persistedToolCall) {
        throw new ApiError("NOT_FOUND", "Agent tool call was not found.", { toolCallId: persistedApproval.toolCallId });
      }
      assertApprovalTarget(persistedApproval, persistedToolCall, input);

      const approved = await markAgentApprovalApproved(
        tx,
        input.auth.organization.id,
        persistedApproval.id,
        input.auth.user.id
      );
      if (!approved) {
        throw staleTransition("Agent approval was already decided.", { approvalId: approval.id });
      }

      if (input.editedArgs !== undefined) {
        const updated = await updateAgentToolCall(tx, input.auth.organization.id, persistedToolCall.id, {
          payload: input.editedArgs,
          expectedStatus: "pending_approval"
        });
        if (!updated) {
          throw staleTransition("Agent tool call payload could not be updated.", { toolCallId: persistedToolCall.id });
        }
      }

      const executableToolCall = await getAgentToolCall(tx, input.auth.organization.id, persistedToolCall.id);
      if (!executableToolCall) {
        throw new ApiError("INTERNAL_ERROR", "Agent tool call disappeared before execution.", {
          toolCallId: persistedToolCall.id
        });
      }
      const executionContext = buildAgentExecutionContext(input, executableToolCall, persistedApproval.id);
      const txToolRegistry = registryFor(tx);
      const authorization = txToolRegistry.authorize(
        executableToolCall.name,
        executionContext,
        executableToolCall.payload
      );

      let result: AgentToolResult;
      try {
        result = await withToolExecutionSpan(executableToolCall, () =>
          authorization === undefined
            ? txToolRegistry.run(executableToolCall.name, executionContext, executableToolCall.payload)
            : txToolRegistry.run(executableToolCall.name, executionContext, executableToolCall.payload, authorization)
        );
      } catch (error) {
        const failed = await updateAgentToolCall(tx, input.auth.organization.id, executableToolCall.id, {
          status: "failed",
          errorMessage: errorMessage(error)
        });
        if (!failed) {
          throw staleTransition("Agent tool call could not be marked failed.", { toolCallId: executableToolCall.id });
        }
        await audit({
          context: input,
          invocation: executionContext.invocation!,
          projectId: executableToolCall.projectId ?? persistedApproval.projectId,
          kind: "agent-tool",
          action: "approval-execution-failed",
          targetType: "agent_tool_call",
          targetId: executableToolCall.id,
          metadata: {
            sessionId: persistedApproval.sessionId,
            toolCallId: executableToolCall.id,
            approvalId: persistedApproval.id,
            toolName: executableToolCall.name,
            error: errorMessage(error)
          },
          severity: "Medium"
        }, asAuditTx(tx));
        return error;
      }

      const succeeded = await updateAgentToolCall(tx, input.auth.organization.id, executableToolCall.id, {
        status: "succeeded",
        result
      });
      if (!succeeded) {
        throw staleTransition("Agent tool call could not be marked succeeded.", { toolCallId: executableToolCall.id });
      }
      await audit({
        context: input,
        invocation: executionContext.invocation!,
        projectId: executableToolCall.projectId ?? persistedApproval.projectId,
        kind: "agent-tool",
        action: "approval-executed",
        targetType: "agent_tool_call",
        targetId: executableToolCall.id,
        metadata: {
          sessionId: persistedApproval.sessionId,
          toolCallId: executableToolCall.id,
          approvalId: persistedApproval.id,
          toolName: executableToolCall.name,
          summary: result.summary
        }
      }, asAuditTx(tx));
      return null;
    });
    recordAgentApprovalMetric("approved", toolCall);
    recordAgentToolResultMetric(executionError ? "failed" : "succeeded", toolCall);
    if (executionError) {
      throw executionError;
    }

    return assembleTurn(input, approval.sessionId);
  }

  async function rejectToolCall(input: ApprovalInput): Promise<AgentTurnDto> {
    const approval = await getAgentApproval(db, input.auth.organization.id, input.approvalId);
    if (!approval || approval.status !== "pending") {
      throw new ApiError("NOT_FOUND", "Pending Agent approval was not found.", { approvalId: input.approvalId });
    }
    requireApprovalRequester(approval, input.auth);
    const toolCall = await getAgentToolCall(db, input.auth.organization.id, approval.toolCallId);
    if (!toolCall) {
      throw new ApiError("NOT_FOUND", "Agent tool call was not found.", { toolCallId: approval.toolCallId });
    }
    await loadSessionOrThrow(input, toolCall.sessionId);
    assertApprovalTarget(approval, toolCall, input);
    const invocation = buildAgentExecutionContext(input, toolCall, approval.id).invocation!;

    // Rejection decision, tool-call transition, message, and audit commit together (ADR-0027).
    await withAuditedWrite(db, input.auth, { requestId: input.requestId }, async (tx) => {
      const rejected = await markAgentApprovalRejected(
        tx,
        input.auth.organization.id,
        approval.id,
        input.auth.user.id,
        input.reason
      );
      if (!rejected) {
        throw staleTransition("Agent approval was already decided.", { approvalId: approval.id });
      }
      const toolRejected = await updateAgentToolCall(tx, input.auth.organization.id, approval.toolCallId, {
        status: "rejected",
        errorMessage: input.reason
      });
      if (!toolRejected) {
        throw staleTransition("Agent tool call could not be marked rejected.", { toolCallId: approval.toolCallId });
      }
      await appendAgentMessage(tx, {
        id: newId("agent-msg"),
        sessionId: approval.sessionId,
        organizationId: input.auth.organization.id,
        role: "assistant",
        content: `Tool request rejected: ${input.reason}`,
        citations: []
      });
      await audit({
        context: input,
        invocation,
        projectId: approval.projectId,
        kind: "agent-tool",
        action: "approval-rejected",
        targetType: "agent_tool_call",
        targetId: approval.toolCallId,
        metadata: {
          sessionId: approval.sessionId,
          toolCallId: approval.toolCallId,
          approvalId: approval.id,
          reason: input.reason
        }
      }, asAuditTx(tx));
      return { result: undefined, audit: null };
    });
    recordAgentApprovalMetric("rejected", toolCall);
    recordAgentToolResultMetric("rejected", toolCall);

    return assembleTurn(input, approval.sessionId);
  }

  async function recordSessionToolRequest(
    input: AgentRequestContext & { sessionId: string; request: AgentToolRequest; toolCallId?: string }
  ) {
    const existing = await getAgentSession(db, input.auth.organization.id, input.sessionId);
    if (!existing) {
      await createAgentSession(db, {
        id: input.sessionId,
        organizationId: input.auth.organization.id,
        projectId: typeof input.request.payload.projectId === "string" ? input.request.payload.projectId : undefined,
        actorUserId: input.auth.user.id,
        pageKey: "xiaoze",
        roleId: input.auth.roles[0]?.roleId,
        context: {
          path: "/",
          pageKey: "xiaoze",
          projectId: typeof input.request.payload.projectId === "string" ? input.request.payload.projectId : undefined,
          roleId: input.auth.roles[0]?.roleId
        },
        title: "Xiaoze Agent Session"
      });
    }
    await loadSessionOrThrow(input, input.sessionId);
    return recordToolRequest(input, input.sessionId, input.request, input.toolCallId);
  }

  async function ensureAgentSession(input: ApprovalBeginInput) {
    const existing = await getAgentSession(db, input.auth.organization.id, input.sessionId);
    if (existing) {
      return;
    }
    await createAgentSession(db, {
      id: input.sessionId,
      organizationId: input.auth.organization.id,
      projectId: input.projectId,
      actorUserId: input.auth.user.id,
      pageKey: input.pageKey ?? "xiaoze",
      roleId: input.auth.roles[0]?.roleId,
      context: {
        path: "/",
        pageKey: input.pageKey ?? "xiaoze",
        projectId: input.projectId,
        roleId: input.auth.roles[0]?.roleId
      },
      title: "Xiaoze Agent Session"
    });
  }

  async function beginApproval(input: ApprovalBeginInput): Promise<ApprovalBeginResult> {
    const definition = toolRegistry.require(input.toolName);
    if (!definition.requiresApproval) {
      throw new ApiError("VALIDATION_FAILED", "Tool does not require approval.", { toolName: input.toolName });
    }
    await ensureAgentSession(input);
    await loadSessionOrThrow({ auth: input.auth, requestId: input.requestId }, input.sessionId);
    const toolCall = await recordToolRequest(
      { auth: input.auth, requestId: input.requestId },
      input.sessionId,
      { name: input.toolName, label: definition.label, payload: input.payload },
      input.toolCallId
    );
    if (!toolCall.approvalId) {
      throw new ApiError("INTERNAL_ERROR", "Agent approval was not created for the tool call.", {
        toolCallId: toolCall.id
      });
    }
    return {
      approvalId: toolCall.approvalId,
      toolCallId: toolCall.id,
      toolName: input.toolName,
      payload: input.payload,
      citations: input.citations
    };
  }

  async function resolveApproval(input: ApprovalResolveInput): Promise<ApprovalResolveResult> {
    if (input.decision === "reject") {
      const turn = await rejectToolCall({
        auth: input.auth,
        requestId: input.requestId,
        approvalId: input.approvalId,
        expectedSessionId: input.expectedSessionId,
        expectedToolCallId: input.expectedToolCallId,
        reason: input.reason ?? "Rejected from Xiaoze chat."
      });
      return { text: turn.messages.at(-1)?.content ?? "The proposed action was rejected." };
    }

    const turn = await approveToolCall({
      auth: input.auth,
      requestId: input.requestId,
      approvalId: input.approvalId,
      expectedSessionId: input.expectedSessionId,
      expectedToolCallId: input.expectedToolCallId,
      editedArgs: input.editedArgs,
      reason: input.reason ?? "Approved from Xiaoze chat."
    });
    const executed = turn.toolCalls.find((call) => call.approvalId === input.approvalId) ?? turn.toolCalls.at(-1);
    return { text: executed?.result?.summary ?? "The proposed action was approved and executed." };
  }

  return {
    runToolCall,
    approveToolCall,
    rejectToolCall,
    recordToolRequest: recordSessionToolRequest,
    beginApproval,
    resolveApproval
  };
}

export type AgentOrchestrator = ReturnType<typeof createAgentOrchestrator>;
