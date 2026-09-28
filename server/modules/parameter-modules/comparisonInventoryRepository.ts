import type { Queryable } from "../../shared/database/client";

/** Full historical identities for publication comparison; discovery impact counts are page-only data. */
export async function listDismissedCompatibleIdentitiesForComparison(
  db: Queryable,
  organizationId: string,
): Promise<readonly { id: string; compatible: string }[]> {
  const result = await db.query<{ id: string; compatible: string }>(
    `select id, compatible
     from parameter_module_dismissed_compatibles
     where organization_id = $1
     order by id`,
    [organizationId],
  );
  if (!Array.isArray(result.rows)) {
    throw new Error("MOD dismissed-compatible inventory query did not return rows");
  }
  return result.rows;
}
