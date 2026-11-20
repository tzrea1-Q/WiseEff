import type pg from "pg";

type Client = Pick<pg.Client, "query">;

/** Legacy migrations and fixtures have no membership snapshot for ownership. */
export const publishedSubjectOwner = (membership: string, subject: string) =>
  `case when to_jsonb(${membership})->>'rules_snapshot' is null then ${subject}.owner_subject_id
    else to_jsonb(${membership})->'rules_snapshot'->>'ownerSubjectId' end`;

export const currentPublishedSubjectOwner = (subject: string) =>
  `(select ${publishedSubjectOwner("ownership", subject)}
      from parameter_catalog.catalog_state state
      left join parameter_catalog.catalog_release_subjects ownership
        on ownership.release_id=state.current_catalog_release_id and ownership.subject_id=${subject}.id)`;

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
  // Offline capture has column grants. A whole-row JSON conversion would
  // require read access to unrelated membership columns.
  const versioned = await client.query<{ available: boolean }>(`select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'parameter_catalog.catalog_release_subjects'::regclass
      and attname = 'rules_snapshot' and not attisdropped
  ) as available`);
  const owner = versioned.rows[0]?.available
    ? "case when membership.rules_snapshot is null then subject.owner_subject_id else membership.rules_snapshot->>'ownerSubjectId' end"
    : "subject.owner_subject_id";
  const result = await client.query<{ id: string; owner_subject_id: string }>(`
    select subject.id, ${owner} as owner_subject_id
    from parameter_catalog.catalog_release_subjects membership
    join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
    where membership.release_id = $1 and (${owner}) is not null`, [releaseId]);
  return new Map(result.rows.map((row) => [row.id, row.owner_subject_id]));
}

export async function readCatalogSubjectOwner(client: Client, subjectId: string): Promise<string | null> {
  if (!await catalogOwnersAvailable(client)) return null;
  const result = await client.query<{ owner_subject_id: string | null }>(
    `select ${publishedSubjectOwner("membership", "subject")} as owner_subject_id
    from parameter_catalog.catalog_subjects subject
    left join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
      and membership.release_id=(select current_catalog_release_id from parameter_catalog.catalog_state)
    where subject.id=$1`, [subjectId]);
  return result.rows[0]?.owner_subject_id ?? null;
}

export async function listOwnedCatalogSubjects(client: Client, ownerId: string, activeReleaseId?: string): Promise<string[]> {
  if (!await catalogOwnersAvailable(client)) return [];
  const result = activeReleaseId
    ? await client.query<{ id: string }>(`select subject.id from parameter_catalog.catalog_subjects subject
      join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
      where (${publishedSubjectOwner("membership", "subject")})=$1 and membership.release_id=$2 and membership.lifecycle='active' order by subject.id`, [ownerId, activeReleaseId])
    : await client.query<{ id: string }>(`select subject.id from parameter_catalog.catalog_subjects subject
      left join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
        and membership.release_id=(select current_catalog_release_id from parameter_catalog.catalog_state)
      where (${publishedSubjectOwner("membership", "subject")})=$1 order by subject.id`, [ownerId]);
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
    select coalesce(registration.owner_subject_id, ${publishedSubjectOwner("membership", "subject")}) as owner_subject_id
    from parameter_catalog.catalog_subjects subject
    left join parameter_catalog.organization_subject_registrations registration
      on registration.subject_id=subject.id and registration.organization_id=$1
    left join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
      and membership.release_id=(select current_catalog_release_id from parameter_catalog.catalog_state)
    where subject.id=$2`, [organizationId, subjectId]);
  return result.rows[0]?.owner_subject_id ?? null;
}

export async function listOrganizationOwnedSubjects(client: Client, organizationId: string, ownerId: string, activeReleaseId?: string): Promise<string[]> {
  if (!await organizationSubjectOwnersAvailable(client)) return listOwnedCatalogSubjects(client, ownerId, activeReleaseId);
  const result = await client.query<{ id: string }>(`
    select subject.id from parameter_catalog.catalog_subjects subject
    left join parameter_catalog.organization_subject_registrations registration
      on registration.subject_id=subject.id and registration.organization_id=$1
    left join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
      and membership.release_id=coalesce($3::text,(select current_catalog_release_id from parameter_catalog.catalog_state))
    where coalesce(registration.owner_subject_id, ${publishedSubjectOwner("membership", "subject")})=$2
      and ($3::text is null or membership.lifecycle='active')
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
