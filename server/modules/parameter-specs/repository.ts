import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import type { SpecReviewTaskDraft } from "./types";

type ReviewTaskRow = {
  id: string;
  organization_id: string;
  parameter_spec_id: string | null;
  source_evidence: unknown;
  candidate_schemas: unknown;
  project_count: number | string;
  status: "open" | "resolved" | "dismissed";
  reviewer_user_id: string | null;
  reason: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export type PersistedSpecReviewTask = {
  id: string;
  organizationId: string;
  parameterSpecId?: string;
  sourceEvidence: Record<string, unknown>;
  candidateSchemas: unknown[];
  projectCount: number;
  status: "open" | "resolved" | "dismissed";
  reviewerUserId?: string;
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
};

function toDto(row: ReviewTaskRow): PersistedSpecReviewTask {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parameterSpecId: row.parameter_spec_id ?? undefined,
    sourceEvidence: (row.source_evidence ?? {}) as Record<string, unknown>,
    candidateSchemas: Array.isArray(row.candidate_schemas) ? row.candidate_schemas : [],
    projectCount: Number(row.project_count),
    status: row.status,
    reviewerUserId: row.reviewer_user_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
  };
}

export async function insertSpecReviewTask(
  db: Queryable,
  input: {
    organizationId: string;
    draft: SpecReviewTaskDraft;
  },
): Promise<PersistedSpecReviewTask> {
  const id = input.draft.id || randomUUID();
  const result = await db.query<ReviewTaskRow>(
    `
    insert into parameter_spec_review_tasks (
      id, organization_id, parameter_spec_id, source_evidence, candidate_schemas, project_count, status
    ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
    returning *
    `,
    [
      id,
      input.organizationId,
      input.draft.parameterSpecId ?? null,
      JSON.stringify(input.draft.sourceEvidence),
      JSON.stringify(input.draft.candidateSchemas),
      input.draft.projectCount,
      input.draft.status,
    ],
  );
  return toDto(result.rows[0]);
}

/** Persist open review-task drafts (unmatched/ambiguous). Binding callers land in Task 7. */
export async function persistOpenReviewTaskDrafts(
  db: Queryable,
  organizationId: string,
  drafts: SpecReviewTaskDraft[],
): Promise<PersistedSpecReviewTask[]> {
  const persisted: PersistedSpecReviewTask[] = [];
  for (const draft of drafts) {
    if (draft.status !== "open") continue;
    persisted.push(await insertSpecReviewTask(db, { organizationId, draft }));
  }
  return persisted;
}

export async function listOpenSpecReviewTasks(
  db: Queryable,
  organizationId: string,
): Promise<PersistedSpecReviewTask[]> {
  const result = await db.query<ReviewTaskRow>(
    `
    select *
    from parameter_spec_review_tasks
    where organization_id = $1 and status = 'open'
    order by created_at asc
    `,
    [organizationId],
  );
  return result.rows.map(toDto);
}

export async function getSpecReviewTaskById(
  db: Queryable,
  input: { organizationId: string; taskId: string },
): Promise<PersistedSpecReviewTask | null> {
  const result = await db.query<ReviewTaskRow>(
    `
    select *
    from parameter_spec_review_tasks
    where id = $1 and organization_id = $2
    limit 1
    `,
    [input.taskId, input.organizationId],
  );
  const row = result.rows[0];
  return row ? toDto(row) : null;
}

export async function resolveSpecReviewTaskRow(
  db: Queryable,
  input: {
    taskId: string;
    organizationId: string;
    status: "resolved" | "dismissed";
    parameterSpecId?: string | null;
    reviewerUserId: string;
    reason: string;
  },
): Promise<PersistedSpecReviewTask | null> {
  const result = await db.query<ReviewTaskRow>(
    `
    update parameter_spec_review_tasks
    set status = $3,
        parameter_spec_id = coalesce($4, parameter_spec_id),
        reviewer_user_id = $5,
        reason = $6,
        resolved_at = now()
    where id = $1 and organization_id = $2 and status = 'open'
    returning *
    `,
    [
      input.taskId,
      input.organizationId,
      input.status,
      input.parameterSpecId ?? null,
      input.reviewerUserId,
      input.reason,
    ],
  );
  const row = result.rows[0];
  return row ? toDto(row) : null;
}

type SpecListRow = {
  id: string;
  source_kind: "dts" | "json" | "manual";
  specification_key: string;
  property_key: string | null;
  driver_module: string | null;
  lifecycle: "draft" | "active" | "deprecated" | null;
  current_version_id: string | null;
  current_version: number | string | null;
};

export type ParameterSpecListRow = {
  id: string;
  sourceKind: "dts" | "json" | "manual";
  specificationKey: string;
  propertyKey: string | null;
  driverModule: string | null;
  lifecycle: "draft" | "active" | "deprecated";
  currentVersionId: string | null;
  currentVersion: number | null;
};

export type ParameterSpecDetailRow = ParameterSpecListRow & {
  displayName: string | null;
  description: string | null;
  valueShape: unknown | null;
  schemaDefault: unknown | null;
  exampleValue: unknown | null;
  schemaNamespace: string | null;
  units: string | null;
  constraints: Record<string, unknown> | null;
  documentation: string | null;
  compatiblePatterns: string[] | null;
  policyTarget: unknown | null;
};

