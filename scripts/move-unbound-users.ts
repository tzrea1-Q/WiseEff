import type { Queryable } from "../server/shared/database/client";

/** Operator/fixture callers own the transaction; API account management cannot move tenants. */
export async function moveUnboundUsersToOrganization(tx: Queryable, userIds: readonly string[], organizationId: string) {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('oidc-identity:'||$1,0))", [organizationId]);
  const users = await tx.query<{ id: string }>(`select id from users
    where id=any($1::text[]) and organization_id<>$2 order by id for update`, [userIds, organizationId]);
  for (const user of users.rows) {
    const identity = (await tx.query<{ issuer: string | null; subject: string | null; legacy_email: string | null; legacy_subject: boolean; updated_at: Date }>(
      "select issuer,subject,legacy_email,legacy_subject,updated_at from user_oidc_identities where user_id=$1 for update", [user.id])).rows[0];
    if (!identity || identity.issuer !== null || identity.subject !== null) {
      throw new Error("An explicitly bound OIDC identity cannot move organizations. Provision a separate local lab account.");
    }
    const conflict = await tx.query("select user_id from user_oidc_identities where organization_id=$1 and subject=$2 and user_id<>$2", [organizationId, user.id]);
    if (conflict.rows.length) throw new Error("The destination organization already uses this member's OIDC subject.");
    // Preserve pre-0238 local accounts' frozen legacy fields and stable user ID.
    await tx.query("delete from user_oidc_identities where user_id=$1", [user.id]);
    await tx.query("update users set organization_id=$2 where id=$1", [user.id, organizationId]);
    await tx.query(`insert into user_oidc_identities(user_id,organization_id,legacy_email,legacy_subject,updated_at)
      values($1,$2,$3,$4,$5)`, [user.id, organizationId, identity.legacy_email, identity.legacy_subject, identity.updated_at]);
  }
}
