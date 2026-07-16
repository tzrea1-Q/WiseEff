/**
 * Post-cutover parameter reads/writes against semantic bindings/specs.
 * Must not reference renamed legacy_parameter_definitions / legacy_project_parameter_values.
 */
import type { Queryable } from "../../shared/database/client";
import {
  isParameterIdentityCutoverComplete,
  legacyParameterIdentityTablesRetired
} from "./cutoverAwareIdentity";

export type SemanticParameterRow = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  explanation: string;
  config_format: string;
  value_kind: string | null;
  module: string;
  parameter_module_id: string | null;
  module_path: string | null;
  default_range: string;
  unit: string;
  risk: string;
  current_value: string;
  initSuggestionText: string | null;
  source_file_name: string | null;
  source_node_path: string | null;
  updated_at: string | Date;
};

export async function mustUseSemanticParameterIdentity(db: Queryable): Promise<boolean> {
  return (
    (await isParameterIdentityCutoverComplete(db)) ||
    (await legacyParameterIdentityTablesRetired(db))
  );
}

export async function listSemanticParameters(
  db: Queryable,
  query: {
    organizationId: string;
    projectId?: string;
    module?: string;
    q?: string;
    limit: number;
  }
): Promise<SemanticParameterRow[]> {
  const values: unknown[] = [query.organizationId];
  const where = ["b.organization_id = $1"];

  if (query.projectId) {
    values.push(query.projectId);
    where.push(`b.project_id = $${values.length}`);
  }
  if (query.module) {
    values.push(query.module);
    where.push(`split_part(ps.specification_key, '/', 1) = $${values.length}`);
  }
  if (query.q) {
    values.push(`%${query.q}%`);
    where.push(
      `(ps.specification_key ilike $${values.length} or coalesce(psv.display_name, '') ilike $${values.length} or coalesce(psv.description, '') ilike $${values.length})`
    );
  }
  values.push(query.limit);

  const result = await db.query<SemanticParameterRow>(
    `
    select
      b.id,
      b.project_id,
      coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), psv.display_name, ps.specification_key) as name,
      coalesce(psv.description, '') as description,
      coalesce(psv.description, '') as explanation,
      'DTS' as config_format,
      coalesce(psv.value_shape->>'kind', 'legacy-text') as value_kind,
      split_part(ps.specification_key, '/', 1) as module,
      null::text as parameter_module_id,
      null::text as module_path,
      '' as default_range,
      coalesce(psv.value_shape->>'unit', '') as unit,
      'Low' as risk,
      coalesce(bpr.raw_value, '') as current_value,
      null::text as "initSuggestionText",
      null::text as source_file_name,
      lnr.node_locator as source_node_path,
      coalesce(bpr.created_at, now()) as updated_at
    from project_parameter_bindings b
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join lateral (
      select psv.*
      from parameter_spec_versions psv
      where psv.parameter_spec_id = ps.id
      order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join lateral (
      select bpr.*
      from project_parameter_binding_revisions bpr
      where bpr.binding_id = b.id
      order by bpr.created_at desc
      limit 1
    ) bpr on true
    left join dts_logical_nodes ln on ln.id = b.logical_node_id
    left join lateral (
      select lnr.node_locator
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = ln.id
      order by lnr.config_revision_id desc
      limit 1
    ) lnr on true
    where ${where.join("\n      and ")}
    order by updated_at desc, name asc
    limit $${values.length}
    `,
    values
  );
  return result.rows;
}

export async function getSemanticParameterById(
  db: Queryable,
  query: { organizationId: string; parameterId: string }
): Promise<SemanticParameterRow | null> {
  const rows = await listSemanticParameters(db, {
    organizationId: query.organizationId,
    limit: 500
  });
  return rows.find((row) => row.id === query.parameterId) ?? null;
}

export async function upsertSemanticDraft(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    bindingId: string;
    userId: string;
    targetValue: string;
    reason: string;
    origin?: "manual" | "file_sync";
    originFileVersionId?: string;
  }
) {
  const result = await db.query<{
    id: string;
    project_id: string;
    project_parameter_binding_id: string;
    target_value: string;
    reason: string;
    updated_at: string | Date;
  }>(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, user_id,
      target_value, reason, origin, origin_file_version_id,
      project_parameter_binding_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (project_id, project_parameter_binding_id, user_id)
    do update set
      target_value = excluded.target_value,
      reason = excluded.reason,
      origin = excluded.origin,
      origin_file_version_id = excluded.origin_file_version_id,
      updated_at = now()
    returning id, project_id, project_parameter_binding_id, target_value, reason, updated_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.userId,
      input.targetValue,
      input.reason,
      input.origin ?? "manual",
      input.originFileVersionId ?? null,
      input.bindingId
    ]
  );
  return result.rows[0] ?? null;
}