function toListRow(row: SpecListRow): ParameterSpecListRow {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    specificationKey: row.specification_key,
    propertyKey: row.property_key,
    driverModule: row.driver_module,
    lifecycle: row.lifecycle ?? "draft",
    currentVersionId: row.current_version_id,
    currentVersion: row.current_version == null ? null : Number(row.current_version),
  };
}

export async function listParameterSpecRows(
  db: Queryable,
  input: {
    organizationId: string;
    q?: string;
    sourceKind?: "dts" | "json" | "manual";
    lifecycle?: "draft" | "active" | "deprecated";
    driverModule?: string;
    propertyKey?: string;
  },
): Promise<ParameterSpecListRow[]> {
  const values: unknown[] = [input.organizationId];
  const conditions = ["(ps.organization_id = $1 or ps.organization_id is null)"];

  if (input.sourceKind) {
    values.push(input.sourceKind);
    conditions.push(`ps.source_kind = $${values.length}`);
  }
  if (input.lifecycle) {
    values.push(input.lifecycle);
    conditions.push(`psv.lifecycle = $${values.length}`);
  }
  if (input.driverModule) {
    values.push(input.driverModule);
    conditions.push(`split_part(ps.specification_key, '/', 1) = $${values.length}`);
  }
  if (input.propertyKey) {
    values.push(input.propertyKey);
    conditions.push(`coalesce(dps.property_key, split_part(ps.specification_key, '/', 2)) = $${values.length}`);
  }
  if (input.q) {
    values.push(`%${input.q}%`);
    conditions.push(
      `(ps.specification_key ilike $${values.length} or coalesce(dps.property_key, '') ilike $${values.length} or coalesce(psv.display_name, '') ilike $${values.length})`,
    );
  }

  const result = await db.query<SpecListRow>(
    `
    select
      ps.id,
      ps.source_kind,
      ps.specification_key,
      coalesce(dps.property_key, nullif(split_part(ps.specification_key, '/', 2), '')) as property_key,
      nullif(split_part(ps.specification_key, '/', 1), '') as driver_module,
      psv.lifecycle,
      psv.id as current_version_id,
      psv.version as current_version
    from parameter_specs ps
    left join lateral (
      select *
      from parameter_spec_versions
      where parameter_spec_id = ps.id
      order by version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    where ${conditions.join(" and ")}
    order by ps.specification_key asc
    `,
    values,
  );
  return result.rows.map(toListRow);
}

type SpecDetailRow = SpecListRow & {
  display_name: string | null;
  description: string | null;
  value_shape: unknown;
  schema_default: unknown;
  example_value: unknown;
  schema_namespace: string | null;
  units: string | null;
  constraints: unknown;
  documentation: string | null;
  compatible_patterns: unknown;
  policy_target: unknown;
};

export async function getParameterSpecRow(
  db: Queryable,
  input: { organizationId: string; specId: string },
): Promise<ParameterSpecDetailRow | null> {
  const result = await db.query<SpecDetailRow>(
    `
    select
      ps.id,
      ps.source_kind,
      ps.specification_key,
      coalesce(dps.property_key, nullif(split_part(ps.specification_key, '/', 2), '')) as property_key,
      nullif(split_part(ps.specification_key, '/', 1), '') as driver_module,
      psv.lifecycle,
      psv.id as current_version_id,
      psv.version as current_version,
      psv.display_name,
      psv.description,
      psv.value_shape,
      psv.schema_default,
      psv.example_value,
      dps.schema_namespace,
      dps.units,
      dps.constraints,
      dps.documentation,
      dsv.compatible_patterns,
      ppt.target_value as policy_target
    from parameter_specs ps
    left join lateral (
      select *
      from parameter_spec_versions
      where parameter_spec_id = ps.id
      order by version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join driver_schemas ds on ds.parameter_spec_id = ps.id
    left join lateral (
      select *
      from driver_schema_versions
      where driver_schema_id = ds.id
      order by version desc
      limit 1
    ) dsv on true
    left join lateral (
      select target_value
      from parameter_policy_targets
      where parameter_spec_id = ps.id and organization_id = $1
      order by updated_at desc
      limit 1
    ) ppt on true
    where ps.id = $2
      and (ps.organization_id = $1 or ps.organization_id is null)
    limit 1
    `,
    [input.organizationId, input.specId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    ...toListRow(row),
    displayName: row.display_name,
    description: row.description,
    valueShape: row.value_shape ?? null,
    schemaDefault: row.schema_default ?? null,
    exampleValue: row.example_value ?? null,
    schemaNamespace: row.schema_namespace,
    units: row.units,
    constraints:
      row.constraints && typeof row.constraints === "object" && !Array.isArray(row.constraints)
        ? (row.constraints as Record<string, unknown>)
        : null,
    documentation: row.documentation,
    compatiblePatterns: Array.isArray(row.compatible_patterns)
      ? row.compatible_patterns.map(String)
      : null,
    policyTarget: row.policy_target ?? null,
  };
}
