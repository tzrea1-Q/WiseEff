import { randomUUID } from "node:crypto";

import { writeRefusalAudit } from "../audit/auditedWrite";
import type { AuthContext, BackendPermission } from "../auth/types";
import type { SensitiveWriteActorType } from "../parameter-kernel/sensitiveNode";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export const DTS_RELOAD_AGENT_REFUSED_CODE = "dts-reload-agent-refused";

export type DtsReloadMutatingAction = "start" | "deploy" | "restore" | "configure";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, { permission });
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
  throw new ApiError("FORBIDDEN", "Missing permission: debugging:view.", {
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
  // Pool handle on purpose: the deny audit below must survive the caller's
  // rollback, so this guard must run outside any transaction (ADR-0027 refusal audits).
  db: Database,
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

  await writeRefusalAudit(db, auth, { requestId: input.requestId ?? randomUUID() }, {
    app: "dts-reload",
    kind: "dts-reload-agent-refused",
    action: "deny",
    severity: "High",
    projectId: input.projectId ?? null,
    targetType: input.runId ? "dts-reload-run" : input.action === "configure" ? "dts-reload-configuration" : "dts-reload",
    targetId: input.runId ?? input.projectId ?? "dts-reload",
    actorType: "agent",
    metadata: {
      code: DTS_RELOAD_AGENT_REFUSED_CODE,
      reason: "agent-refused",
      requireHuman: true,
      action: input.action
    }
  });

  throw new ApiError(
    "FORBIDDEN",
    "Agent actors cannot start, deploy, restore, or configure DTS reload; a human operator is required.",
    {
      code: DTS_RELOAD_AGENT_REFUSED_CODE,
      reason: "agent-refused",
      requireHuman: true,
      action: input.action
    }
  );
}
