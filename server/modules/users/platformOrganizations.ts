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
import { createPlatformOrganizationSchema, type platformOrganizationSchema, type recoverOrganizationAdministratorSchema } from "../contracts/dtoSchemas/platformOrganizations";
import { getUserById, insertPasswordCredential, insertUser, listUsers, lockUserById, updateOrganizationRoles, updateUserActive } from "./repository";
import { administratorLoginIdentitySql, assertAdministratorContinuity, hasOrganizationRole, listUsableAdministratorIds, lockAdministratorMutation, type AdministratorMutationContext } from "./administratorContinuity";
import { revokePersonalAccess } from "./personalAccess";

type Organization = z.infer<typeof platformOrganizationSchema>;
export function requirePlatformOrganizationManager(auth: AuthContext) {
  if (!auth.user.isActive || auth.user.organizationId !== auth.organization.id || !auth.permissions.includes("platform:access") ||
    !auth.roles.some((role) => role.projectId === null && role.roleId === "platform-admin")) {
    throw new ApiError("FORBIDDEN", "Platform super administrator authority is required.");
  }
}

export async function listPlatformOrganizations(db: Queryable, actor: AuthContext, query = "", organizationId?: string, context: AdministratorMutationContext = {}): Promise<Organization[]> {
  requirePlatformOrganizationManager(actor);
  const result = await db.query<Organization>(`
    select organizations.id, organizations.name, organizations.created_at::text as "createdAt", 'active' as status,
      coalesce((select jsonb_agg(jsonb_build_object('id',users.id,'name',users.name,'isActive',users.is_active,'canLogin',users.is_active and ${administratorLoginIdentitySql}) order by users.name,users.id)
        from users where users.organization_id=organizations.id and exists
          (select 1 from user_role_bindings roles where roles.user_id=users.id and roles.organization_id=organizations.id
            and roles.project_id is null and roles.role_id='admin')), '[]'::jsonb) as administrators
    from organizations where ($1='' or position(lower($1) in lower(organizations.name))>0 or position(lower($1) in lower(organizations.id))>0)
      and ($2::text is null or organizations.id=$2)
    order by organizations.name,organizations.id
  `, [query.trim(), organizationId ?? null, context.authenticationProvider ?? "hmac", context.oidcIssuer ? normalizeOidcIssuer(context.oidcIssuer) : null]);
  return result.rows;
}

export async function createPlatformOrganization(db: Database, caller: UserInvocationContext, input: z.infer<typeof createPlatformOrganizationSchema>, configuredOidcIssuer: string | undefined, context: AdministratorMutationContext & { requestId: string }) {
  requireUserInitiatedInvocation(caller);
  const actor = caller.principal;
  requirePlatformOrganizationManager(actor);
  return db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    const organizationId = `org-${randomUUID()}`;
    await tx.query("insert into organizations(id,name) values($1,$2)", [organizationId, input.name]);
    const invocation = await resolveOperatingContext(tx, caller, organizationId);
    const userId = await provisionOrganizationAdministrator(tx, invocation, input.initialAdministrator, configuredOidcIssuer, context);
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance", kind: "organization-create", action: "create", severity: "High",
      projectId: null, targetType: "organization", targetId: organizationId, metadata: { initialAdministratorUserId: userId } });
    return (await listPlatformOrganizations(tx, actor, "", organizationId, context))[0];
  }).catch(identityConflict);
}

function identityConflict(error: unknown): never {
  if ((error as { code?: string })?.code === "23505") throw new ApiError("CONFLICT", "The initial administrator's login identity is already registered.");
  throw error;
}

