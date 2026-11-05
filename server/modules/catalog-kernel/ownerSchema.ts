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

export async function readCatalogSubjectOwner(client: Client, subjectId: string): Promise<string | null> {
  if (!await catalogOwnersAvailable(client)) return null;
  const result = await client.query<{ owner_subject_id: string | null }>(
    "select owner_subject_id from parameter_catalog.catalog_subjects where id=$1", [subjectId]);
  return result.rows[0]?.owner_subject_id ?? null;
}

export async function listOwnedCatalogSubjects(client: Client, ownerId: string, activeReleaseId?: string): Promise<string[]> {
  if (!await catalogOwnersAvailable(client)) return [];
  const result = activeReleaseId
    ? await client.query<{ id: string }>(`select subject.id from parameter_catalog.catalog_subjects subject
      join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
      where subject.owner_subject_id=$1 and membership.release_id=$2 and membership.lifecycle='active' order by subject.id`, [ownerId, activeReleaseId])
    : await client.query<{ id: string }>("select id from parameter_catalog.catalog_subjects where owner_subject_id=$1 order by id", [ownerId]);
  return result.rows.map((row) => row.id);
}

/** Organization overrides never alter the published or historical Catalog owner. */
export async function organizationSubjectOwnersAvailable(client: Client): Promise<boolean> {
  const result = await client.query<{ available: boolean }>(`select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'parameter_catalog.organization_subject_registrations'::regclass
      and attname = 'owner_subject_id' and not attisdropped
  ) as available`);
  return result.rows[0]?.available === true;
}

export async function readOrganizationSubjectOwner(client: Client, organizationId: string, subjectId: string): Promise<string | null> {
  if (!await organizationSubjectOwnersAvailable(client)) return readCatalogSubjectOwner(client, subjectId);
  const result = await client.query<{ owner_subject_id: string | null }>(`
    select coalesce(registration.owner_subject_id, subject.owner_subject_id) as owner_subject_id
    from parameter_catalog.catalog_subjects subject
    left join parameter_catalog.organization_subject_registrations registration
      on registration.subject_id=subject.id and registration.organization_id=$1
    where subject.id=$2`, [organizationId, subjectId]);
  return result.rows[0]?.owner_subject_id ?? null;
}

export async function listOrganizationOwnedSubjects(client: Client, organizationId: string, ownerId: string, activeReleaseId?: string): Promise<string[]> {
  if (!await organizationSubjectOwnersAvailable(client)) return listOwnedCatalogSubjects(client, ownerId, activeReleaseId);
  const result = await client.query<{ id: string }>(`
    select subject.id from parameter_catalog.catalog_subjects subject
    left join parameter_catalog.organization_subject_registrations registration
      on registration.subject_id=subject.id and registration.organization_id=$1
    where coalesce(registration.owner_subject_id, subject.owner_subject_id)=$2
      and ($3::text is null or exists (select 1 from parameter_catalog.catalog_release_subjects membership
        where membership.subject_id=subject.id and membership.release_id=$3 and membership.lifecycle='active'))
    order by subject.id`, [organizationId, ownerId, activeReleaseId ?? null]);
  return result.rows.map(row => row.id);
}

export async function listOrganizationSubjectOwnerOverrides(client: Client, organizationId: string): Promise<Map<string, string>> {
  if (!await organizationSubjectOwnersAvailable(client)) return new Map();
  const result = await client.query<{ subject_id: string; owner_subject_id: string }>(`
    select subject_id,owner_subject_id from parameter_catalog.organization_subject_registrations
    where organization_id=$1 and owner_subject_id is not null`, [organizationId]);
  return new Map(result.rows.map(row => [row.subject_id, row.owner_subject_id]));
}
