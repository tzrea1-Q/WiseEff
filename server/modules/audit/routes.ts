import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createAuditEvent, listAuditEvents } from "./repository";

const auditBodySchema = z.object({
  app: z.string().min(1),
  kind: z.string().min(1),
  action: z.string().min(1),
  severity: z.enum(["High", "Medium", "Low"]),
  projectId: z.string().nullable().optional(),
  targetType: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).default({})
});

const auditListQuerySchema = z.object({
  projectId: z.string().optional(),
  app: z.string().optional(),
  apps: z.string().optional(),
  kind: z.string().optional(),
  severity: z.enum(["High", "Medium", "Low"]).optional(),
  actorUserId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  traceId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

function parseAuditListQuery(query: Record<string, string | string[]>) {
  const raw = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  const parsed = auditListQuerySchema.parse(raw);
  const apps = parsed.apps
    ? parsed.apps
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

  return {
    projectId: parsed.projectId,
    app: parsed.app,
    apps: apps && apps.length > 0 ? apps : undefined,
    kind: parsed.kind,
    severity: parsed.severity,
    actorUserId: parsed.actorUserId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    traceId: parsed.traceId,
    from: parsed.from,
    to: parsed.to,
    cursor: parsed.cursor,
    limit: parsed.limit
  };
}

export function registerAuditRoutes(
  router: WiseEffRouter,
  options: { db?: Queryable; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.post("/api/v1/audit-events", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit writes.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.", 403);
    }

    const body = auditBodySchema.parse(request.body);
    const id = randomUUID();

    await createAuditEvent(options.db, {
      id,
      organizationId: auth.organization.id,
      projectId: body.projectId ?? null,
      actorUserId: auth.user.id,
      actorType: "user",
      app: body.app,
      kind: body.kind,
      action: body.action,
      severity: body.severity,
      targetType: body.targetType ?? null,
      targetId: body.targetId ?? null,
      metadata: body.metadata,
      traceId: request.requestId
    });

    return { status: 201, body: { id } };
  });

  router.get("/api/v1/audit-events", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit reads.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.", 403);
    }

    const query = parseAuditListQuery(request.query);
    const result = await listAuditEvents(options.db, {
      organizationId: auth.organization.id,
      ...query
    });

    return { status: 200, body: result };
  });
}
