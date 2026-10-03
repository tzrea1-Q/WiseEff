import type { Queryable } from "../../../shared/database/client";

export type RetainedDismissedCompatibleIdentity = {
  readonly organizationId: string;
  readonly id: string;
  readonly compatible: string;
};

/** Complete retained identities; the database capability authorizes the explicit organization. */
export async function readRetainedDismissedCompatibleIdentities(
  database: Queryable,
  organizationId: string,
): Promise<readonly RetainedDismissedCompatibleIdentity[]> {
  if (!organizationId.trim()) throw new Error("A nonempty organization ID is required");
  const result = await database.query<{ organization_id: string; id: string; compatible: string }>(
    'select organization_id, id, compatible from parameter_catalog.list_retained_dismissed_compatible_identities($1) order by id collate "C"',
    [organizationId],
  );
  if (!Array.isArray(result.rows)) throw new Error("Historical identity query did not return rows");
  let previousId: string | undefined;
  return result.rows.map((row) => {
    if (!row || row.organization_id !== organizationId || typeof row.id !== "string" || !row.id
      || typeof row.compatible !== "string"
      || (previousId !== undefined && Buffer.compare(Buffer.from(previousId), Buffer.from(row.id)) >= 0)) {
      throw new Error("Invalid, duplicate, unordered or cross-organization historical identity");
    }
    previousId = row.id;
    return { organizationId: row.organization_id, id: row.id, compatible: row.compatible };
  });
}
