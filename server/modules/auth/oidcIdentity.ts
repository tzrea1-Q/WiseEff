import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";

export type OidcIdentity = { issuer: string; subject: string };
export type SetOidcIdentityInput = OidcIdentity & { email?: string; expectedIdentity: OidcIdentity | null };
export function normalizeOidcIssuer(issuer: string) { return issuer.trim().replace(/\/+$/, ""); }

export async function setOidcIdentity(db: Database, invocation: UserInvocationContext, userId: string, input: SetOidcIdentityInput, configuredIssuer: string | undefined, context: { requestId: string }) {
  requireUserInitiatedInvocation(invocation);
  const auth = invocation.principal, issuer = normalizeOidcIssuer(input.issuer), subject = input.subject;
  if (!auth.user.isActive || !auth.permissions.includes("users:manage")) throw new ApiError("FORBIDDEN", "User management permission is required.");
  if (!configuredIssuer || issuer !== normalizeOidcIssuer(configuredIssuer) || !subject.trim()) throw new ApiError("VALIDATION_FAILED", "OIDC binding requires the configured issuer and a nonblank subject.");
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended('oidc-identity:'||$1,0))", [auth.organization.id]);
    const current = (await tx.query<{ issuer: string | null; subject: string | null; legacy_email: string | null }>(`
      select identity.issuer,identity.subject,identity.legacy_email from public.user_oidc_identities identity
      join public.users on users.id=identity.user_id and users.organization_id=identity.organization_id
      where identity.organization_id=$1 and identity.user_id=$2 for update of users,identity
    `, [auth.organization.id,userId])).rows[0];
    if (!current) throw new ApiError("NOT_FOUND", "User was not found.");
    if (!auth.roles.some((role) => role.roleId === "platform-admin") && (await tx.query(`
      select 1 from public.user_role_bindings where organization_id=$1 and user_id=$2 and role_id='platform-admin'
    `, [auth.organization.id,userId])).rows.length) throw new ApiError("FORBIDDEN", "Only a platform super admin may change a platform-admin identity binding.");
    const expected = input.expectedIdentity;
    if (current.issuer !== (expected?.issuer ?? null) || current.subject !== (expected?.subject ?? null)) throw new ApiError("CONFLICT", "OIDC binding changed; refresh the member before retrying.");
    const emails = [...new Set([current.legacy_email,input.email?.trim().toLowerCase()].filter((value): value is string => Boolean(value)))];
    const conflicts = await tx.query<{ user_id: string }>(`
      select user_id from public.user_oidc_identities where organization_id=$1 and user_id<>$2
        and ((issuer=$3 and subject=$4) or user_id=$4 or (issuer is null and legacy_email=any($5::text[])))
    `, [auth.organization.id,userId,issuer,subject,emails]);
    if (conflicts.rows.length) throw new ApiError("CONFLICT", "OIDC identity matches another member; check the subject and original migration email instead of merging accounts.");
    await tx.query("update public.user_oidc_identities set issuer=$3,subject=$4,updated_at=now() where organization_id=$1 and user_id=$2", [auth.organization.id,userId,issuer,subject]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance",kind: "user-update",action: "update",severity: "High",projectId: null,targetType: "user",targetId: userId,
      metadata: { previousIdentity: current.issuer ? { issuer: current.issuer,subject: current.subject } : null,identity: { issuer,subject } } });
    return { issuer,subject };
  });
}
