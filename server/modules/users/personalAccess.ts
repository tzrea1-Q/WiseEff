import type { Queryable } from "../../shared/database/client";
import { revokeLocalUserSessions } from "../auth/localAuth";

/** Run while holding the member row lock, in the same transaction as disabling/deleting. */
export async function revokePersonalAccess(tx: Queryable, organizationId: string, userId: string) {
  const revokedAt = new Date().toISOString();
  await tx.query("update users set external_tokens_revoked_at=greatest(external_tokens_revoked_at,$3) where organization_id=$1 and id=$2", [organizationId, userId, revokedAt]);
  await revokeLocalUserSessions(tx, { userId, revokedAt });
  await tx.query("delete from device_bridge_pairing_codes where organization_id=$1 and user_id=$2", [organizationId, userId]);
  const bridges = await tx.query<{ id: string }>(`update device_bridges set revoked_at=coalesce(revoked_at,$3)
    where organization_id=$1 and user_id=$2 returning id`, [organizationId, userId, revokedAt]);
  await tx.query(`update device_bridge_tokens tokens set revoked_at=coalesce(tokens.revoked_at,$3)
    from device_bridges bridges where bridges.id=tokens.bridge_id and bridges.organization_id=$1 and bridges.user_id=$2`, [organizationId, userId, revokedAt]);
  return bridges.rows.map(bridge => bridge.id);
}
