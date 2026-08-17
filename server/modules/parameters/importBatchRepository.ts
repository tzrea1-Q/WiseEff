/**
 * DTS import batch repository for `parameter_import_batches`: definition
 * matching for import previews, batch persistence, and apply/mark-applied.
 * Legacy mode writes flat identity tables. Semantic mode matches bindings by
 * property key and updates the head binding revision — it must not touch
 * retired `parameter_definitions` / `project_parameter_values`.
 */

import type { Queryable } from "../../shared/database/client";
import type {
  ParameterImportBatchDto,
  ParameterImportSummaryDto
} from "./types";
import { type ParameterRiskLevel } from "./status";
import { LEGACY_SQL } from "../parameter-topology/migration";
import { LEGACY_IDENTITY_SQL } from "../parameter-kernel/legacyParameterIdentityNames";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { ApiError } from "../../shared/http/errors";
import { dateTimeToIso } from "../../shared/database/sqlUtil";

const SEMANTIC_IMPORT_NAME_SQL = `coalesce(
  dps.property_key,
  nullif(split_part(ps.specification_key, '/', 2), ''),
  psv.display_name,
  ps.specification_key
)`;

export type ImportPreviewClassification = "added" | "updated" | "unchanged" | "conflict";

export type PersistedImportBatchItem = {
  id: string;
  name: string;
  module: string;
  risk: ParameterRiskLevel;
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
  classification: ImportPreviewClassification;
  definitionId?: string;
  projectParameterValueId?: string;
  riskFlag: boolean;
};

export type PersistedImportBatchDto = Omit<ParameterImportBatchDto, "items"> & {
  items: PersistedImportBatchItem[];
};

type ParameterDefinitionImportRow = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: ParameterRiskLevel;
  project_parameter_value_id: string | null;
  current_value: string | null;
  initSuggestionText: string | null;
  value_version: number | string | null;
};

type ImportBatchRow = {
  id: string;
  project_id: string;
  source_name: string;
  status: "previewed" | "applied";
  summary: ParameterImportSummaryDto;
  items: PersistedImportBatchItem[];
  created_at: string | Date;
  applied_at: string | Date | null;
};

type ImportApplyResultRow = {
  id: string;
  definition_id: string;
  project_parameter_value_id: string;
  new_version: number | string;
};

export type ParameterDefinitionImportCandidate = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: ParameterRiskLevel;
  projectParameterValueId?: string;
  currentValue?: string;
  recommendedValue?: string;
  valueVersion?: number;
};

export type ImportApplyResult = {
  id: string;
  definitionId: string;
  projectParameterValueId: string;
  newVersion: number;
};

function toParameterDefinitionImportCandidate(row: ParameterDefinitionImportRow): ParameterDefinitionImportCandidate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    explanation: row.explanation,
    configFormat: row.config_format,
    module: row.module,
    range: row.default_range,
    unit: row.unit,
    risk: row.risk,
    projectParameterValueId: row.project_parameter_value_id ?? undefined,
    currentValue: row.current_value ?? undefined,
    recommendedValue: row.initSuggestionText ?? undefined,
    valueVersion: row.value_version === null ? undefined : Number(row.value_version)
  };
}

function toImportBatchDto(row: ImportBatchRow): PersistedImportBatchDto {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceName: row.source_name,
    status: row.status,
    createdAt: dateTimeToIso(row.created_at),
    appliedAt: row.applied_at ? dateTimeToIso(row.applied_at) : undefined,
    summary: row.summary,
    items: row.items
  };
}

function toImportApplyResult(row: ImportApplyResultRow): ImportApplyResult {
  return {
    id: row.id,
    definitionId: row.definition_id,
    projectParameterValueId: row.project_parameter_value_id,
    newVersion: Number(row.new_version)
  };
}

async function listSemanticParameterDefinitionsForImport(
  db: Queryable,
  query: { organizationId: string; projectId: string; names: string[]; definitionIds: string[] }
) {
  const result = await db.query<ParameterDefinitionImportRow>(
    `
    select
      ps.id,
      ${SEMANTIC_IMPORT_NAME_SQL} as name,
      coalesce(psv.description, '') as description,
      coalesce(psv.description, '') as explanation,
      'DTS' as config_format,
      coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
      split_part(ps.specification_key, '/', 1) as module,
      '' as default_range,
      coalesce(psv.value_shape->>'unit', '') as unit,
      coalesce(ps.risk, 'Low') as risk,
      b.id as project_parameter_value_id,
      coalesce(bpr.raw_value, '') as current_value,
      null::text as "initSuggestionText",
      coalesce(
        (select count(*)::int from project_parameter_binding_revisions br where br.binding_id = b.id),
        1
      ) as value_version
    from project_parameter_bindings b
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join lateral (
      select psv.*
      from parameter_spec_versions psv
      where psv.parameter_spec_id = ps.id
      order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
      limit 1
    ) psv on true
    left join lateral (
      select bpr.raw_value
      from project_parameter_binding_revisions bpr
      where bpr.binding_id = b.id
      order by bpr.created_at desc
      limit 1
    ) bpr on true
    where b.organization_id = $1
      and b.project_id = $2
      and (
        ${SEMANTIC_IMPORT_NAME_SQL} = any($3::text[])
        or ps.id = any($4::text[])
        or b.id = any($4::text[])
      )
    order by name asc, b.id asc
    `,
    [query.organizationId, query.projectId, query.names, query.definitionIds]
  );

  return result.rows.map(toParameterDefinitionImportCandidate);
}

