import { z } from "zod";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { AuthContext } from "../auth/types";
import { createAgentOrchestrator } from "./orchestrator";
import { getAgentApproval, getAgentToolCall } from "./repository";
import type { AgentApprovalRecord, AgentToolCallRecord } from "./repository";
import {
  approveAgentApprovalBodySchema,
  createAgentSessionBodySchema,
  rejectAgentApprovalBodySchema,
  runAgentToolCallBodySchema,
  sendAgentMessageBodySchema
} from "./schemas";

const paramsWithSessionIdSchema = z.object({
  sessionId: z.string().trim().min(1)
});

const paramsWithSessionAndToolCallIdSchema = z.object({
  sessionId: z.string().trim().min(1),
  toolCallId: z.string().trim().min(1)
});

const paramsWithSessionAndApprovalIdSchema = z.object({
  sessionId: z.string().trim().min(1),
  approvalId: z.string().trim().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for agent routes.", 500);
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid agent route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function sessionResourceNotFound(sessionId: string) {
  return new ApiError("NOT_FOUND", "Agent session resource was not found.", 404, { sessionId });
}

async function requireToolCallInSession(db: Database, auth: AuthContext, sessionId: string, toolCallId: string) {
  const toolCall = await getAgentToolCall(db, auth.organization.id, toolCallId);
  if (!toolCall || toolCall.sessionId !== sessionId) {
    throw sessionResourceNotFound(sessionId);
  }

  return toolCall;
}

async function requireApprovalInSession(db: Database, auth: AuthContext, sessionId: string, approvalId: string) {
  const approval = await getAgentApproval(db, auth.organization.id, approvalId);
  if (!approval || approval.sessionId !== sessionId) {
    throw sessionResourceNotFound(sessionId);
  }

  return approval;
}

async function requireApprovalToolCallStatus(
  db: Database,
  auth: AuthContext,
  approval: AgentApprovalRecord,
  expectedToolCallStatus: AgentToolCallRecord["status"] | undefined
) {
  if (!expectedToolCallStatus) {
    return;
  }

  const toolCall = await getAgentToolCall(db, auth.organization.id, approval.toolCallId);
  if (!toolCall || toolCall.sessionId !== approval.sessionId) {
    throw sessionResourceNotFound(approval.sessionId);
  }
  if (toolCall.status !== expectedToolCallStatus) {
    throw new ApiError("CONFLICT", "Agent tool call status changed before approval.", 409, {
      expectedToolCallStatus,
      actualToolCallStatus: toolCall.status
    });
  }
}

export function registerAgentRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.post("/api/v1/agent/sessions", async (request) => {
    const body = parseWithSchema(createAgentSessionBodySchema, request.body);
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const orchestrator = createAgentOrchestrator({ db });
    const turn = await orchestrator.startSession({ auth, requestId: request.requestId, context: body.context });

    return { status: 201, body: { turn } };
  });

  router.post("/api/v1/agent/sessions/:sessionId/messages", async (request) => {
    const params = parseWithSchema(paramsWithSessionIdSchema, request.params);
    const body = parseWithSchema(sendAgentMessageBodySchema, request.body);
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const orchestrator = createAgentOrchestrator({ db });
    const turn = await orchestrator.sendMessage({
      auth,
      requestId: request.requestId,
      sessionId: params.sessionId,
      message: body.message
    });

    return { status: 200, body: { turn } };
  });

  router.post("/api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run", async (request) => {
    const params = parseWithSchema(paramsWithSessionAndToolCallIdSchema, request.params);
    parseWithSchema(runAgentToolCallBodySchema, request.body);
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    await requireToolCallInSession(db, auth, params.sessionId, params.toolCallId);
    const orchestrator = createAgentOrchestrator({ db });
    const turn = await orchestrator.runToolCall({
      auth,
      requestId: request.requestId,
      toolCallId: params.toolCallId
    });

    return { status: 200, body: { turn } };
  });

  router.post("/api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve", async (request) => {
    const params = parseWithSchema(paramsWithSessionAndApprovalIdSchema, request.params);
    const body = parseWithSchema(approveAgentApprovalBodySchema, request.body ?? {});
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const approval = await requireApprovalInSession(db, auth, params.sessionId, params.approvalId);
    await requireApprovalToolCallStatus(db, auth, approval, body.expectedToolCallStatus);
    const orchestrator = createAgentOrchestrator({ db });
    const turn = await orchestrator.approveToolCall({
      auth,
      requestId: request.requestId,
      approvalId: params.approvalId,
      reason: "Approved"
    });

    return { status: 200, body: { turn } };
  });

  router.post("/api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject", async (request) => {
    const params = parseWithSchema(paramsWithSessionAndApprovalIdSchema, request.params);
    const body = parseWithSchema(rejectAgentApprovalBodySchema, request.body ?? {});
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    await requireApprovalInSession(db, auth, params.sessionId, params.approvalId);
    const orchestrator = createAgentOrchestrator({ db });
    const turn = await orchestrator.rejectToolCall({
      auth,
      requestId: request.requestId,
      approvalId: params.approvalId,
      reason: body.reason ?? "Rejected"
    });

    return { status: 200, body: { turn } };
  });
}
