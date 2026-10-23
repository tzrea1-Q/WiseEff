import { z } from "zod";
import type { Database } from "../../shared/database/client";
import type { RouteRequest } from "../../shared/http/router";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { resolveOperatingContext } from "../auth/operatingContext";
import {
  assertTrustedInvocationContext, assertTrustedInvocationMatchesAuth, assertTrustedInvocationMatchesScope,
  type TrustedInvocationContext, type UserInvocationContext, type AgentInvocationContext
} from "../auth/trustedInvocation";

export type ParameterScopeContext = { invocation?: TrustedInvocationContext };
const resourceInvocation = Symbol("parameter-resource-invocation");
export type ParameterAccessContext = AuthContext & { readonly [resourceInvocation]?: UserInvocationContext | AgentInvocationContext };

export function parameterInvocation(auth: AuthContext) {
  return (auth as ParameterAccessContext)[resourceInvocation];
}

export function withParameterAccess(auth: AuthContext, value: UserInvocationContext | AgentInvocationContext): ParameterAccessContext {
  const invocation = assertTrustedInvocationMatchesScope(auth, value, value.operatingOrganization?.id ?? value.principal.organization.id, "parameter operating scope");
  return Object.freeze({ ...auth, [resourceInvocation]: invocation });
}

/** Actor fields always describe Home; only this explicitly authorized resource scope varies. */
export function parameterOrganizationId(auth: AuthContext, context: ParameterScopeContext = {}) {
  const carried = parameterInvocation(auth);
  if (carried && context.invocation) {
    assertTrustedInvocationMatchesScope(auth, context.invocation, carried.operatingOrganization?.id ?? auth.organization.id, "fixed parameter resource scope");
  }
  const value = context.invocation ?? carried;
  if (!value) return auth.organization.id;
  const invocation = assertTrustedInvocationContext(value);
  if (invocation.initiator === "system") return auth.organization.id;
  if (invocation.initiator === "integration") throw new ApiError("FORBIDDEN", "Parameter user access requires a real actor.");
  const organizationId = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, organizationId, "parameter resource Organization");
  return organizationId;
}

export function parameterScopeInvocation(auth: AuthContext, value: unknown, operation: string) {
  return parameterInvocation(auth)
    ? assertTrustedInvocationMatchesScope(auth, value, parameterOrganizationId(auth), operation)
    : assertTrustedInvocationMatchesAuth(auth, value, operation);
}

export async function parameterRequestAccess(db: Database | undefined, invocation: UserInvocationContext, request: RouteRequest): Promise<AuthContext> {
  const parsed = z.string().trim().min(1).max(200).optional().safeParse(request.query.organizationId);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid operating Organization.");
  if (parsed.data === undefined) return invocation.principal;
  if (!db) throw new ApiError("INTERNAL_ERROR", "Operating Organization requires the database adapter.");
  return withParameterAccess(invocation.principal, await resolveOperatingContext(db, invocation, parsed.data));
}
