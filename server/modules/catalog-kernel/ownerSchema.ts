import type pg from "pg";

type Client = Pick<pg.Client, "query">;

/** Historical upgrade fixtures can read releases created before ownership existed. */
export async function catalogOwnersAvailable(client: Client): Promise<boolean> {
  const result = await client.query<{ available: boolean }>(`select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'parameter_catalog.catalog_subjects'::regclass
      and attname = 'owner_subject_id' and not attisdropped
  ) as available`);
  return result.rows[0]?.available === true;
}

export async function readCatalogSubjectOwners(client: Client, releaseId: string): Promise<Map<string, string>> {
  if (!await catalogOwnersAvailable(client)) return new Map();
  const result = await client.query<{ id: string; owner_subject_id: string }>(`
    select subject.id, subject.owner_subject_id
    from parameter_catalog.catalog_release_subjects membership
    join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
    where membership.release_id = $1 and subject.owner_subject_id is not null`, [releaseId]);
  return new Map(result.rows.map((row) => [row.id, row.owner_subject_id]));
}
