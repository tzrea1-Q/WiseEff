import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext, BackendPermission } from "../auth/types";
import type { SensitiveWriteActorType } from "../parameters/sensitiveNode";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export const DTS_RELOAD_AGENT_REFUSED_CODE = "dts-reload-agent-refused";

export type DtsReloadMutatingAction = "start" | "deploy" | "restore" | "configure";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.user.isActive && auth.permissions.includes(permission);
}

/** Dedicated permission for starting and mutating DTS reload debugging runs. */
export function requireDtsReload(auth: AuthContext) {
  requirePermission(auth, "debugging:dts-reload");
}

/**
 * Read history / candidates / residue / artifact metadata.
 * Accepts either `debugging:view` or `debugging:dts-reload` so view-only users
 * can learn from past runs without being able to start one.
 */
export function requireDtsReloadView(auth: AuthContext) {
  if (hasPermission(auth, "debugging:view") || hasPermission(auth, "debugging:dts-reload")) {
    return;
  }
  throw new ApiError("FORBIDDEN", "Missing permission: debugging:view.", 403, {
    permission: "debugging:view"
  });
}

/**
 * Refuse Agent actors from DTS reload mutating paths (start / deploy / restore / configure).
 * Sensitive-node Agent refusal remains as defence in depth for matched batches.
 *
 * Trust boundary: `actorType` is a caller-supplied in-process label (same pattern as
 * `SensitiveWriteActorType` in parameters). It binds Agent tool / service callers that
 * pass `actorType: "agent"`; an agent presenting a user HTTP token is indistinguishable
 * from a human. See TD-068 / docs/SECURITY.md.
 */
export async function assertDtsReloadHumanActor(
  db: Queryable,
  auth: AuthContext,
  input: {
    actorType?: SensitiveWriteActorType;
    action: DtsReloadMutatingAction;
    projectId?: string | null;
    runId?: string | null;
    requestId?: string;
  }
): Promise<void> {
  const actorType = input.actorType ?? "user";
  if (actorType !== "agent") {
    return;
  }

  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId ?? null,
    actorUserId: auth.user.id,
    actorType: "agent",
    app: "dts-reload",
    kind: "dts-reload-agent-refused",
    action: "deny",
    severity: "High",
    targetType: input.runId ? "dts-reload-run" : input.action === "configure" ? "dts-reload-configuration" : "dts-reload",
    targetId: input.runId ?? input.projectId ?? "dts-reload",
    metadata: {
      code: DTS_RELOAD_AGENT_REFUSED_CODE,
      reason: "agent-refused",
      requireHuman: true,
      action: input.action
    },
    traceId: input.requestId ?? randomUUID()
  });

  throw new ApiError(
    "FORBIDDEN",
    "Agent actors cannot start, deploy, restore, or configure DTS reload; a human operator is required.",
    403,
    {
      code: DTS_RELOAD_AGENT_REFUSED_CODE,
      reason: "agent-refused",
      requireHuman: true,
      action: input.action
    }
  );
}
