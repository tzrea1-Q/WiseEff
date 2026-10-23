import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { resolveOperatingContext } from "../auth/operatingContext";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { hashLocalAccountPassword, validateLocalAccountPassword, validateLocalAccountUsername } from "../auth/localAccountCredentials";
import { normalizeOidcIssuer, setOidcIdentity } from "../auth/oidcIdentity";
import { createPlatformOrganizationSchema, type platformOrganizationSchema } from "../contracts/dtoSchemas/platformOrganizations";
import { insertPasswordCredential, insertUser, updateOrganizationRoles } from "./repository";

type Organization = z.infer<typeof platformOrganizationSchema>;
export function requirePlatformOrganizationManager(auth: AuthContext) {
  if (!auth.user.isActive || auth.user.organizationId !== auth.organization.id || !auth.permissions.includes("platform:access") ||
    !auth.roles.some((role) => role.projectId === null && role.roleId === "platform-admin")) {
    throw new ApiError("FORBIDDEN", "Platform super administrator authority is required.");
  }
}

export async function listPlatformOrganizations(db: Queryable, actor: AuthContext, query = "", organizationId?: string): Promise<Organization[]> {
  requirePlatformOrganizationManager(actor);
  const result = await db.query<Organization>(`
    select organizations.id, organizations.name, organizations.created_at::text as "createdAt", 'active' as status,
      coalesce((select jsonb_agg(jsonb_build_object('id',users.id,'name',users.name,'isActive',users.is_active) order by users.name,users.id)
        from users where users.organization_id=organizations.id and exists
          (select 1 from user_role_bindings roles where roles.user_id=users.id and roles.organization_id=organizations.id
            and roles.project_id is null and roles.role_id in ('admin','platform-admin'))), '[]'::jsonb) as administrators
    from organizations where ($1='' or position(lower($1) in lower(organizations.name))>0 or position(lower($1) in lower(organizations.id))>0)
      and ($2::text is null or organizations.id=$2)
    order by organizations.name,organizations.id
  `, [query.trim(), organizationId ?? null]);
  return result.rows;
}

export async function createPlatformOrganization(db: Database, caller: UserInvocationContext, input: z.infer<typeof createPlatformOrganizationSchema>, configuredOidcIssuer: string | undefined, context: { requestId: string }) {
  requireUserInitiatedInvocation(caller);
  const actor = caller.principal;
  requirePlatformOrganizationManager(actor);
  const administrator = input.initialAdministrator, oidc = "authentication" in administrator;
  if (Boolean(configuredOidcIssuer) !== oidc) throw new ApiError("VALIDATION_FAILED", configuredOidcIssuer
    ? "OIDC provisioning requires an explicit subject instead of a local password." : "OIDC provisioning is not enabled.");
  const username = oidc ? null : administrator.username.trim().toLowerCase();
  if (oidc && normalizeOidcIssuer(administrator.issuer) !== normalizeOidcIssuer(configuredOidcIssuer!)) throw new ApiError("VALIDATION_FAILED", "OIDC binding requires the configured issuer.");
  if (!oidc) { validateLocalAccountUsername(username!); validateLocalAccountPassword(administrator.password); }
  const passwordHash = oidc ? null : await hashLocalAccountPassword(administrator.password);
  return db.transaction(async (tx) => {
    const organizationId = `org-${randomUUID()}`, userId = `u-${randomUUID()}`;
    await tx.query("insert into organizations(id,name) values($1,$2)", [organizationId, input.name]);
    const invocation = await resolveOperatingContext(tx, caller, organizationId);
    await insertUser(tx, { id: userId, organizationId, name: administrator.name, title: administrator.title?.trim() || "组织管理员",
      ...(oidc && administrator.email ? { email: administrator.email.trim().toLowerCase() } : {}) });
    await updateOrganizationRoles(tx, { organizationId, userId, roles: ["admin"] });
    if (oidc) await setOidcIdentity(tx, invocation, userId, { issuer: administrator.issuer, subject: administrator.subject, email: administrator.email, expectedIdentity: null }, configuredOidcIssuer, context);
    else await insertPasswordCredential(tx, { userId, username: username!, passwordHash: passwordHash! });
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance", kind: "organization-create", action: "create", severity: "High",
      projectId: null, targetType: "organization", targetId: organizationId, metadata: { initialAdministratorUserId: userId } });
    return (await listPlatformOrganizations(tx, actor, "", organizationId))[0];
  }).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "23505") throw new ApiError("CONFLICT", "The initial administrator's login identity is already registered.");
    throw error;
  });
}
