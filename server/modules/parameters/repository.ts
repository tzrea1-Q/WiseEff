import type { Queryable } from "../../shared/database/client";
import type { ParameterHistoryEntryDto, ParameterRecordDto, ProjectDto, ProjectModuleDto } from "./types";
import type { ParameterRiskLevel } from "./status";

type ProjectRow = {
  id: string;
  name: string;
  code: string;
};

type ProjectModuleRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
};

type ParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  current_value: string;
  recommended_value: string;
  updated_at: string | Date;
};

type ParameterHistoryRow = {
  version: number | string;
  value: string;
  changed_at: string | Date;
  changed_by: string | null;
  request_id: string | null;
};

export type ListParametersQuery = {
  organizationId: string;
  projectId?: string;
  module?: string;
  risk?: ParameterRiskLevel | ParameterRiskLevel[];
  q?: string;
  limit?: number;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code
  };
}

function toProjectModuleDto(row: ProjectModuleRow): ProjectModuleDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order
  };
}

function toParameterDto(row: ParameterRow, history: ParameterHistoryEntryDto[] = []): ParameterRecordDto {
  const updatedAt = dateTimeToIso(row.updated_at);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    module: row.module,
    projectId: row.project_id,
    currentValue: row.current_value,
    recommendedValue: row.recommended_value,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    updatedAt,
    updatedAtTs: updatedAt,
    history
  };
}

function toHistoryDto(row: ParameterHistoryRow): ParameterHistoryEntryDto {
  return {
    version: String(row.version),
    value: row.value,
    changedAt: dateTimeToIso(row.changed_at),
    changedBy: row.changed_by ?? "",
    requestId: row.request_id ?? undefined
  };
}

function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}

export async function listProjects(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
    order by name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectDto);
}

export async function listProjectModules(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectModuleRow>(
    `
    select id, project_id, name, sort_order
    from project_modules
    where organization_id = $1
      and project_id = $2
    order by sort_order asc, name asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toProjectModuleDto);
}

export async function listParameters(db: Queryable, query: ListParametersQuery) {
  const values: unknown[] = [query.organizationId];
  const where = ["ppv.organization_id = $1", "pd.organization_id = $1"];

  if (query.projectId) {
    addCondition(where, values, (placeholder) => `ppv.project_id = ${placeholder}`, query.projectId);
  }

  if (query.module) {
    addCondition(where, values, (placeholder) => `pd.module = ${placeholder}`, query.module);
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
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
    where ${where.join("\n      and ")}
    order by ppv.updated_at desc, pd.name asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => toParameterDto(row));
}

export async function getParameterById(db: Queryable, query: { organizationId: string; parameterId: string }) {
  const result = await db.query<ParameterRow>(
    `
    select
      ppv.id,
      ppv.project_id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.current_value,
      ppv.recommended_value,
      ppv.updated_at
    from project_parameter_values ppv
    inner join parameter_definitions pd on pd.id = ppv.parameter_definition_id
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
  const result = await db.query<ParameterHistoryRow>(
    `
    select
      phe.version,
      phe.value,
      phe.changed_at,
      users.name as changed_by,
      phe.request_id
    from parameter_history_entries phe
    inner join project_parameter_values ppv on ppv.id = phe.project_parameter_value_id
    inner join parameter_definitions pd on pd.id = phe.parameter_definition_id
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
