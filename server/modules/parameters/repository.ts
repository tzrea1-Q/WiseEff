import type { Queryable } from "../../shared/database/client";
import type {
  ParameterHistoryEntryDto,
  ParameterRecordDto
} from "./types";
import {
  buildParameterModuleSubtreeFilter
} from "./parameterModuleRepository";

export {
  buildParameterModuleSubtreeFilter,
  countParameterModuleChildren,
  countParametersForModule,
  createParameterModule,
  deleteParameterModule,
  getParameterModuleById,
  getParameterModuleByName,
  listParameterModules,
  moveParameterModule,
  resolveParameterModulePathNames,
  updateParameterModule
} from "./parameterModuleRepository";
import { type ParameterRiskLevel } from "./status";
import { LEGACY_SQL } from "../parameter-topology/migration";
import { listSemanticParameters } from "./semanticParameterReads";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "../parameter-kernel/legacyParameterIdentityNames";
import { addCondition, dateTimeToIso } from "../../shared/database/sqlUtil";
import { resolveParameterValueKind } from "./repositoryShared";

type ParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  value_kind?: string | null;
  module: string;
  parameter_module_id?: string | null;
  module_path?: string | null;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  initSuggestionText: string;
  source_file_name?: string | null;
  source_node_path?: string | null;
  updated_at: string | Date;
};

export type ProjectParameterForUpdate = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  currentValue: string;
  recommendedValue: string;
  valueVersion: number;
  sourceFileName?: string;
  sourceNodePath?: string;
};

export type ProjectParameterValueMatch = {
  id: string;
  projectId: string;
  parameterDefinitionId: string;
  name: string;
  module: string;
  currentValue: string;
};

type ProjectParameterForUpdateRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  initSuggestionText: string;
  value_version: number | string;
  source_file_name?: string | null;
  source_node_path?: string | null;
};

type ProjectParameterValueMatchRow = {
  id: string;
  project_id: string;
  parameter_definition_id: string;
  name: string;
  module: string;
  current_value: string;
};

type ParameterHistoryRow = {
  version: number | string;
  value: string;
  changed_at: string | Date;
  changed_by: string | null;
  request_id: string | null;
  initiator_type?: "user" | "agent" | "system" | null;
  initiator_system_kind?: "service" | "job" | null;
  initiator_system_name?: string | null;
  initiator_session_id?: string | null;
  initiator_tool_call_id?: string | null;
  initiator_approval_id?: string | null;
};

export type ListParametersQuery = {
  organizationId: string;
  projectId?: string;
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: ParameterRiskLevel | ParameterRiskLevel[];
  q?: string;
  limit?: number;
};

function parseModulePathNames(modulePath: string | null | undefined): string[] | undefined {
  if (!modulePath) {
    return undefined;
  }
  const trimmed = modulePath.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.split("/").filter(Boolean);
}

function normalizeParameterRisk(risk: string | null | undefined): ParameterRiskLevel {
  if (risk === "High" || risk === "Medium" || risk === "Low") return risk;
  return "Low";
}

function toParameterDto(row: ParameterRow, history: ParameterHistoryEntryDto[] = []): ParameterRecordDto {
  const updatedAt = dateTimeToIso(row.updated_at);
  const modulePath = parseModulePathNames(row.module_path);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    valueKind: resolveParameterValueKind(row),
    module: row.module,
    moduleId: row.parameter_module_id ?? undefined,
    modulePath,
    projectId: row.project_id,
    currentValue: row.current_value,
    recommendedValue: row.initSuggestionText,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    sourceFileName: row.source_file_name ?? undefined,
    sourceNodePath: row.source_node_path ?? undefined,
    updatedAt,
    updatedAtTs: updatedAt,
    history
  };
}

function toHistoryDto(row: ParameterHistoryRow): ParameterHistoryEntryDto {
  const changedBy = row.initiator_type === "system"
    ? `System ${row.initiator_system_kind ?? "service"}:${row.initiator_system_name ?? "unknown"}`
    : row.initiator_type === "agent"
      ? `Agent ${row.changed_by ?? "principal"} (tool:${row.initiator_tool_call_id ?? "unknown"}, session:${row.initiator_session_id ?? "unknown"})`
      : row.changed_by ?? "";
  return {
    version: String(row.version),
    value: row.value,
    changedAt: dateTimeToIso(row.changed_at),
    changedBy,
    requestId: row.request_id ?? undefined
  };
}

function toProjectParameterForUpdate(row: ProjectParameterForUpdateRow): ProjectParameterForUpdate {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    unit: row.unit,
    risk: row.risk,
    currentValue: row.current_value,
    recommendedValue: row.initSuggestionText,
    valueVersion: Number(row.value_version),
    sourceFileName: row.source_file_name ?? undefined,
    sourceNodePath: row.source_node_path ?? undefined
  };
}

function toProjectParameterValueMatch(row: ProjectParameterValueMatchRow): ProjectParameterValueMatch {
  return {
    id: row.id,
    projectId: row.project_id,
    parameterDefinitionId: row.parameter_definition_id,
    name: row.name,
    module: row.module,
    currentValue: row.current_value
  };
}

