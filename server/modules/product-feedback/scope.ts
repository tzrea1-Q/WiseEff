import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesScope, createUserInvocation, type UserInvocationContext } from "../auth/trustedInvocation";

export type ProductFeedbackAccessContext = AuthContext & { readonly feedbackInvocation?: UserInvocationContext };
export function feedbackInvocation(auth: ProductFeedbackAccessContext) {
  return auth.feedbackInvocation ?? createUserInvocation(auth);
}
export function feedbackOrganizationId(auth: ProductFeedbackAccessContext) {
  const invocation = auth.feedbackInvocation;
  if (!invocation) return auth.organization.id;
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Product feedback scope");
  return id;
}
export function withProductFeedbackInvocation(auth: AuthContext, invocation: UserInvocationContext): ProductFeedbackAccessContext {
  const id = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  assertTrustedInvocationMatchesScope(auth, invocation, id, "Product feedback scope");
  return Object.freeze(Object.defineProperty({ ...auth }, "feedbackInvocation", { value: invocation }));
}
