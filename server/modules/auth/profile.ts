import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { getAuthContext } from "./repository";
import type { UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";

export type UpdateCurrentUserProfileInput = { name?: string; title?: string };

export async function updateCurrentUserProfile(db: Database, invocation: UserInvocationContext, input: UpdateCurrentUserProfileInput, context: { requestId: string }) {
  requireUserInitiatedInvocation(invocation);
  const auth = invocation.principal;
  const name = input.name?.trim(), title = input.title?.trim();
  if (name === "" || title === "") throw new ApiError("VALIDATION_FAILED", "Profile fields cannot be blank.");
  if (!auth.user.isActive) throw new ApiError("FORBIDDEN", "Inactive users cannot update their profile.");
  return db.transaction(async (tx) => {
    const updated = await tx.query(`
      update users set name = coalesce($3, name), title = coalesce($4, title)
      where organization_id = $1 and id = $2 and is_active = true
    `, [auth.organization.id, auth.user.id, name, title]);
    if (updated.rowCount !== 1) throw new ApiError("FORBIDDEN", "Active user in the current organization was not found.");
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, {
      app: "auth", kind: "auth-event", action: "update-profile", severity: "Medium", projectId: null,
      targetType: "user", targetId: auth.user.id,
      metadata: { fields: Object.keys(input).filter((field) => field === "name" || field === "title") }
    });
    return getAuthContext(tx, auth.user.id);
  });
}
