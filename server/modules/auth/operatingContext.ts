import type { AuthContext } from "./types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { canOperateInOrganization } from "./policy";
import { createUserInvocation } from "./trustedInvocation";

/** The authenticated actor keeps their Home organization; only this resource scope varies. */
export type OperatingContext = Readonly<{
  actor: AuthContext;
  organization: AuthContext["organization"];
}>;

export async function resolveOperatingContext(db: Queryable, actor: AuthContext, organizationId = actor.organization.id): Promise<OperatingContext> {
  if (!canOperateInOrganization(actor, organizationId)) {
    throw new ApiError("FORBIDDEN", "The authenticated user cannot operate in this Organization.");
  }
  const organization = (await db.query<AuthContext["organization"]>("select id, name from organizations where id = $1", [organizationId])).rows[0];
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.");
  const invocation = createUserInvocation(actor, organization);
  return Object.freeze({ actor: invocation.principal, organization: invocation.operatingOrganization! });
}

/** Resolve one explicit request, never change account membership or a shared session target. */
export async function enterOperatingContext(db: Database, actor: AuthContext, organizationId: string | undefined, context: { requestId: string }): Promise<OperatingContext> {
  return db.transaction(async (tx) => {
    const scope = await resolveOperatingContext(tx, actor, organizationId);
    await writeAuditEventInTx(asAuditTx(tx), createUserInvocation(scope.actor, scope.organization), context, {
      app: "user-governance", kind: "organization-operating-scope", action: "resolve-operating-scope", severity: "Medium",
      projectId: null, targetType: "organization", targetId: scope.organization.id, metadata: {}
    });
    return scope;
  });
}
