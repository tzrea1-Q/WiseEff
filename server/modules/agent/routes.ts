import { z } from "zod";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { AuthContext } from "../auth/types";
import { createAgentOrchestrator } from "./orchestrator";
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
    parseWithSchema(approveAgentApprovalBodySchema, request.body);
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
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
    const body = parseWithSchema(rejectAgentApprovalBodySchema, request.body);
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
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