export async function listParameters(db: Queryable, query: ListParametersQuery) {
  if (parameterIdentityMode() === "semantic") {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const rows = await listSemanticParameters(db, {
      organizationId: query.organizationId,
      projectId: query.projectId,
      module: query.module,
      moduleId: query.moduleId,
      includeDescendants: query.includeDescendants,
      q: query.q,
      limit
    });
    return rows.map((row) =>
      toParameterDto({
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        explanation: row.explanation,
        config_format: row.config_format,
        value_kind: row.value_kind,
        module: row.module,
        parameter_module_id: row.parameter_module_id,
        module_path: row.module_path,
        default_range: row.default_range,
        unit: row.unit,
        risk: normalizeParameterRisk(row.risk),
        current_value: row.current_value,
        initSuggestionText: row.initSuggestionText ?? "",
        source_file_name: row.source_file_name,
        source_node_path: row.source_node_path,
        updated_at: row.updated_at
      })
    );
  }

  const values: unknown[] = [query.organizationId];
  const where = ["ppv.organization_id = $1", "pd.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `ppv.project_id = ${placeholder}`, query.projectId);
  }

  if (query.module) {
    addCondition(where, values, (placeholder) => `pd.module = ${placeholder}`, query.module);
  }

  if (query.moduleId) {
    where.push(
      buildParameterModuleSubtreeFilter(values, query.moduleId, query.includeDescendants !== false)
    );
  }

  if (query.risk) {
    const risks = Array.isArray(query.risk) ? query.risk : [query.risk];
    addCondition(where, values, (placeholder) => `pd.risk = any(${placeholder}::text[])`, risks);
  }

  if (query.q) {
    const term = `%${query.q}%`;
    addCondition(
      where,
      values,
      (placeholder) => `(pd.name ilike ${placeholder} or pd.description ilike ${placeholder} or pd.explanation ilike ${placeholder})`,
      term
    );
  }

  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  values.push(limit);

  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.parameter_module_id,
      (
        select string_agg(pm_seg.name, '/' order by pm_seg.depth)
        from parameter_modules pm_seg
        where pm_seg.organization_id = pd.organization_id
          and pm_seg.id = any(string_to_array(coalesce(pm.path, ''), '/'))
      ) as module_path,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    left join parameter_modules pm on pm.id = pd.parameter_module_id and pm.organization_id = pd.organization_id
    where ${where.join("\n      and ")}
    order by ppv.updated_at desc, pd.name asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => toParameterDto(row));
}

