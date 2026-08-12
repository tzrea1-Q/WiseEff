/**
 * File↔UI sync conflict repository for `parameter_file_sync_conflicts`:
 * conflict detection reads, insertion, enrichment listing, and resolution.
 */

import type { Queryable } from "../../shared/database/client";
import { parameterIdentityMode } from "./parameterIdentityMode";
import { addCondition, dateTimeToIso } from "./repositoryShared";

type FileSyncConflictSourceLocator = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

type FileSyncConflictRow = {
  id: string;
  organization_id: string;
  project_id: string;
  project_parameter_value_id?: string | null;
  parameter_definition_id?: string | null;
  project_parameter_binding_id?: string | null;
  parameter_spec_id?: string | null;
  file_version_id: string;
  file_draft_id: string;
  ui_draft_id: string;
  file_value: string;
  ui_draft_value: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolved_by_user_id: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
  base_value?: string | null;
  parameter_name?: string | null;
  parameter_module?: string | null;
  file_version_number?: number | string | null;
  file_version_created_at?: string | Date | null;
  file_draft_updated_at?: string | Date | null;
  ui_draft_updated_at?: string | Date | null;
  file_id?: string | null;
  file_name?: string | null;
  config_set_id?: string | null;
  source_node_path?: string | null;
  source_start_offset?: number | null;
  source_end_offset?: number | null;
  source_start_line?: number | null;
  source_start_column?: number | null;
  source_end_line?: number | null;
  source_end_column?: number | null;
};

export type FileSyncConflictRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  fileVersionId: string;
  fileDraftId: string;
  uiDraftId: string;
  fileValue: string;
  uiDraftValue: string;
  status: "open" | "resolved_file" | "resolved_ui";
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
  baseValue?: string;
  parameterName?: string;
  parameterModule?: string;
  fileVersionNumber?: number;
  fileVersionLabel?: string;
  fileVersionCreatedAt?: string;
  fileDraftUpdatedAt?: string;
  uiDraftUpdatedAt?: string;
  fileId?: string;
  fileName?: string;
  configSetId?: string;
  nodePath?: string;
  propertyName?: string;
  sourceNodePath?: string;
  source?: FileSyncConflictSourceLocator;
};

function splitSourceNodePath(sourceNodePath: string | null | undefined): {
  nodePath?: string;
  propertyName?: string;
} {
  if (!sourceNodePath) {
    return {};
  }
  const separator = sourceNodePath.lastIndexOf("/");
  if (separator <= 0 || separator === sourceNodePath.length - 1) {
    return { nodePath: sourceNodePath };
  }
  return {
    nodePath: sourceNodePath.slice(0, separator),
    propertyName: sourceNodePath.slice(separator + 1)
  };
}

function toFileSyncConflictSource(
  row: FileSyncConflictRow
): FileSyncConflictSourceLocator | undefined {
  if (
    row.source_start_offset == null ||
    row.source_end_offset == null ||
    row.source_start_line == null ||
    row.source_start_column == null ||
    row.source_end_line == null ||
    row.source_end_column == null
  ) {
    return undefined;
  }
  return {
    startOffset: Number(row.source_start_offset),
    endOffset: Number(row.source_end_offset),
    startLine: Number(row.source_start_line),
    startColumn: Number(row.source_start_column),
    endLine: Number(row.source_end_line),
    endColumn: Number(row.source_end_column)
  };
}

