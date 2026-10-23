import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesScope, type UserInvocationContext } from "../auth/trustedInvocation";

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
