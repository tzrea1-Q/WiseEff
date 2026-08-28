import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import type { KnowledgeEntryDto, KnowledgeParameterReferenceDto, KnowledgeSearchResultDto } from "./types";

/**
 * Repository slice for structural parameter-to-knowledge references
 * (design deferred roadmap item 2). References bind to `parameter_specs.id`,
 * the stable surrogate key (ADR-0017): identity corrections rewrite the
 * definition's attribution/property key in place and never move the id, and
 * deprecation (ADR-0011) is soft retirement, so reference rows survive both.
 */

type ReferenceRow = {
  entry_id: string;
  parameter_spec_id: string;
  created_by_user_id: string | null;
  created_at: string | Date;
  property_key: string | null;
  display_name: string | null;
  driver_module: string | null;
  lifecycle: "draft" | "active" | "deprecated";
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Shared projection of the definition columns a reference chip needs.
 * Mirrors the spec read API: property key falls back through
 * `dts_property_specs` and the trailing `specification_key` segment, the
 * module label is the attribution subject's display name (ADR-0013), and the
 * display name comes from the preferred (active first) version row.
 */
const REFERENCE_SPEC_PROJECTION = `
  coalesce(
    ps.property_key,
    dps.property_key,
    nullif(
      (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
      ''
    )
  ) as property_key,
  psv.display_name,
  asub.display_name as driver_module,
  ps.definition_lifecycle as lifecycle
`;

const REFERENCE_SPEC_JOINS = `
  left join attribution_subjects asub on asub.id = ps.attribution_subject_id
  left join lateral (
    select display_name
    from parameter_spec_versions
    where parameter_spec_id = ps.id
    order by
      case version_status
        when 'active' then 0
        when 'superseded' then 1
        else 2
      end,
      version desc
    limit 1
  ) psv on true
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
`;

function toReferenceDto(row: ReferenceRow): KnowledgeParameterReferenceDto {
  return {
    specId: row.parameter_spec_id,
    propertyKey: row.property_key ?? row.parameter_spec_id,
    displayName: row.display_name,
    driverModule: row.driver_module,
    lifecycle: row.lifecycle,
    createdByUserId: row.created_by_user_id,
    createdAt: dateTimeToIso(row.created_at)
  };
}

export async function loadParameterReferencesByEntryIds(
  db: Queryable,
  auth: AuthContext,
  entryIds: readonly string[]
): Promise<Map<string, KnowledgeParameterReferenceDto[]>> {
  if (entryIds.length === 0) {
    return new Map();
  }
  const result = await db.query<ReferenceRow>(
    `
    select
      r.entry_id,
      r.parameter_spec_id,
      r.created_by_user_id,
      r.created_at,
      ${REFERENCE_SPEC_PROJECTION}
    from knowledge_parameter_references r
    join parameter_specs ps on ps.id = r.parameter_spec_id
    ${REFERENCE_SPEC_JOINS}
    where r.organization_id = $1
      and r.entry_id = any($2::uuid[])
    order by r.created_at asc, r.parameter_spec_id asc
    `,
    [auth.organization.id, entryIds]
  );

  const map = new Map<string, KnowledgeParameterReferenceDto[]>();
  for (const row of result.rows) {
    const references = map.get(row.entry_id) ?? [];
    references.push(toReferenceDto(row));
    map.set(row.entry_id, references);
  }
  return map;
}

export type ReferenceableSpec = {
  specId: string;
  propertyKey: string;
  displayName: string | null;
  driverModule: string | null;
  lifecycle: "draft" | "active" | "deprecated";
};

/**
 * Resolves a definition the caller's organization may reference: org-owned or
 * platform-global — the same visibility rule as the spec detail API. Returns
 * null (→ 404) for unknown specs and other tenants' rows alike.
 */
export async function resolveReferenceableSpec(
  db: Queryable,
  organizationId: string,
  specId: string
): Promise<ReferenceableSpec | null> {
  const result = await db.query<Omit<ReferenceRow, "entry_id" | "created_by_user_id" | "created_at"> & { id: string }>(
    `
    select
      ps.id,
      ${REFERENCE_SPEC_PROJECTION}
    from parameter_specs ps
    ${REFERENCE_SPEC_JOINS}
    where ps.id = $2
      and (ps.organization_id = $1 or ps.organization_id is null)
    limit 1
    `,
    [organizationId, specId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    specId: row.id,
    propertyKey: row.property_key ?? row.id,
    displayName: row.display_name,
    driverModule: row.driver_module,
    lifecycle: row.lifecycle
  };
}

/** Idempotent add: returns false when the (entry, spec) pair already exists. */
export async function insertParameterReference(
  db: Queryable,
  auth: AuthContext,
  input: { id: string; entryId: string; specId: string }
): Promise<boolean> {
  const result = await db.query(
    `
    insert into knowledge_parameter_references (id, organization_id, entry_id, parameter_spec_id, created_by_user_id)
    values ($1, $2, $3, $4, $5)
    on conflict (entry_id, parameter_spec_id) do nothing
    `,
    [input.id, auth.organization.id, input.entryId, input.specId, auth.user.id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteParameterReference(
  db: Queryable,
  auth: AuthContext,
  input: { entryId: string; specId: string }
): Promise<boolean> {
  const result = await db.query(
    `
    delete from knowledge_parameter_references
    where organization_id = $1
      and entry_id = $2
      and parameter_spec_id = $3
    `,
    [auth.organization.id, input.entryId, input.specId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Reference count for the entry-delete audit metadata. */
export async function countParameterReferencesForEntry(
  db: Queryable,
  auth: AuthContext,
  entryId: string
): Promise<number> {
  const result = await db.query<{ reference_count: string | number }>(
    `
    select count(*)::int as reference_count
    from knowledge_parameter_references
    where organization_id = $1
      and entry_id = $2
    `,
    [auth.organization.id, entryId]
  );
  return Number(result.rows[0]?.reference_count ?? 0);
}

type ReferencingEntryRow = {
  id: string;
  title: string;
  content_form: KnowledgeEntryDto["contentForm"];
  tags: string[];
  search_text: string;
  head_revision_id: string | null;
  updated_at: string | Date;
};

function buildLeadExcerpt(searchText: string) {
  const normalized = searchText.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized;
}

/**
 * Parameter-side read: published entries referencing one definition
 * (published-only invariant — drafts and archived entries never appear here
 * regardless of who looks), organization-scoped.
 */
export async function listPublishedEntriesReferencingSpec(
  db: Queryable,
  auth: AuthContext,
  input: { specId: string; limit?: number }
): Promise<KnowledgeSearchResultDto[]> {
  const result = await db.query<ReferencingEntryRow>(
    `
    select e.id, e.title, e.content_form, e.tags, e.search_text, e.head_revision_id, e.updated_at
    from knowledge_parameter_references r
    join knowledge_entries e
      on e.id = r.entry_id
     and e.organization_id = r.organization_id
    where r.organization_id = $1
      and r.parameter_spec_id = $2
      and e.status = 'published'
    order by e.updated_at desc, e.id desc
    limit $3
    `,
    [auth.organization.id, input.specId, input.limit ?? 20]
  );

  return result.rows.map((row) => ({
    entryId: row.id,
    title: row.title,
    contentForm: row.content_form,
    tags: row.tags ?? [],
    excerpt: buildLeadExcerpt(row.search_text),
    updatedAt: dateTimeToIso(row.updated_at),
    revisionId: row.head_revision_id
  }));
}
