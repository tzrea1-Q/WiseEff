import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, RouteResponse, WiseEffRouter } from "../../../shared/http/router";
import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { randomUUID } from "node:crypto";
import { withAuditedWrite } from "../../audit/auditedWrite";
import {
  archiveXiaozeThread,
  getXiaozeThread,
  listXiaozeThreads,
  updateXiaozeThreadTitle,
  XIAOZE_PAGE_KEY
} from "./threadRepository";
import {
  createXiaozeThreadBodySchema,
  parseXiaozeThreadListQuery,
  patchXiaozeThreadBodySchema,
  xiaozeThreadIdParamsSchema
} from "./threadSchemas";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for Xiaoze thread routes.");
  }
  return db;
}

function parseParams<T>(schema: { parse: (value: unknown) => T }, value: unknown) {
  try {
    return schema.parse(value);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Invalid Xiaoze thread route input.");
  }
}

function threadNotFound(threadId: string) {
  return new ApiError("NOT_FOUND", "Xiaoze thread was not found.", { threadId });
}

export function registerXiaozeThreadRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v1/agent/xiaoze/threads", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseXiaozeThreadListQuery(request.query);
    const result = await listXiaozeThreads(db, {
      organizationId: auth.organization.id,
      actorUserId: auth.user.id,
      limit: query.limit,
      cursor: query.cursor
    });
    return { status: 200, body: result };
  });

  router.post("/api/v1/agent/xiaoze/threads", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseParams(createXiaozeThreadBodySchema, request.body);
    const threadId = body.id ?? randomUUID();
    const now = new Date().toISOString();
    return {
      status: 201,
      body: {
        thread: {
          id: threadId,
          title: "新对话",
          preview: "暂无消息",
          createdAt: now,
          updatedAt: now,
          context: {
            path: body.context?.path ?? "",
            pageKey: body.context?.pageKey ?? XIAOZE_PAGE_KEY,
            projectId: body.context?.projectId,
            roleId: body.context?.roleId
          }
        }
      }
    };
  });

  router.get("/api/v1/agent/xiaoze/threads/:threadId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseParams(xiaozeThreadIdParamsSchema, request.params);
    const thread = await getXiaozeThread(db, auth.organization.id, auth.user.id, params.threadId);
    if (!thread) {
      throw threadNotFound(params.threadId);
    }
    return { status: 200, body: { thread, messages: thread.messages } };
  });

  router.patch("/api/v1/agent/xiaoze/threads/:threadId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseParams(xiaozeThreadIdParamsSchema, request.params);
    const body = parseParams(patchXiaozeThreadBodySchema, request.body);
    // Rename and its audit commit together (ADR-0027); previously the update
    // auto-committed and the audit could be lost after it.
    await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const updated = await updateXiaozeThreadTitle(tx, auth.organization.id, auth.user.id, params.threadId, body.title);
      if (!updated) {
        throw threadNotFound(params.threadId);
      }
      return {
        result: undefined,
        audit: {
          app: "wiseeff",
          kind: "agent-session",
          action: "updated",
          severity: "Low",
          projectId: null,
          targetType: "agent_session",
          targetId: params.threadId,
          metadata: { sessionId: params.threadId, title: body.title }
        }
      };
    });

    const thread = await getXiaozeThread(db, auth.organization.id, auth.user.id, params.threadId);
    if (!thread) {
      throw threadNotFound(params.threadId);
    }
    return { status: 200, body: { thread } };
  });

  router.delete("/api/v1/agent/xiaoze/threads/:threadId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseParams(xiaozeThreadIdParamsSchema, request.params);
    // Archive and its audit commit together (ADR-0027).
    await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const archived = await archiveXiaozeThread(tx, auth.organization.id, auth.user.id, params.threadId);
      if (!archived) {
        throw threadNotFound(params.threadId);
      }
      return {
        result: undefined,
        audit: {
          app: "wiseeff",
          kind: "agent-session",
          action: "archived",
          severity: "Low",
          projectId: null,
          targetType: "agent_session",
          targetId: params.threadId,
          metadata: { sessionId: params.threadId }
        }
      };
    });

    return { status: 200, body: { ok: true } };
  });
}

export type XiaozeThreadRouteHandler = (request: RouteRequest) => Promise<RouteResponse>;
