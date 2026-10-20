import type { AuthContext } from "../auth/types";
import type { IntegrationPrincipal } from "../auth/integrationPrincipal";

export type LogPrincipal = AuthContext | IntegrationPrincipal;

export function organizationId(auth: LogPrincipal) {
  return "kind" in auth ? auth.organizationId : auth.organization.id;
}
