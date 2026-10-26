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
  eventId: z.string().min(1).max(200).optional(),
  projectId: z.string().optional(),
  app: z.string().optional(),
  apps: z.string().optional(),
  kind: z.string().optional(),
  severity: z.enum(["High", "Medium", "Low", "info"]).optional(),
  severities: z.string().transform((value) => value.split(","))
    .pipe(z.array(z.enum(["High", "Medium", "Low", "info"])).min(1).max(4)).optional(),
  actorUserId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  traceId: z.string().optional(),
  q: z.string().max(200).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

function parseAuditListQuery(query: Record<string, string | string[]>) {
  const raw = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  const result = auditListQuerySchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid audit query.");
  }
  const parsed = result.data;
  if (parsed.from && parsed.to && Date.parse(parsed.from) > Date.parse(parsed.to)) {
    throw new ApiError("VALIDATION_FAILED", "Audit start time must not be after end time.");
  }
  const apps = parsed.apps
    ? parsed.apps
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

  return {
    eventId: parsed.eventId,
    projectId: parsed.projectId,
    app: parsed.app,
    apps: apps && apps.length > 0 ? apps : undefined,
    kind: parsed.kind,
    severity: parsed.severity,
    severities: parsed.severities,
    actorUserId: parsed.actorUserId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    traceId: parsed.traceId,
    q: parsed.q,
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
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit writes.");
    }

    const auth = await options.getCurrentAuthContext(request);
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.");
    }

    const parsedBody = auditBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw new ApiError("VALIDATION_FAILED", "Invalid audit event.");
    }
    const body = parsedBody.data;
    const id = randomUUID();

    // Stays on the direct path (ratchet allowlist): for this endpoint the audit
    // event IS the domain write — there is nothing else to be atomic with.
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
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit reads.");
    }

    const auth = await options.getCurrentAuthContext(request);
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.");
    }

    const query = parseAuditListQuery(request.query);
    const result = await listAuditEvents(options.db, {
      organizationId: auth.organization.id,
      ...query,
      ...(auth.user.isActive && auth.roles.some((role) => role.roleId === "platform-admin" && role.projectId === null)
        ? { includePlatformWorkflowPublication: true }
        : {})
    });

    return { status: 200, body: result };
  });
}
