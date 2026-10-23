import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";
import type { AuthContext } from "./types";
import { getAuthContextForExternalIdentity } from "./repository";
import { assertAdministratorContinuity, lockAdministratorMutation } from "../users/administratorContinuity";
import { getUserById } from "../users/repository";

export type OidcIdentity = { issuer: string; subject: string };
export type SetOidcIdentityInput = OidcIdentity & { email?: string; expectedIdentity: OidcIdentity | null };
export function normalizeOidcIssuer(issuer: string) { return issuer.trim().replace(/\/+$/, ""); }

/** Only the verified OIDC authentication path may record proof of the new claim. */
export async function completeOidcTransferAuthentication(db: Database, auth: AuthContext, input: { issuer: string; organizationId: string; subject: string; issuedAt?: number; email?: string }) {
  const pending = await db.query(`select 1 from public.user_oidc_identities where user_id=$1 and organization_id=$2
    and transfer_pending_since is not null and transfer_verified_at is null`, [auth.user.id, input.organizationId]);
  if (!pending.rowCount) return auth;
  return db.transaction(async tx => {
    // Match the binding/transfer lock so a concurrent rebind cannot verify an old subject.
    await tx.query("select pg_advisory_xact_lock(hashtextextended('oidc-identity:'||$1,0))", [input.organizationId]);
    await tx.query(`select users.id from public.users join public.user_oidc_identities identity on identity.user_id=users.id and identity.organization_id=users.organization_id
      where identity.organization_id=$1 and identity.issuer=$2 and identity.subject=$3 for share of users`, [input.organizationId, input.issuer, input.subject]);
    const current = await getAuthContextForExternalIdentity(tx, input);
    await tx.query(`update public.user_oidc_identities set transfer_verified_at=clock_timestamp()
      where user_id=$1 and organization_id=$2 and issuer=$3 and subject=$4
        and transfer_pending_since is not null and transfer_verified_at is null`, [current.user.id, input.organizationId, input.issuer, input.subject]);
    return current;
  });
}

export async function setOidcIdentity(db: Database, invocation: UserInvocationContext, userId: string, input: SetOidcIdentityInput, configuredIssuer: string | undefined, context: { requestId: string }) {
  requireUserInitiatedInvocation(invocation);
  const auth = invocation.principal, organizationId = invocation.operatingOrganization?.id ?? auth.organization.id,
    issuer = normalizeOidcIssuer(input.issuer), subject = input.subject;
  if (!auth.user.isActive || !auth.permissions.includes("users:manage")) throw new ApiError("FORBIDDEN", "User management permission is required.");
  if (!configuredIssuer || issuer !== normalizeOidcIssuer(configuredIssuer) || !subject.trim()) throw new ApiError("VALIDATION_FAILED", "OIDC binding requires the configured issuer and a nonblank subject.");
  return db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    await tx.query("select pg_advisory_xact_lock(hashtextextended('oidc-identity:'||$1,0))", [organizationId]);
    const current = (await tx.query<{ issuer: string | null; subject: string | null; legacy_email: string | null; transfer_pending_since: string | null }>(`
      select identity.issuer,identity.subject,identity.legacy_email,identity.transfer_pending_since from public.user_oidc_identities identity
      join public.users on users.id=identity.user_id and users.organization_id=identity.organization_id
      where identity.organization_id=$1 and identity.user_id=$2 for update of users,identity
    `, [organizationId,userId])).rows[0];
    if (!current) throw new ApiError("NOT_FOUND", "User was not found.");
    if (!auth.roles.some((role) => role.roleId === "platform-admin") && (await tx.query(`
      select 1 from public.user_role_bindings where organization_id=$1 and user_id=$2 and role_id='platform-admin'
    `, [organizationId,userId])).rows.length) throw new ApiError("FORBIDDEN", "Only a platform super admin may change a platform-admin identity binding.");
    const expected = input.expectedIdentity;
    if (current.issuer !== (expected?.issuer ?? null) || current.subject !== (expected?.subject ?? null)) throw new ApiError("CONFLICT", "OIDC binding changed; refresh the member before retrying.");
    if (current.transfer_pending_since && (current.issuer !== issuer || current.subject !== subject)) {
      const user = await getUserById(tx, { organizationId, userId });
      if (!user) throw new ApiError("NOT_FOUND", "User was not found.");
      await assertAdministratorContinuity(tx, user, { loginUsable: false }, { authenticationProvider: "oidc", oidcIssuer: configuredIssuer });
    }
    const emails = [...new Set([current.legacy_email,input.email?.trim().toLowerCase()].filter((value): value is string => Boolean(value)))];
    const conflicts = await tx.query<{ user_id: string }>(`
      select user_id from public.user_oidc_identities where organization_id=$1 and user_id<>$2
        and ((issuer=$3 and subject=$4) or user_id=$4 or (issuer is null and legacy_email=any($5::text[])))
    `, [organizationId,userId,issuer,subject,emails]);
    if (conflicts.rows.length) throw new ApiError("CONFLICT", "OIDC identity matches another member; check the subject and original migration email instead of merging accounts.");
    await tx.query(`update public.user_oidc_identities set issuer=$3,subject=$4,updated_at=now(),
      transfer_verified_at=case when issuer is distinct from $3 or subject is distinct from $4 then null else transfer_verified_at end
      where organization_id=$1 and user_id=$2`, [organizationId,userId,issuer,subject]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance",kind: "user-update",action: "update",severity: "High",projectId: null,targetType: "user",targetId: userId,
      metadata: { previousIdentity: current.issuer ? { issuer: current.issuer,subject: current.subject } : null,identity: { issuer,subject } } });
    return { issuer,subject };
  });
}
