import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuditCorrelationContext } from "../audit/types";
import type { RoleBinding } from "../auth/types";
import type { UserGovernanceDto } from "./types";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";

export type AdministratorMutationContext = AuditCorrelationContext & {
  authenticationProvider?: "local" | "oidc" | "hmac";
  oidcIssuer?: string;
  bridgeConnectionPool?: Pick<BridgeConnectionPool, "disconnect"> & Partial<Pick<BridgeConnectionPool, "drain">>;
};

// Shared by continuity checks and directory status; $3 is provider, $4 the configured issuer.
export const administratorLoginIdentitySql = `(coalesce($3::text,'hmac')='hmac'
  or ($3='local' and exists(select 1 from user_password_credentials credentials where credentials.user_id=users.id))
  or ($3='oidc' and exists(select 1 from user_oidc_identities identity where identity.user_id=users.id
    and identity.organization_id=users.organization_id
    and (identity.transfer_pending_since is null or identity.transfer_verified_at is not null)
    and ((identity.issuer=$4 and identity.subject is not null) or (identity.issuer is null and identity.legacy_subject)))))`;

export async function lockAdministratorMutation(tx: Queryable) {
  // ponytail: one transaction lock serializes administrator mutations across organizations;
  // split organization/global locks if administration throughput ever requires it.
  await tx.query("select pg_advisory_xact_lock(hashtextextended('administrator-continuity',0))");
}

export function hasOrganizationRole(roles: readonly RoleBinding[], roleId: "admin" | "platform-admin") {
  return roles.some((role) => role.projectId === null && role.roleId === roleId);
}

export async function listUsableAdministratorIds(tx: Queryable, organizationId: string | null, roleId: "admin" | "platform-admin", context: AdministratorMutationContext = {}) {
  const result = await tx.query<{ id: string }>(`
    select users.id from users where users.is_active
      and ($1::text is null or users.organization_id=$1)
      and exists(select 1 from user_role_bindings roles where roles.user_id=users.id
        and roles.organization_id=users.organization_id and roles.project_id is null and roles.role_id=$2)
      and ${administratorLoginIdentitySql}
    order by users.id
  `, [organizationId, roleId, context.authenticationProvider ?? "hmac", context.oidcIssuer?.trim().replace(/\/+$/, "") ?? null]);
  return result.rows.map((row) => row.id);
}

/** Call under lockAdministratorMutation before changing active state, roles or Home organization. */
export async function assertAdministratorContinuity(tx: Queryable, current: UserGovernanceDto, next: { isActive?: boolean; roles?: RoleBinding[]; organizationId?: string; loginUsable?: boolean }, context: AdministratorMutationContext = {}, emergency = false) {
  const active = next.isActive ?? current.isActive, roles = next.roles ?? current.roles;
  const moved = next.organizationId !== undefined && next.organizationId !== current.organizationId;
  for (const roleId of ["platform-admin", "admin"] as const) {
    if (!current.isActive || !hasOrganizationRole(current.roles, roleId) || (active && next.loginUsable !== false && hasOrganizationRole(roles, roleId) && (!moved || roleId === "platform-admin"))) continue;
    const administrators = await listUsableAdministratorIds(tx, roleId === "admin" ? current.organizationId : null, roleId, context);
    if (administrators.includes(current.id) && administrators.length === 1 && !(emergency && roleId === "admin")) {
      throw new ApiError("CONFLICT", roleId === "platform-admin" ? "At least one usable platform super administrator must remain." : "At least one usable organization administrator must remain.",
        { code: roleId === "platform-admin" ? "last-platform-administrator" : "last-organization-administrator", userId: current.id });
    }
  }
}
