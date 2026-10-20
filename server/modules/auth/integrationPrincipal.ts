import type { IntegrationInvocationContext } from "./trustedInvocation";

/** A machine principal has no user, roles, permissions, or AuthContext. */
export type IntegrationPrincipal = Readonly<{
  kind: "integration";
  credentialId: string;
  organizationId: string;
  name: string;
  skillId: string | null;
  invocation: IntegrationInvocationContext;
}>;