function toFileSyncConflictRecord(row: FileSyncConflictRow): FileSyncConflictRecord {
  const sourceNodePath = row.source_node_path ?? undefined;
  const { nodePath, propertyName } = splitSourceNodePath(sourceNodePath);
  const fileVersionNumber =
    row.file_version_number == null || row.file_version_number === ""
      ? undefined
      : Number(row.file_version_number);
  const source = toFileSyncConflictSource(row);
  const bindingId = row.project_parameter_binding_id ?? row.project_parameter_value_id ?? "";
  const specId = row.parameter_spec_id ?? row.parameter_definition_id ?? "";

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    // Post-cutover DTO compatibility: binding/spec ids occupy the legacy field names.
    projectParameterValueId: bindingId,
    parameterDefinitionId: specId,
    fileVersionId: row.file_version_id,
    fileDraftId: row.file_draft_id,
    uiDraftId: row.ui_draft_id,
    fileValue: row.file_value,
    uiDraftValue: row.ui_draft_value,
    status: row.status,
    resolvedByUserId: row.resolved_by_user_id ?? undefined,
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
    createdAt: dateTimeToIso(row.created_at),
    baseValue: row.base_value ?? undefined,
    parameterName: row.parameter_name ?? undefined,
    parameterModule: row.parameter_module ?? undefined,
    fileVersionNumber: Number.isFinite(fileVersionNumber) ? fileVersionNumber : undefined,
    fileVersionLabel:
      Number.isFinite(fileVersionNumber) && fileVersionNumber != null
        ? `v${fileVersionNumber}`
        : undefined,
    fileVersionCreatedAt: row.file_version_created_at
      ? dateTimeToIso(row.file_version_created_at)
      : undefined,
    fileDraftUpdatedAt: row.file_draft_updated_at
      ? dateTimeToIso(row.file_draft_updated_at)
      : undefined,
    uiDraftUpdatedAt: row.ui_draft_updated_at ? dateTimeToIso(row.ui_draft_updated_at) : undefined,
    fileId: row.file_id ?? undefined,
    fileName: row.file_name ?? undefined,
    configSetId: row.config_set_id ?? undefined,
    nodePath,
    propertyName,
    sourceNodePath,
    source
  };
}

export async function hasOpenFileSyncConflict(
  db: Queryable,
  query: { projectParameterValueId: string }
) {
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<{ id: string }>(
      `
      select id
      from parameter_file_sync_conflicts
      where project_parameter_binding_id = $1
        and status = 'open'
      limit 1
      `,
      [query.projectParameterValueId]
    );
    return result.rows.length > 0;
  }

  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_file_sync_conflicts
    where project_parameter_value_id = $1
      and status = 'open'
    limit 1
    `,
    [query.projectParameterValueId]
  );

  return result.rows.length > 0;
}

export async function insertFileSyncConflict(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    projectParameterValueId: string;
    parameterDefinitionId: string;
    fileVersionId: string;
    fileDraftId: string;
    uiDraftId: string;
    fileValue: string;
    uiDraftValue: string;
    parameterSpecId?: string;
    projectParameterBindingId?: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    insert into parameter_file_sync_conflicts (
      id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
      file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status,
      parameter_spec_id, project_parameter_binding_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.projectParameterValueId,
      input.parameterDefinitionId,
      input.fileVersionId,
      input.fileDraftId,
      input.uiDraftId,
      input.fileValue,
      input.uiDraftValue,
      input.parameterSpecId ?? null,
      input.projectParameterBindingId ?? null
    ]
  );

  return toFileSyncConflictRecord(result.rows[0]);
}

/**
 * Enrichment for file↔UI sync conflicts.
 * Prefer post-cutover binding/spec joins; fall back to legacy PPV/definition columns
 * so pre-cutover conflict rows still surface baseValue and parameterName.
 */
const FILE_SYNC_CONFLICT_SELECT = `
    select
      c.*,
      coalesce(c.project_parameter_binding_id, '') as project_parameter_value_id,
      coalesce(c.parameter_spec_id, b.parameter_spec_id, '') as parameter_definition_id,
      coalesce(bpr.raw_value, ppv.current_value, '') as base_value,
      case
        when lnr.node_locator is null then coalesce(dps.property_key, pd.name)
        when lnr.node_locator like '/%'
          then ltrim(lnr.node_locator, '/') || '/' || coalesce(dps.property_key, pd.name)
        else lnr.node_locator || '/' || coalesce(dps.property_key, pd.name)
      end as source_node_path,
      coalesce(
        dps.property_key,
        nullif(split_part(ps.specification_key, '/', 2), ''),
        ps.specification_key,
        pd.name
      ) as parameter_name,
      coalesce(
        nullif(trim(binding_pm.name), ''),
        nullif(split_part(ps.specification_key, '/', 1), ''),
        pd.module,
        ''
      ) as parameter_module,
      fv.version_number as file_version_number,
      fv.created_at as file_version_created_at,
      fd.updated_at as file_draft_updated_at,
      ud.updated_at as ui_draft_updated_at,
      pf.id as file_id,
      pf.file_name as file_name,
      pf.config_set_id as config_set_id,
      src.source_start_offset,
      src.source_end_offset,
      src.source_start_line,
      src.source_start_column,
      src.source_end_line,
      src.source_end_column
    from parameter_file_sync_conflicts c
    left join project_parameter_bindings b
      on b.id = coalesce(c.project_parameter_binding_id, c.project_parameter_value_id)
    left join project_parameter_values ppv on ppv.id = c.project_parameter_value_id
    left join parameter_definitions pd on pd.id = c.parameter_definition_id
    left join parameter_specs ps on ps.id = coalesce(c.parameter_spec_id, b.parameter_spec_id)
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join parameter_modules binding_pm on binding_pm.id = b.module_id
    left join lateral (
      select bpr.raw_value
      from project_parameter_binding_revisions bpr
      where bpr.binding_id = b.id
      order by bpr.created_at desc
      limit 1
    ) bpr on true
    left join lateral (
      select lnr.node_locator
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = b.logical_node_id
      order by lnr.config_revision_id desc
      limit 1
    ) lnr on true
    left join project_parameter_file_versions fv on fv.id = c.file_version_id
    left join project_parameter_files pf on pf.id = fv.file_id
    left join parameter_drafts fd on fd.id = c.file_draft_id
    left join parameter_drafts ud on ud.id = c.ui_draft_id
    left join lateral (
      select
        po.start_offset as source_start_offset,
        po.end_offset as source_end_offset,
        po.start_line as source_start_line,
        po.start_column as source_start_column,
        po.end_line as source_end_line,
        po.end_column as source_end_column
      from dts_property_occurrences po
      inner join dts_occurrence_effects oe
        on oe.property_occurrence_id = po.id
      inner join dts_logical_node_revisions occ_lnr
        on occ_lnr.id = oe.logical_node_revision_id
      where po.file_version_id = c.file_version_id
        and occ_lnr.logical_node_id = b.logical_node_id
        and (
          oe.property_name = dps.property_key
          or (dps.property_key is null and oe.property_name is not null)
        )
      order by oe.source_order desc
      limit 1
    ) src on true
