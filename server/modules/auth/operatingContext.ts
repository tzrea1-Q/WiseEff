import type { AuthContext } from "./types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { canOperateInOrganization } from "./policy";
import { withOperatingOrganization, type UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";

/** The authenticated actor keeps their Home organization; only this resource scope varies. */
export type OperatingContext = Readonly<{
  actor: AuthContext;
  organization: AuthContext["organization"];
}>;

export async function resolveOperatingContext(db: Queryable, invocation: UserInvocationContext, organizationId?: string): Promise<UserInvocationContext> {
  requireUserInitiatedInvocation(invocation);
  const actor = invocation.principal, targetId = organizationId ?? actor.organization.id;
  if (!canOperateInOrganization(actor, targetId)) {
    throw new ApiError("FORBIDDEN", "The authenticated user cannot operate in this Organization.");
  }
  const row = (await db.query<{ id: string; name: string; status: string }>("select id, name, status from organizations where id = $1", [targetId])).rows[0];
  if (row?.status === "deleting") throw new ApiError("FORBIDDEN", "组织正在清理，不能开始新的业务操作。", { reason: "organization-unavailable" });
  const organization = row ? { id: row.id, name: row.name, ...(row.status === "suspended" ? { status: "suspended" as const } : {}) } : undefined;
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.");
  return withOperatingOrganization(invocation, organization);
}

/** Resolve one explicit request, never change account membership or a shared session target. */
export async function enterOperatingContext(db: Database, invocation: UserInvocationContext, organizationId: string | undefined, context: { requestId: string }): Promise<OperatingContext> {
  return db.transaction(async (tx) => {
    const scoped = await resolveOperatingContext(tx, invocation, organizationId);
    const organization = scoped.operatingOrganization!;
    await writeAuditEventInTx(asAuditTx(tx), scoped, context, {
      app: "user-governance", kind: "organization-operating-scope", action: "resolve-operating-scope", severity: "Medium",
      projectId: null, targetType: "organization", targetId: organization.id, metadata: {}
    });
    return Object.freeze({ actor: scoped.principal, organization });
  });
}
