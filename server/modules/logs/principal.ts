import type { AuthContext } from "../auth/types";
import type { IntegrationPrincipal } from "../auth/integrationPrincipal";
import { assertTrustedInvocationMatchesAuth, assertTrustedInvocationMatchesScope, type TrustedInvocationContext, type UserInvocationContext, type AgentInvocationContext } from "../auth/trustedInvocation";

export type LogAccessContext = AuthContext & { readonly logInvocation?: UserInvocationContext | AgentInvocationContext };
export type LogPrincipal = LogAccessContext | IntegrationPrincipal;

export function withLogInvocation(auth: AuthContext, invocation: UserInvocationContext | AgentInvocationContext): LogAccessContext {
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  const trusted = assertTrustedInvocationMatchesScope(auth, invocation, id, "Log resource scope");
  return Object.freeze(Object.defineProperty({ ...auth }, "logInvocation", { value: trusted }));
}

export function organizationId(auth: LogPrincipal) {
  if ("kind" in auth) return auth.organizationId;
  const invocation = auth.logInvocation;
  if (!invocation) return auth.organization.id;
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Log resource scope");
  return id;
}

/** Unscoped callers retain the existing Home-only mutation contract. */
export function assertLogInvocation(auth: LogAccessContext, invocation: TrustedInvocationContext, operation: string) {
  return auth.logInvocation
    ? assertTrustedInvocationMatchesScope(auth, invocation, organizationId(auth), operation)
    : assertTrustedInvocationMatchesAuth(auth, invocation, operation);
}
