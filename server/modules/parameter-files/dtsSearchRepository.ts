import type { Queryable } from "../../shared/database/client";

export type DtsSearchBy = "path" | "address" | "label" | "compatible" | "value";

export type DtsSearchHitDto = {
  fileId: string;
  fileName: string;
  versionId: string;
  nodePath: string;
  propertyName?: string;
  snippet?: string;
};

export type DtsSearchResultDto = {
  hits: DtsSearchHitDto[];
};

export type DtsSearchInput = {
  organizationId: string;
  projectId: string;
  q: string;
  by: DtsSearchBy;
};

type HitRow = {
  file_id: string;
  file_name: string;
  version_id: string;
  node_path: string;
  property_name: string | null;
  snippet: string | null;
};

const FILE_SCOPE = `
  from dts_nodes n
  join project_parameter_file_versions v on v.id = n.file_version_id
  join project_parameter_files f
    on f.id = v.file_id
   and f.current_version_id = v.id
 where f.organization_id = $1
   and f.project_id = $2
`;

function mapRows(rows: HitRow[]): DtsSearchHitDto[] {
  return rows.map((row) => ({
    fileId: row.file_id,
    fileName: row.file_name,
    versionId: row.version_id,
    nodePath: row.node_path,
    ...(row.property_name ? { propertyName: row.property_name } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
  }));
}

/** Search dts_* for the project's current parameter-file versions (no re-parse). */
export async function searchDtsStructuralModel(
  db: Queryable,
  input: DtsSearchInput,
): Promise<DtsSearchResultDto> {
  const q = input.q.trim();
  if (!q) {
    return { hits: [] };
  }

  const scopeParams: unknown[] = [input.organizationId, input.projectId, q];

  if (input.by === "path") {
    const result = await db.query<HitRow>(
      `
      select
        f.id as file_id,
        f.file_name as file_name,
        v.id as version_id,
        n.node_path as node_path,
        null::text as property_name,
        n.node_path as snippet
      ${FILE_SCOPE}
        and n.node_path ilike '%' || $3 || '%'
      order by f.file_name asc, n.sort_order asc, n.id asc
      `,
      scopeParams,
    );
    return { hits: mapRows(result.rows) };
  }

  if (input.by === "address") {
    const result = await db.query<HitRow>(
      `
      select
        f.id as file_id,
        f.file_name as file_name,
        v.id as version_id,
        n.node_path as node_path,
        null::text as property_name,
        case
          when n.unit_address is not null then '@' || n.unit_address
          else n.node_path
        end as snippet
      ${FILE_SCOPE}
        and (
          n.unit_address ilike '%' || $3 || '%'
          or n.node_path ilike '%@' || $3 || '%'
          or (
            position('@' in n.node_path) > 0
            and split_part(n.node_path, '@', array_length(string_to_array(n.node_path, '@'), 1))
              ilike '%' || $3 || '%'
          )
        )
      order by f.file_name asc, n.sort_order asc, n.id asc
      `,
      scopeParams,
    );
    return { hits: mapRows(result.rows) };
  }

  if (input.by === "label") {
    const result = await db.query<HitRow>(
      `
      select
        f.id as file_id,
        f.file_name as file_name,
        v.id as version_id,
        n.node_path as node_path,
        null::text as property_name,
        (
          select string_agg(label, ', ' order by ordinality)
          from jsonb_array_elements_text(n.labels) with ordinality as t(label, ordinality)
        ) as snippet
      ${FILE_SCOPE}
        and exists (
          select 1
          from jsonb_array_elements_text(n.labels) as label
          where label ilike '%' || $3 || '%'
        )
      order by f.file_name asc, n.sort_order asc, n.id asc
      `,
      scopeParams,
    );
    return { hits: mapRows(result.rows) };
  }

  if (input.by === "compatible") {
    const result = await db.query<HitRow>(
      `
      select
        f.id as file_id,
        f.file_name as file_name,
        v.id as version_id,
        n.node_path as node_path,
        null::text as property_name,
        n.compatible as snippet
      ${FILE_SCOPE}
        and n.compatible is not null
        and n.compatible ilike '%' || $3 || '%'
      order by f.file_name asc, n.sort_order asc, n.id asc
      `,
      scopeParams,
    );
    return { hits: mapRows(result.rows) };
  }

  // by === "value"
  const result = await db.query<HitRow>(
    `
    select distinct on (f.id, n.id, p.id)
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      p.name as property_name,
      p.name || '=' || p.normalized_value as snippet
    from dts_properties p
    join dts_nodes n on n.id = p.node_id
    join project_parameter_file_versions v on v.id = n.file_version_id
    join project_parameter_files f
      on f.id = v.file_id
     and f.current_version_id = v.id
   where f.organization_id = $1
     and f.project_id = $2
     and (
       p.normalized_value ilike '%' || $3 || '%'
       or p.name ilike '%' || $3 || '%'
     )
   order by f.id, n.id, p.id, f.file_name asc, n.sort_order asc, p.sort_order asc
    `,
    scopeParams,
  );
  return { hits: mapRows(result.rows) };
}