export async function getParameterById(db: Queryable, query: { organizationId: string; parameterId: string }) {
  if (parameterIdentityMode() === "semantic") {
    const rows = await listSemanticParameters(db, {
      organizationId: query.organizationId,
      limit: 500
    });
    const row = rows.find((candidate) => candidate.id === query.parameterId);
    if (!row) return null;
    const history = await listParameterHistory(db, query);
    return toParameterDto(
      {
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        explanation: row.explanation,
        config_format: row.config_format,
        value_kind: row.value_kind,
        module: row.module,
        parameter_module_id: row.parameter_module_id,
        module_path: row.module_path,
        default_range: row.default_range,
        unit: row.unit,
        risk: normalizeParameterRisk(row.risk),
        current_value: row.current_value,
        initSuggestionText: row.initSuggestionText ?? "",
        source_file_name: row.source_file_name,
        source_node_path: row.source_node_path,
        updated_at: row.updated_at
      },
      history
    );
  }

  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.source_file_name,
      ppv.source_node_path,
      ppv.updated_at
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    limit 1
    `,
    [query.organizationId, query.parameterId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const history = await listParameterHistory(db, query);
  return toParameterDto(row, history);
}

export async function listParameterHistory(db: Queryable, query: { organizationId: string; parameterId: string }) {
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<ParameterHistoryRow>(
      `
      select
        phe.version,
        phe.value,
        phe.changed_at,
        users.name as changed_by,
        phe.request_id,
        phe.initiator_type,
        phe.initiator_system_kind,
        phe.initiator_system_name,
        phe.initiator_session_id,
        phe.initiator_tool_call_id,
        phe.initiator_approval_id
      from parameter_history_entries phe
      left join users on users.id = phe.changed_by_user_id
      where phe.organization_id = $1
        and phe.project_parameter_binding_id = $2
      order by phe.changed_at desc
      `,
      [query.organizationId, query.parameterId]
    );
    return result.rows.map(toHistoryDto);
  }

  const result = await db.query<ParameterHistoryRow>(
    `
    select
      phe.version,
      phe.value,
        phe.changed_at,
        users.name as changed_by,
        phe.request_id,
        phe.initiator_type,
        phe.initiator_system_kind,
        phe.initiator_system_name,
        phe.initiator_session_id,
        phe.initiator_tool_call_id,
        phe.initiator_approval_id
    from parameter_history_entries phe
    inner join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.id = phe.project_parameter_value_id
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = phe.parameter_definition_id
    left join users on users.id = phe.changed_by_user_id
    where phe.organization_id = $1
      and ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.id = $2
    order by phe.changed_at desc
    `,
    [query.organizationId, query.parameterId]
  );

  return result.rows.map(toHistoryDto);
}

export async function getProjectParameterForUpdate(
  db: Queryable,
  query: { organizationId: string; projectId: string; parameterId: string }
) {
  if (parameterIdentityMode() === "semantic") {
    const result = await db.query<ProjectParameterForUpdateRow>(
      `
      select
        b.id,
        b.project_id,
        b.parameter_spec_id as parameter_definition_id,
        coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), ps.specification_key) as name,
        split_part(ps.specification_key, '/', 1) as module,
        coalesce(psv.value_shape->>'unit', '') as unit,
        coalesce(ps.risk, 'Low') as risk,
        coalesce(bpr.raw_value, '') as current_value,
        '' as "initSuggestionText",
        coalesce(
          (select count(*)::int from project_parameter_binding_revisions br where br.binding_id = b.id),
          1
        ) as value_version,
        null::text as source_file_name,
        lnr.node_locator as source_node_path
      from project_parameter_bindings b
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join lateral (
        select bpr.raw_value, bpr.parameter_spec_version_id
        from project_parameter_binding_revisions bpr
        where bpr.binding_id = b.id
        order by bpr.created_at desc
        limit 1
      ) bpr on true
      left join parameter_spec_versions psv on psv.id = bpr.parameter_spec_version_id
      left join dts_logical_nodes ln on ln.id = b.logical_node_id
      left join lateral (
        select lnr.node_locator
        from dts_logical_node_revisions lnr
        where lnr.logical_node_id = ln.id
        order by lnr.config_revision_id desc
        limit 1
      ) lnr on true
      where b.organization_id = $1
        and b.project_id = $2
        and b.id = $3
      for update of b
      `,
      [query.organizationId, query.projectId, query.parameterId]
    );
    return result.rows[0] ? toProjectParameterForUpdate(result.rows[0]) : null;
  }

  const result = await db.query<ProjectParameterForUpdateRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.value_version,
      ppv.source_file_name,
      ppv.source_node_path
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.id = $3
    for update
    `,
    [query.organizationId, query.projectId, query.parameterId]
  );

  return result.rows[0] ? toProjectParameterForUpdate(result.rows[0]) : null;
}

export async function findProjectValueBySource(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and ppv.source_file_name = $3
      and ppv.source_node_path = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.sourceFileName, query.sourceNodePath]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function findProjectValueByDefinition(
  db: Queryable,
  query: {
    organizationId: string;
    projectId: string;
    name: string;
    module: string;
  }
) {
  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      ppv.parameter_definition_id,
      pd.name,
      pd.module,
      ppv.current_value
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    inner join ${LEGACY_IDENTITY_SQL.definitionsTable} pd on pd.id = ppv.parameter_definition_id
    where ppv.organization_id = $1
      and pd.organization_id = $1
      and ppv.project_id = $2
      and pd.name = $3
      and pd.module = $4
    limit 1
    `,
    [query.organizationId, query.projectId, query.name, query.module]
  );

  return result.rows[0] ? toProjectParameterValueMatch(result.rows[0]) : null;
}

export async function bindParameterSource(
  db: Queryable,
  input: {
    projectParameterValueId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
) {
  await db.query(
    `
    update ${LEGACY_IDENTITY_SQL.valuesTable}
    set source_file_name = $2,
      source_node_path = $3,
      updated_at = now()
    where id = $1
    `,
    [input.projectParameterValueId, input.sourceFileName, input.sourceNodePath]
  );
}

/**
 * Create a parameter definition + project value bound to a structural DTS source path.
 * Used by structured edit submit when no existing PPV matches source or (name, module).
 */
export async function insertProjectParameterValueWithSource(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    definitionId: string;
    name: string;
    module: string;
    currentValue: string;
    recommendedValue: string;
    actorUserId: string;
    sourceFileName: string;
    sourceNodePath: string;
  }
): Promise<ProjectParameterValueMatch> {
  await db.query(
    `
    insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    )
    values ($1, $2, $3, $3, $3, 'DTS', $4, '', '', 'Low')
    on conflict (id) do nothing
    `,
    [input.definitionId, input.organizationId, input.name, input.module]
  );

  const result = await db.query<ProjectParameterValueMatchRow>(
    `
    insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
      id, organization_id, project_id, parameter_definition_id,
      current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id,
      source_file_name, source_node_path
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning
      id,
      project_id,
      parameter_definition_id,
      $10::text as name,
      $11::text as module,
      current_value
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.definitionId,
      input.currentValue,
      input.recommendedValue,
      input.actorUserId,
      input.sourceFileName,
      input.sourceNodePath,
      input.name,
      input.module
    ]
  );

  return toProjectParameterValueMatch(result.rows[0]);
}
