import type { Queryable } from "../../shared/database/client";
import { readRetainedDismissedCompatibleIdentities, type RetainedDismissedCompatibleIdentity } from "../catalog-kernel/interface";

/** Full historical identities for publication comparison; discovery impact counts are page-only data. */
export async function listDismissedCompatibleIdentitiesForComparison(
  db: Queryable,
  organizationId: string,
): Promise<readonly RetainedDismissedCompatibleIdentity[]> {
  return readRetainedDismissedCompatibleIdentities(db, organizationId);
}
