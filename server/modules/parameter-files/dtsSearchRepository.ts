import type { Queryable } from "../../shared/database/client";
import type { DtsSourceLocatorDto } from "./structuralReadRepository";

export type DtsSearchBy = "path" | "address" | "label" | "compatible" | "value" | "file";

export type DtsSearchHitDto = {
  fileId: string;
  fileName: string;
  versionId: string;
  nodePath: string;
  propertyName?: string;
  snippet?: string;
  source?: DtsSourceLocatorDto;
};

export type DtsSearchResultDto = {
  hits: DtsSearchHitDto[];
};

export type DtsSearchInput = {
  organizationId: string;
  projectId: string;
  q: string;
  /** When omitted, search all dimensions. */
  by?: DtsSearchBy;
};

type HitRow = {
  file_id: string;
  file_name: string;
  version_id: string;
  node_path: string;
  property_name: string | null;
  snippet: string | null;
  start_offset: number | null;
  end_offset: number | null;
  start_line: number | null;
  start_column: number | null;
  end_line: number | null;
  end_column: number | null;
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

const NODE_LOCATOR_COLS = `
  n.start_offset as start_offset,
  n.end_offset as end_offset,
  n.start_line as start_line,
  n.start_column as start_column,
  n.end_line as end_line,
  n.end_column as end_column
`;

const PROP_LOCATOR_COLS = `
  p.start_offset as start_offset,
  p.end_offset as end_offset,
  p.start_line as start_line,
  p.start_column as start_column,
  p.end_line as end_line,
  p.end_column as end_column
`;

function mapSource(row: HitRow): DtsSourceLocatorDto | undefined {
  if (
    row.start_offset == null ||
    row.end_offset == null ||
    row.start_line == null ||
    row.start_column == null ||
    row.end_line == null ||
    row.end_column == null
  ) {
    return undefined;
  }
  return {
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    startLine: row.start_line,
    startColumn: row.start_column,
    endLine: row.end_line,
    endColumn: row.end_column,
  };
}

function mapRows(rows: HitRow[]): DtsSearchHitDto[] {
  return rows.map((row) => {
    const source = mapSource(row);
    return {
      fileId: row.file_id,
      fileName: row.file_name,
      versionId: row.version_id,
      nodePath: row.node_path,
      ...(row.property_name ? { propertyName: row.property_name } : {}),
      ...(row.snippet ? { snippet: row.snippet } : {}),
      ...(source ? { source } : {}),
    };
  });
}

function hitKey(hit: DtsSearchHitDto): string {
  return `${hit.fileId}\0${hit.versionId}\0${hit.nodePath}\0${hit.propertyName ?? ""}\0${hit.snippet ?? ""}`;
}

function mergeHits(groups: DtsSearchHitDto[][]): DtsSearchHitDto[] {
  const seen = new Set<string>();
  const out: DtsSearchHitDto[] = [];
  for (const group of groups) {
    for (const hit of group) {
      const key = hitKey(hit);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}

async function searchByPath(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
  const result = await db.query<HitRow>(
    `
    select
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      null::text as property_name,
      n.node_path as snippet,
      ${NODE_LOCATOR_COLS}
    ${FILE_SCOPE}
      and n.node_path ilike '%' || $3 || '%'
    order by f.file_name asc, n.sort_order asc, n.id asc
    `,
    scopeParams,
  );
  return mapRows(result.rows);
}

async function searchByAddress(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
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
      end as snippet,
      ${NODE_LOCATOR_COLS}
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
  return mapRows(result.rows);
}

async function searchByLabel(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
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
      ) as snippet,
      ${NODE_LOCATOR_COLS}
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
  return mapRows(result.rows);
}

async function searchByCompatible(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
  const result = await db.query<HitRow>(
    `
    select
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      null::text as property_name,
      n.compatible as snippet,
      ${NODE_LOCATOR_COLS}
    ${FILE_SCOPE}
      and n.compatible is not null
      and n.compatible ilike '%' || $3 || '%'
    order by f.file_name asc, n.sort_order asc, n.id asc
    `,
    scopeParams,
  );
  return mapRows(result.rows);
}

async function searchByValue(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
  const result = await db.query<HitRow>(
    `
    select distinct on (f.id, n.id, p.id)
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      p.name as property_name,
      p.name || '=' || p.normalized_value as snippet,
      ${PROP_LOCATOR_COLS}
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
  return mapRows(result.rows);
}

async function searchByFile(db: Queryable, scopeParams: unknown[]): Promise<DtsSearchHitDto[]> {
  const result = await db.query<HitRow>(
    `
    select
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      null::text as property_name,
      f.file_name as snippet,
      ${NODE_LOCATOR_COLS}
    ${FILE_SCOPE}
      and f.file_name ilike '%' || $3 || '%'
      and (n.parent_id is null or n.node_path = '' or n.name = '/')
    order by f.file_name asc, n.sort_order asc, n.id asc
    `,
    scopeParams,
  );
  // Prefer a single hit per matching file (root/overlay node). If none matched filter, fall back to any node.
  if (result.rows.length > 0) {
    const seen = new Set<string>();
    const filtered: HitRow[] = [];
    for (const row of result.rows) {
      if (seen.has(row.file_id)) continue;
      seen.add(row.file_id);
      filtered.push(row);
    }
    return mapRows(filtered);
  }

  const fallback = await db.query<HitRow>(
    `
    select distinct on (f.id)
      f.id as file_id,
      f.file_name as file_name,
      v.id as version_id,
      n.node_path as node_path,
      null::text as property_name,
      f.file_name as snippet,
      ${NODE_LOCATOR_COLS}
    ${FILE_SCOPE}
      and f.file_name ilike '%' || $3 || '%'
    order by f.id, n.sort_order asc, n.id asc
    `,
    scopeParams,
  );
  return mapRows(fallback.rows);
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
  const by = input.by;

  if (!by) {
    const groups = await Promise.all([
      searchByFile(db, scopeParams),
      searchByPath(db, scopeParams),
      searchByAddress(db, scopeParams),
      searchByLabel(db, scopeParams),
      searchByCompatible(db, scopeParams),
      searchByValue(db, scopeParams),
    ]);
    return { hits: mergeHits(groups) };
  }

  if (by === "path") return { hits: await searchByPath(db, scopeParams) };
  if (by === "address") return { hits: await searchByAddress(db, scopeParams) };
  if (by === "label") return { hits: await searchByLabel(db, scopeParams) };
  if (by === "compatible") return { hits: await searchByCompatible(db, scopeParams) };
  if (by === "file") return { hits: await searchByFile(db, scopeParams) };
  return { hits: await searchByValue(db, scopeParams) };
}
