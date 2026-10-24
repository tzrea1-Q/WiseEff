import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesScope, type UserInvocationContext } from "../auth/trustedInvocation";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

/** Per-request Agent target; all authenticated principal fields retain their Home values. */
export type AgentAccessContext = AuthContext & { readonly agentInvocation?: UserInvocationContext };

export function agentOrganizationId(auth: AgentAccessContext): string {
  const invocation = auth.agentInvocation;
  if (!invocation) return auth.organization.id;
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Agent organization scope");
  return id;
}

export function withAgentInvocation(auth: AuthContext, invocation: UserInvocationContext): AgentAccessContext {
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Agent organization scope");
  return Object.freeze(Object.defineProperty({ ...auth }, "agentInvocation", { value: invocation }));
}

/** Existing suspension behavior is separate; erasure stops in-flight producers. */
export async function requireAgentRunAvailable(db: Queryable, auth: AgentAccessContext) {
  if (!(await db.query("select id from organizations where id=$1 and status<>'deleting'", [agentOrganizationId(auth)])).rowCount) {
    throw new ApiError("CONFLICT", "Agent 会话所属组织正在清理或已删除。", { reason: "organization-unavailable" });
  }
}
