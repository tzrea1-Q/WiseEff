import type { Queryable } from "../../../shared/database/client";
import type { PublicationAuthorizationResult } from "../authorization/types";

export type PublicationFreezeRecord = {
  readonly frozen: boolean;
  readonly updatedAt: string;
  readonly updatedByPrincipalId: string;
};

const fail = (
  reason: "publication-frozen" | "publication-not-authorized",
  detail?: string,
): PublicationAuthorizationResult<never> => ({
  ok: false,
  error: detail ? { reason, detail } : { reason },
});

export const readPublicationFreeze = async (
  db: Queryable,
): Promise<PublicationFreezeRecord | null> => {
  const result = await db.query<{
    frozen: boolean;
    updated_at: Date | string;
    updated_by_principal_id: string;
  }>(
    `select frozen, updated_at, updated_by_principal_id
       from catalog_publication.publication_freeze
      where singleton`,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    frozen: row.frozen,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    updatedByPrincipalId: row.updated_by_principal_id,
  };
};

export const isPublicationFrozen = async (db: Queryable): Promise<boolean> => {
  const freeze = await readPublicationFreeze(db);
  return freeze?.frozen === true;
};

export const setPublicationFreeze = async (
  db: Queryable,
  input: { readonly frozen: boolean; readonly actorPrincipalId: string },
): Promise<PublicationAuthorizationResult<PublicationFreezeRecord>> => {
  if (
    input.actorPrincipalId.trim().length === 0 ||
    input.actorPrincipalId.trim() !== input.actorPrincipalId
  ) {
    return fail("publication-not-authorized", "freeze requires a real actor principal");
  }
  try {
    await db.query(`select catalog_publication.set_publication_freeze($1, $2)`, [
      input.frozen,
      input.actorPrincipalId,
    ]);
  } catch (error) {
    const mapped = error as { code?: string; message?: string };
    if (mapped.code === "42501") {
      return fail(
        "publication-not-authorized",
        mapped.message ?? "set_publication_freeze execute denied",
      );
    }
    throw error;
  }
  const freeze = await readPublicationFreeze(db);
  if (!freeze) {
    return fail("publication-not-authorized", "publication freeze singleton is missing");
  }
  return { ok: true, value: freeze };
};
