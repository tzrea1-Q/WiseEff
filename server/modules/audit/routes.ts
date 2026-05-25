import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { WiseEffRouter } from "../../shared/http/router";
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

export function registerAuditRoutes(
  router: WiseEffRouter,
  options: { db?: Queryable; getCurrentAuthContext: () => Promise<AuthContext> | AuthContext }
) {
  router.post("/api/v1/audit-events", async (request) => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit writes.", 500);
    }

    const auth = await options.getCurrentAuthContext();
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

  router.get("/api/v1/audit-events", async () => {
    if (!options.db) {
      throw new ApiError("INTERNAL_ERROR", "Database adapter is required for audit reads.", 500);
    }

    const auth = await options.getCurrentAuthContext();
    if (!auth.permissions.includes("admin:access")) {
      throw new ApiError("FORBIDDEN", "Admin access required.", 403);
    }

    const items = await listAuditEvents(options.db, { organizationId: auth.organization.id });
    return { status: 200, body: { items } };
  });
}
