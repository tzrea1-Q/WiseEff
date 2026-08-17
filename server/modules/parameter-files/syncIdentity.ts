import type { Queryable } from "../../shared/database/client";

export type FileSyncBindingMatch = {
  id: string;
  parameterSpecId: string;
  currentValue: string;
};

export type FindBindingBySourceQuery = {
  organizationId: string;
  projectId: string;
  sourceFileName: string;
  sourceNodePath: string;
  fileVersionId?: string;
};

/** Parsed-index paths and locators compare without a leading or trailing slash. */
export function normalizeFileSyncNodePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

/**
 * Resolve a parsed-index path to a project parameter binding using this file
 * version's occurrence graph (logical node locator + property key).
 * Must not query retired `project_parameter_values` / `parameter_definitions`.
 */
export async function findBindingBySource(
  db: Queryable,
  query: FindBindingBySourceQuery
): Promise<FileSyncBindingMatch | null> {
  const sourceNodePath = normalizeFileSyncNodePath(query.sourceNodePath);
  const result = await db.query<{
    id: string;
    parameter_spec_id: string;
    current_value: string | null;
  }>(
    `
    select
      b.id,
      b.parameter_spec_id,
      coalesce(bpr.raw_value, '') as current_value
    from project_parameter_files ppf
    inner join project_parameter_file_versions pfv on pfv.file_id = ppf.id
    inner join dts_property_occurrences po on po.file_version_id = pfv.id
    inner join dts_occurrence_effects oe on oe.property_occurrence_id = po.id
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    inner join dts_logical_nodes ln on ln.id = lnr.logical_node_id
    inner join project_parameter_bindings b
      on b.logical_node_id = ln.id
      and b.organization_id = ppf.organization_id
      and b.project_id = ppf.project_id
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join lateral (
      select bpr.raw_value
      from project_parameter_binding_revisions bpr
      where bpr.binding_id = b.id
      order by bpr.created_at desc
      limit 1
    ) bpr on true
    where ppf.organization_id = $1
      and ppf.project_id = $2
      and ppf.file_name = $3
      and ($5::text is null or pfv.id = $5)
      and oe.property_name = coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))
      and trim(both '/' from (
            trim(both '/' from coalesce(lnr.node_locator, ''))
            || '/'
            || coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), '')
          )) = $4
    limit 1
    `,
    [
      query.organizationId,
      query.projectId,
      query.sourceFileName,
      sourceNodePath,
      query.fileVersionId ?? null
    ]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    parameterSpecId: row.parameter_spec_id,
    currentValue: row.current_value ?? ""
  };
}