`;

export async function listOpenConflicts(
  db: Queryable,
  query: { organizationId: string; projectParameterValueId?: string; projectId?: string; conflictId?: string }
) {
  const values: unknown[] = [query.organizationId];
  const where = ["c.organization_id = $1", "c.status = 'open'"];
  if (query.projectParameterValueId) {
    // Callers still pass the binding id under the legacy parameter name after cutover.
    addCondition(
      where,
      values,
      (placeholder) => `c.project_parameter_binding_id = ${placeholder}`,
      query.projectParameterValueId
    );
  }
  if (query.projectId) {
    addCondition(where, values, (placeholder) => `c.project_id = ${placeholder}`, query.projectId);
  }
  if (query.conflictId) {
    addCondition(where, values, (placeholder) => `c.id = ${placeholder}`, query.conflictId);
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    ${FILE_SYNC_CONFLICT_SELECT}
    where ${where.join("\n      and ")}
    order by c.created_at desc, c.id desc
    `,
    values
  );

  return result.rows.map(toFileSyncConflictRecord);
}

/**
 * Lookup conflicts by id without requiring open status (used for bulk ineligibility reasons).
 * Enrichment joins are included so ineligible rows can still surface names/file ids when present.
 */
export async function listFileSyncConflictsByIds(
  db: Queryable,
  query: { organizationId: string; conflictIds: string[] }
) {
  if (query.conflictIds.length === 0) {
    return [];
  }

  const result = await db.query<FileSyncConflictRow>(
    `
    ${FILE_SYNC_CONFLICT_SELECT}
    where c.organization_id = $1
      and c.id = any($2::text[])
    `,
    [query.organizationId, query.conflictIds]
  );

  return result.rows.map(toFileSyncConflictRecord);
}

export async function resolveConflict(
  db: Queryable,
  input: {
    organizationId: string;
    conflictId: string;
    status: "resolved_file" | "resolved_ui";
    resolvedByUserId: string;
  }
) {
  const result = await db.query<FileSyncConflictRow>(
    `
    update parameter_file_sync_conflicts
    set status = $3,
      resolved_by_user_id = $4,
      resolved_at = now()
    where organization_id = $1
      and id = $2
      and status = 'open'
    returning *
    `,
    [input.organizationId, input.conflictId, input.status, input.resolvedByUserId]
  );

  const row = result.rows[0];
  return row ? toFileSyncConflictRecord(row) : null;
}