export async function listParameterDefinitionsForImport(
  db: Queryable,
  query: { organizationId: string; projectId: string; names: string[]; definitionIds: string[] }
) {
  if (parameterIdentityMode() === "semantic") {
    return listSemanticParameterDefinitionsForImport(db, query);
  }

  const result = await db.query<ParameterDefinitionImportRow>(
    `
    select
      pd.id,
      pd.name,
      pd.description,
      pd.explanation,
      pd.config_format,
      pd.value_kind,
      pd.module,
      pd.default_range,
      pd.unit,
      pd.risk,
      ppv.id as project_parameter_value_id,
      ppv.current_value,
      ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
      ppv.value_version
    from ${LEGACY_IDENTITY_SQL.definitionsTable} pd
    left join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.parameter_definition_id = pd.id
      and ppv.organization_id = $1
      and ppv.project_id = $2
    where pd.organization_id = $1
      and (pd.name = any($3::text[]) or pd.id = any($4::text[]))
    order by pd.name asc
    `,
    [query.organizationId, query.projectId, query.names, query.definitionIds]
  );

  return result.rows.map(toParameterDefinitionImportCandidate);
}

export async function insertImportBatch(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    createdByUserId: string;
    sourceName: string;
    summary: ParameterImportSummaryDto;
    items: PersistedImportBatchItem[];
  }
) {
  const result = await db.query<ImportBatchRow>(
    `
    insert into parameter_import_batches (
      id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.createdByUserId,
      input.sourceName,
      "previewed",
      JSON.stringify(input.summary),
      JSON.stringify(input.items)
    ]
  );

  return toImportBatchDto(result.rows[0]);
}

export async function getImportBatchForUpdate(
  db: Queryable,
  query: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    select id, project_id, source_name, status, summary, items, created_at, applied_at
    from parameter_import_batches
    where organization_id = $1
      and id = $2
    for update
    `,
    [query.organizationId, query.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}

export async function applyAddedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  if (parameterIdentityMode() === "semantic") {
    throw new ApiError(
      "GONE",
      "Post-cutover import cannot create new parameter identity; ingest DTS instead.",
      { diagnostic: "semantic-import-add-retired", itemId: input.item.id }
    );
  }

  const result = await db.query<ImportApplyResultRow>(
    `
    with inserted_definition as (
      insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do nothing
      returning id
    ),
    inserted_value as (
      insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
        id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id
      )
      select $4, $1, $2, inserted_definition.id, $11, $12, $3
      from inserted_definition
      on conflict (project_id, parameter_definition_id) do update set
        current_value = excluded.current_value,
        ${LEGACY_SQL.recommendedValueColumn} = excluded.${LEGACY_SQL.recommendedValueColumn},
        value_version = ${LEGACY_IDENTITY_SQL.valuesTable}.value_version + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
      returning id, parameter_definition_id, value_version
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, $2, parameter_definition_id, id, value_version, $11, $3, null
      from inserted_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from inserted_value
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

async function applyUpdatedSemanticImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  const nextValue = input.item.currentValue ?? input.item.recommendedValue ?? "";
  const result = await db.query<ImportApplyResultRow>(
    `
    with binding as (
      select
        b.id as binding_id,
        b.parameter_spec_id,
        b.project_id,
        head.id as revision_id,
        head.raw_value,
        coalesce((
          select max(phe.version)
          from parameter_history_entries phe
          where phe.project_parameter_binding_id = b.id
        ), 0) as history_version
      from project_parameter_bindings b
      left join lateral (
        select bpr.id, bpr.raw_value
        from project_parameter_binding_revisions bpr
        where bpr.binding_id = b.id
        order by bpr.created_at desc
        limit 1
      ) head on true
      where b.organization_id = $1
        and b.project_id = $2
        and b.id = $3
      for update of b
    ),
    updated_revision as (
      update project_parameter_binding_revisions bpr
      set raw_value = $4
      from binding
      where bpr.id = binding.revision_id
        and binding.raw_value is distinct from $4
      returning bpr.id
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id,
        version, value, changed_by_user_id, request_id,
        parameter_spec_id, project_parameter_binding_id
      )
      select
        $5, $1, binding.project_id,
        binding.history_version + 1, $4, $6, null,
        binding.parameter_spec_id, binding.binding_id
      from binding
      inner join updated_revision on true
      returning id
    )
    select
      binding.binding_id as id,
      binding.parameter_spec_id as definition_id,
      binding.binding_id as project_parameter_value_id,
      case
        when exists (select 1 from updated_revision) then binding.history_version + 1
        else binding.history_version
      end as new_version
    from binding
    `,
    [
      input.organizationId,
      input.projectId,
      input.item.projectParameterValueId,
      nextValue,
      input.historyId,
      input.actorUserId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function applyUpdatedImportItem(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    historyId: string;
    item: PersistedImportBatchItem & { definitionId: string; projectParameterValueId: string };
  }
) {
  if (parameterIdentityMode() === "semantic") {
    return applyUpdatedSemanticImportItem(db, input);
  }

  const result = await db.query<ImportApplyResultRow>(
    `
    with upserted_definition as (
      insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
        id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
      )
      values ($5, $1, $6, $13, $14, $15, $7, $10, $9, $8)
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        explanation = excluded.explanation,
        config_format = excluded.config_format,
        module = excluded.module,
        default_range = excluded.default_range,
        unit = excluded.unit,
        risk = excluded.risk,
        updated_at = now()
      where ${LEGACY_IDENTITY_SQL.definitionsTable}.organization_id = $1
      returning id
    ),
    existing_value as (
      select
        ppv.id,
        ppv.project_id,
        ppv.parameter_definition_id,
        ppv.current_value,
        ppv.${LEGACY_SQL.recommendedValueColumn} as "initSuggestionText",
        ppv.value_version
      from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
      inner join upserted_definition on upserted_definition.id = ppv.parameter_definition_id
      where ppv.organization_id = $1
        and ppv.project_id = $2
    ),
    inserted_value as (
      insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
        id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_SQL.recommendedValueColumn}, updated_by_user_id
      )
      select $4, $1, $2, upserted_definition.id, $11, $12, $3
      from upserted_definition
      where not exists (select 1 from existing_value)
      returning id, project_id, parameter_definition_id, current_value, value_version
    ),
    updated_value as (
      update ${LEGACY_IDENTITY_SQL.valuesTable} ppv
      set current_value = $11,
        ${LEGACY_SQL.recommendedValueColumn} = $12,
        value_version = ppv.value_version + 1,
        updated_by_user_id = $3,
        updated_at = now()
      from upserted_definition
      where ppv.organization_id = $1
        and ppv.project_id = $2
        and ppv.parameter_definition_id = upserted_definition.id
        and (
          ppv.current_value is distinct from $11
          or ppv.${LEGACY_SQL.recommendedValueColumn} is distinct from $12
        )
      returning ppv.id, ppv.project_id, ppv.parameter_definition_id, ppv.current_value, ppv.value_version
    ),
    changed_value as (
      select id, project_id, parameter_definition_id, current_value, value_version from inserted_value
      union all
      select id, project_id, parameter_definition_id, current_value, value_version from updated_value
    ),
    inserted_history as (
      insert into parameter_history_entries (
        id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
        version, value, changed_by_user_id, request_id
      )
      select $16, $1, project_id, parameter_definition_id, id, value_version, current_value, $3, null
      from changed_value
      returning id
    )
    select $4 as id, parameter_definition_id as definition_id, id as project_parameter_value_id, value_version as new_version
    from changed_value
    union all
    select $4 as id, upserted_definition.id as definition_id, existing_value.id as project_parameter_value_id, existing_value.value_version as new_version
    from upserted_definition
    inner join existing_value on existing_value.parameter_definition_id = upserted_definition.id
    where not exists (select 1 from changed_value)
    `,
    [
      input.organizationId,
      input.projectId,
      input.actorUserId,
      input.item.projectParameterValueId,
      input.item.definitionId,
      input.item.name,
      input.item.module,
      input.item.risk,
      input.item.unit,
      input.item.range,
      input.item.currentValue ?? input.item.recommendedValue ?? "",
      input.item.recommendedValue ?? input.item.currentValue ?? "",
      input.item.description ?? "",
      input.item.explanation ?? "",
      input.item.configFormat ?? "",
      input.historyId
    ]
  );

  return result.rows[0] ? toImportApplyResult(result.rows[0]) : null;
}

export async function markImportBatchApplied(
  db: Queryable,
  input: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    update parameter_import_batches
    set status = 'applied',
      applied_at = now()
    where organization_id = $1
      and id = $2
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [input.organizationId, input.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}
