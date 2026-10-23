import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, assertTrustedInvocationMatchesScope, type TrustedInvocationContext, type UserInvocationContext, type AgentInvocationContext } from "../auth/trustedInvocation";

/** Knowledge resource scope; the authenticated Home fields remain unchanged. */
export type KnowledgeAccessContext = AuthContext & { readonly knowledgeInvocation?: UserInvocationContext | AgentInvocationContext };

export function knowledgeOrganizationId(auth: KnowledgeAccessContext): string {
  const invocation = auth.knowledgeInvocation;
  if (!invocation) return auth.organization.id;
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Knowledge resource scope");
  return id;
}

export function withKnowledgeInvocation(auth: AuthContext, invocation: UserInvocationContext | AgentInvocationContext): KnowledgeAccessContext {
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  const trusted = assertTrustedInvocationMatchesScope(auth, invocation, id, "Knowledge resource scope");
  return Object.freeze(Object.defineProperty({ ...auth }, "knowledgeInvocation", { value: trusted }));
}

export function assertKnowledgeInvocationMatches(auth: KnowledgeAccessContext, invocation: TrustedInvocationContext, operation: string) {
  return auth.knowledgeInvocation
    ? assertTrustedInvocationMatchesScope(auth, invocation, knowledgeOrganizationId(auth), operation)
    : assertTrustedInvocationMatchesAuth(auth, invocation, operation);
}
