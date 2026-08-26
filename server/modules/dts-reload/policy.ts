import { assertTrustedInvocationContext, TrustedInvocationContextError, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { assertTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";

export const DTS_RELOAD_AGENT_REFUSED_CODE = "dts-reload-agent-refused";
export const DTS_RELOAD_SYSTEM_REFUSED_CODE = "dts-reload-system-refused";

export type DtsReloadMutatingAction = "start" | "deploy" | "restore" | "configure" | "promote";

export type DtsReloadInvocationContext = {
  invocation: TrustedInvocationContext;
  requestId: string;
  /** Server-owned refusal writer whose pool connection is independent of caller transactions. */
  refusalSink: TrustedRefusalAuditSink;
};

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
 * Promotion is a reload-adjacent write: read the run, then create parameter drafts.
 * Caller needs the reload read gate, `parameter:edit`, and either the existing
 * reload write permission or Admin. Does not grant submit/review.
 */
export function requireDtsReloadPromote(auth: AuthContext) {
  requireDtsReloadView(auth);
  if (!hasPermission(auth, "parameter:edit")) {
    throw new ApiError("FORBIDDEN", "Missing permission: parameter:edit.", {
      permission: "parameter:edit"
    });
  }
  if (!hasPermission(auth, "debugging:dts-reload") && !hasPermission(auth, "admin:access")) {
    throw new ApiError("FORBIDDEN", "Missing permission: debugging:dts-reload.", {
      permission: "debugging:dts-reload"
    });
  }
}

/**
 * Validate the server-owned invocation seam before a mutation is authorized or queried.
 * A user/Agent context must describe the same authenticated principal supplied to the
 * domain service; a system context deliberately has no principal to compare.
 */
export function assertDtsReloadInvocationContext(
  auth: AuthContext,
  context: DtsReloadInvocationContext | undefined
): DtsReloadInvocationContext {
  if (
    !context ||
    typeof context.requestId !== "string" ||
    context.requestId.trim().length === 0 ||
    !context.refusalSink
  ) {
    throw new TrustedInvocationContextError(
      "DTS reload mutation requires a requestId, server-owned refusal audit sink, and trusted invocation context"
    );
  }

  assertTrustedRefusalAuditSink(context.refusalSink);
  const invocation = assertTrustedInvocationContext(context.invocation);
  if (
    invocation.initiator !== "system" &&
    (invocation.principal.user.id !== auth.user.id ||
      invocation.principal.organization.id !== auth.organization.id ||
      invocation.principal.user.organizationId !== auth.organization.id)
  ) {
    throw new TrustedInvocationContextError("DTS reload invocation principal does not match the authenticated principal");
  }

  return { invocation, requestId: context.requestId, refusalSink: context.refusalSink };
}

/**
 * Refuse non-user invocations from every DTS reload mutation. Refusal evidence is written
 * through the server-owned refusal sink so it survives the caller transaction's rollback.
 */
export async function requireDtsReloadUserInvocation(
  auth: AuthContext,
  input: {
    context: DtsReloadInvocationContext;
    action: DtsReloadMutatingAction;
    projectId?: string | null;
    runId?: string | null;
  }
): Promise<TrustedInvocationContext> {
  const context = assertDtsReloadInvocationContext(auth, input.context);
  const invocation = context.invocation;
  if (invocation.initiator === "user") {
    return invocation;
  }

  const isAgent = invocation.initiator === "agent";
  const code = isAgent ? DTS_RELOAD_AGENT_REFUSED_CODE : DTS_RELOAD_SYSTEM_REFUSED_CODE;
  const reason = isAgent ? "agent-refused" : "system-refused";
  const kind = isAgent ? "dts-reload-agent-refused" : "dts-reload-system-refused";
  const targetType = input.runId
    ? "dts-reload-run"
    : input.action === "configure"
      ? "dts-reload-configuration"
      : "dts-reload";
  const targetId = input.runId ?? input.projectId ?? "dts-reload";

  await context.refusalSink.write({
    invocation,
    projectId: input.projectId ?? null,
    app: "dts-reload",
    kind,
    action: "deny",
    severity: "High",
    targetType,
    targetId,
    metadata: {
      code,
      reason,
      requireHuman: true,
      action: input.action
    },
    traceId: context.requestId
  });

  if (isAgent) {
    throw new ApiError(
      "FORBIDDEN",
      "Agent actors cannot start, deploy, restore, configure, or promote DTS reload; a human operator is required.",
      {
        code,
        reason,
        requireHuman: true,
        action: input.action,
        initiator: invocation.initiator
      }
    );
  }

  throw new ApiError(
    "FORBIDDEN",
    "System invocations cannot start, deploy, restore, configure, or promote DTS reload; a human operator is required.",
    {
      code,
      reason,
      requireHuman: true,
      action: input.action,
      initiator: invocation.initiator
    }
  );
}