async function provisionOrganizationAdministrator(tx: Database, invocation: UserInvocationContext, administrator: z.infer<typeof createPlatformOrganizationSchema>["initialAdministrator"], configuredOidcIssuer: string | undefined, context: { requestId: string }) {
  const oidc = "authentication" in administrator;
  if (Boolean(configuredOidcIssuer) !== oidc) throw new ApiError("VALIDATION_FAILED", configuredOidcIssuer
    ? "OIDC provisioning requires an explicit subject instead of a local password." : "OIDC provisioning is not enabled.");
  const username = oidc ? null : administrator.username.trim().toLowerCase();
  if (oidc && normalizeOidcIssuer(administrator.issuer) !== normalizeOidcIssuer(configuredOidcIssuer!)) throw new ApiError("VALIDATION_FAILED", "OIDC binding requires the configured issuer.");
  if (!oidc) { validateLocalAccountUsername(username!); validateLocalAccountPassword(administrator.password); }
  const passwordHash = oidc ? null : await hashLocalAccountPassword(administrator.password);
  const organizationId = invocation.operatingOrganization!.id, userId = `u-${randomUUID()}`;
  await insertUser(tx, { id: userId, organizationId, name: administrator.name, title: administrator.title?.trim() || "组织管理员",
    ...(oidc && administrator.email ? { email: administrator.email.trim().toLowerCase() } : {}) });
  await updateOrganizationRoles(tx, { organizationId, userId, roles: ["admin"] });
  if (oidc) await setOidcIdentity(tx, invocation, userId, { issuer: administrator.issuer, subject: administrator.subject, email: administrator.email, expectedIdentity: null }, configuredOidcIssuer, context);
  else await insertPasswordCredential(tx, { userId, username: username!, passwordHash: passwordHash! });
  return userId;
}

export async function getAdministratorRecovery(db: Queryable, actor: UserInvocationContext, organizationId: string, context: AdministratorMutationContext) {
  requirePlatformOrganizationManager(actor.principal);
  await resolveOperatingContext(db, actor, organizationId);
  const users = await listUsers(db, organizationId);
  return { members: users.map(({ id, name, isActive }) => ({ id, name, isActive })), usableAdministratorIds: await listUsableAdministratorIds(db, organizationId, "admin", context) };
}

export async function emergencyDisableAdministrator(db: Database, actor: UserInvocationContext, organizationId: string, userId: string, reason: string, context: AdministratorMutationContext & { requestId: string }) {
  requirePlatformOrganizationManager(actor.principal);
  const result = await db.transaction(async (tx) => {
    const invocation = await resolveOperatingContext(tx, actor, organizationId);
    await lockAdministratorMutation(tx);
    await lockUserById(tx, { organizationId, userId });
    const user = await getUserById(tx, { organizationId, userId });
    if (!user) throw new ApiError("NOT_FOUND", "User was not found.");
    if (!user.isActive || !hasOrganizationRole(user.roles, "admin")) throw new ApiError("CONFLICT", "Emergency disabling requires an active organization administrator.");
    await assertAdministratorContinuity(tx, user, { isActive: false }, context, true);
    await updateUserActive(tx, { organizationId, userId, isActive: false });
    const revokedBridgeIds = await revokePersonalAccess(tx, organizationId, userId);
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance", kind: "organization-administrator-emergency-disable", action: "deactivate", severity: "High",
      projectId: null, targetType: "user", targetId: userId, metadata: { reason } });
    return { item: (await listPlatformOrganizations(tx, actor.principal, "", organizationId, context))[0], revokedBridgeIds };
  });
  for (const bridgeId of result.revokedBridgeIds) context.bridgeConnectionPool?.disconnect(bridgeId);
  return result.item;
}

export async function recoverOrganizationAdministrator(db: Database, actor: UserInvocationContext, organizationId: string, input: z.infer<typeof recoverOrganizationAdministratorSchema>, configuredOidcIssuer: string | undefined, context: AdministratorMutationContext & { requestId: string }) {
  requirePlatformOrganizationManager(actor.principal);
  return db.transaction(async (tx) => {
    const invocation = await resolveOperatingContext(tx, actor, organizationId);
    await lockAdministratorMutation(tx);
    const userId = "userId" in input ? input.userId : await provisionOrganizationAdministrator(tx, invocation, input.administrator, configuredOidcIssuer, context);
    await lockUserById(tx, { organizationId, userId });
    const user = await getUserById(tx, { organizationId, userId });
    if (!user) throw new ApiError("NOT_FOUND", "User was not found.");
    const roles = [...new Set([...user.roles.filter((role) => role.projectId === null).map((role) => role.roleId), "admin" as const])];
    await updateOrganizationRoles(tx, { organizationId, userId, roles });
    await updateUserActive(tx, { organizationId, userId, isActive: true });
    if (!(await listUsableAdministratorIds(tx, organizationId, "admin", context)).includes(userId)) throw new ApiError("CONFLICT", "The successor needs a login identity for the configured authentication provider.");
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance", kind: "organization-administrator-recovery", action: "appoint", severity: "High",
      projectId: null, targetType: "user", targetId: userId, metadata: { wasActive: user.isActive } });
    return (await listPlatformOrganizations(tx, actor.principal, "", organizationId, context))[0];
  }).catch(identityConflict);
}
