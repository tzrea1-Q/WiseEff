import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import type { InitializationBindingCandidate } from "./mergeInitializationBindings";
import type {
  InitializationDraftDto,
  InitializationReviewDto,
  InitializationRiskLevel,
  InitializationSnapshotItemDto,
  ProjectInitializationStatus,
  UpsertInitializationDraftInput
} from "./initializationTypes";

type DraftRow = {
  id: string;
  organization_id: string;
  project_id: string;
  project_name: string;
  project_code: string;
  owner_user_id: string;
  source_project_ids: unknown;
  primary_source_project_id: string | null;
  supplement_source_project_ids: unknown;
  selected_module_ids: unknown;
  selected_risks: unknown;
  selected_source_binding_ids: unknown;
  binding_snapshots: unknown;
  empty_library: boolean;
  notes: string;
  created_by_user_id: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type ReviewRow = {
  id: string;
  organization_id: string;
  project_id: string;
  draft_id: string;
  status: "pending" | "approved" | "rejected";
  submitted_by_user_id: string;
  submitted_at: string | Date;
  reviewed_by_user_id: string | null;
  reviewed_at: string | Date | null;
  rejection_reason: string | null;
};

type SourceBindingRow = {
  source_binding_id: string;
  source_project_id: string;
  parameter_spec_id: string;
  parameter_spec_version_id: string;
  property_key: string;
  module_id: string;
  logical_node_id: string | null;
  risk: string | null;
  effective_value: unknown;
  raw_value: string | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asRiskArray(value: unknown): InitializationRiskLevel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is InitializationRiskLevel => item === "High" || item === "Medium" || item === "Low"
  );
}

function asSnapshots(value: unknown): InitializationSnapshotItemDto[] {
  if (!Array.isArray(value)) return [];
  return value as InitializationSnapshotItemDto[];
}

function toDraftDto(row: DraftRow): InitializationDraftDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectCode: row.project_code,
    ownerUserId: row.owner_user_id,
    sourceProjectIds: asStringArray(row.source_project_ids),
    primarySourceProjectId: row.primary_source_project_id,
    supplementSourceProjectIds: asStringArray(row.supplement_source_project_ids),
    selectedModuleIds: asStringArray(row.selected_module_ids),
    selectedRisks: asRiskArray(row.selected_risks),
    selectedSourceBindingIds: asStringArray(row.selected_source_binding_ids),
    bindingSnapshots: asSnapshots(row.binding_snapshots),
    emptyLibrary: row.empty_library,
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toReviewDto(row: ReviewRow): InitializationReviewDto {
  return {
    id: row.id,
    draftId: row.draft_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    status: row.status,
    submittedByUserId: row.submitted_by_user_id,
    submittedAt: dateTimeToIso(row.submitted_at),
    reviewedByUserId: row.reviewed_by_user_id ?? undefined,
    reviewedAt: row.reviewed_at ? dateTimeToIso(row.reviewed_at) : undefined,
    rejectionReason: row.rejection_reason ?? undefined
  };
}

function normalizeRisk(value: string | null): InitializationBindingCandidate["risk"] {
  if (value === "High" || value === "Medium" || value === "Low") return value;
  return null;
}

export async function getProjectInitializationStatus(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<ProjectInitializationStatus | null> {
  const result = await db.query<{ initialization_status: ProjectInitializationStatus }>(
    `
    select initialization_status
    from projects
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.projectId]
  );
  return result.rows[0]?.initialization_status ?? null;
}

export async function setProjectInitializationStatus(
  db: Queryable,
  input: { organizationId: string; projectId: string; status: ProjectInitializationStatus }
): Promise<void> {
  const result = await db.query(
    `
    update projects
    set initialization_status = $3,
        updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.projectId, input.status]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`Project ${input.projectId} was not found for initialization status update.`);
  }
}

export async function getDraftByProject(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<InitializationDraftDto | null> {
  const result = await db.query<DraftRow>(
    `
    select *
    from project_parameter_initialization_drafts
    where organization_id = $1
      and project_id = $2
    limit 1
    `,
    [input.organizationId, input.projectId]
  );
  const row = result.rows[0];
  return row ? toDraftDto(row) : null;
}

export async function upsertDraft(
  db: Queryable,
  input: {
    organizationId: string;
    id: string;
    createdByUserId: string;
    draft: UpsertInitializationDraftInput;
  }
): Promise<InitializationDraftDto> {
  const result = await db.query<DraftRow>(
    `
    insert into project_parameter_initialization_drafts (
      id, organization_id, project_id, project_name, project_code, owner_user_id,
      source_project_ids, primary_source_project_id, supplement_source_project_ids,
      selected_module_ids, selected_risks, selected_source_binding_ids, binding_snapshots,
      empty_library, notes, created_by_user_id
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7::jsonb, $8, $9::jsonb,
      $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
      $14, $15, $16
    )
    on conflict (organization_id, project_id) do update set
      project_name = excluded.project_name,
      project_code = excluded.project_code,
      owner_user_id = excluded.owner_user_id,
      source_project_ids = excluded.source_project_ids,
      primary_source_project_id = excluded.primary_source_project_id,
      supplement_source_project_ids = excluded.supplement_source_project_ids,
      selected_module_ids = excluded.selected_module_ids,
      selected_risks = excluded.selected_risks,
      selected_source_binding_ids = excluded.selected_source_binding_ids,
      binding_snapshots = excluded.binding_snapshots,
      empty_library = excluded.empty_library,
      notes = excluded.notes,
      updated_at = now()
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.draft.projectId,
      input.draft.projectName,
      input.draft.projectCode,
      input.draft.ownerUserId,
      serializePostgresJsonb(input.draft.sourceProjectIds, "array"),
      input.draft.primarySourceProjectId,
      serializePostgresJsonb(input.draft.supplementSourceProjectIds, "array"),
      serializePostgresJsonb(input.draft.selectedModuleIds, "array"),
      serializePostgresJsonb(input.draft.selectedRisks, "array"),
      serializePostgresJsonb(input.draft.selectedSourceBindingIds, "array"),
      serializePostgresJsonb(input.draft.bindingSnapshots, "array"),
      input.draft.emptyLibrary,
      input.draft.notes,
      input.createdByUserId
    ]
  );
  return toDraftDto(result.rows[0]);
}

export async function insertReview(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    draftId: string;
    submittedByUserId: string;
  }
): Promise<InitializationReviewDto> {
  const result = await db.query<ReviewRow>(
    `
    insert into project_parameter_initialization_reviews (
      id, organization_id, project_id, draft_id, status, submitted_by_user_id
    ) values ($1, $2, $3, $4, 'pending', $5)
    returning *
    `,
    [input.id, input.organizationId, input.projectId, input.draftId, input.submittedByUserId]
  );
  return toReviewDto(result.rows[0]);
}

export async function listPendingReviews(
  db: Queryable,
  input: { organizationId: string }
): Promise<InitializationReviewDto[]> {
  const result = await db.query<ReviewRow>(
    `
    select *
    from project_parameter_initialization_reviews
    where organization_id = $1
      and status = 'pending'
    order by submitted_at desc
    `,
    [input.organizationId]
  );
  return result.rows.map(toReviewDto);
}

export async function getReviewById(
  db: Queryable,
  input: { organizationId: string; reviewId: string }
): Promise<InitializationReviewDto | null> {
  const result = await db.query<ReviewRow>(
    `
    select *
    from project_parameter_initialization_reviews
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.reviewId]
  );
  const row = result.rows[0];
  return row ? toReviewDto(row) : null;
}

export async function markReviewApproved(
  db: Queryable,
  input: { organizationId: string; reviewId: string; reviewedByUserId: string }
): Promise<InitializationReviewDto | null> {
  const result = await db.query<ReviewRow>(
    `
    update project_parameter_initialization_reviews
    set status = 'approved',
        reviewed_by_user_id = $3,
        reviewed_at = now()
    where organization_id = $1
      and id = $2
      and status = 'pending'
    returning *
    `,
    [input.organizationId, input.reviewId, input.reviewedByUserId]
  );
  const row = result.rows[0];
  return row ? toReviewDto(row) : null;
}

export async function markReviewRejected(
  db: Queryable,
  input: {
    organizationId: string;
    reviewId: string;
    reviewedByUserId: string;
    rejectionReason: string;
  }
): Promise<InitializationReviewDto | null> {
  const result = await db.query<ReviewRow>(
    `
    update project_parameter_initialization_reviews
    set status = 'rejected',
        reviewed_by_user_id = $3,
        reviewed_at = now(),
        rejection_reason = $4
    where organization_id = $1
      and id = $2
      and status = 'pending'
    returning *
    `,
    [input.organizationId, input.reviewId, input.reviewedByUserId, input.rejectionReason]
  );
  const row = result.rows[0];
  return row ? toReviewDto(row) : null;
}

export async function getBindingLogicalNodeId(
  db: Queryable,
  input: { organizationId: string; bindingId: string }
): Promise<string | null> {
  const result = await db.query<{ logical_node_id: string | null }>(
    `
    select logical_node_id
    from project_parameter_bindings
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [input.organizationId, input.bindingId]
  );
  return result.rows[0]?.logical_node_id ?? null;
}

/**
 * Load latest-revision binding candidates from source projects for snapshot preview.
 */
export async function listSourceBindingCandidates(
  db: Queryable,
  input: {
    organizationId: string;
    projectIds: string[];
    bindingIds?: string[];
    moduleIds?: string[];
    risks?: InitializationRiskLevel[];
  }
): Promise<InitializationBindingCandidate[]> {
  if (input.projectIds.length === 0) return [];

  const values: unknown[] = [input.organizationId, input.projectIds];
  const conditions = ["b.organization_id = $1", "b.project_id = any($2::text[])"];

  if (input.bindingIds?.length) {
    values.push(input.bindingIds);
    conditions.push(`b.id = any($${values.length}::text[])`);
  }
  if (input.moduleIds?.length) {
    values.push(input.moduleIds);
    conditions.push(`b.module_id = any($${values.length}::text[])`);
  }

  const result = await db.query<SourceBindingRow>(
    `
    select
      b.id as source_binding_id,
      b.project_id as source_project_id,
      b.parameter_spec_id,
      br.parameter_spec_version_id,
      coalesce(nullif(trim(ps.property_key), ''), nullif(trim(dps.property_key), ''), '') as property_key,
      b.module_id,
      b.logical_node_id,
      null::text as risk,
      br.typed_value as effective_value,
      br.raw_value
    from project_parameter_bindings b
    inner join lateral (
      select br2.parameter_spec_version_id, br2.typed_value, br2.raw_value
      from project_parameter_binding_revisions br2
      inner join dts_config_revisions cr on cr.id = br2.config_revision_id
      where br2.binding_id = b.id
      order by cr.revision_number desc, br2.created_at desc
      limit 1
    ) br on true
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_version_id = br.parameter_spec_version_id
    where ${conditions.join(" and ")}
    order by b.project_id, coalesce(ps.property_key, ''), b.id
    `,
    values
  );

  let rows = result.rows;
  if (input.risks?.length) {
    const allowed = new Set(input.risks);
    rows = rows.filter((row) => {
      const risk = normalizeRisk(row.risk);
      return risk !== null && allowed.has(risk);
    });
  }

  return rows.map((row) => ({
    sourceProjectId: row.source_project_id,
    sourceBindingId: row.source_binding_id,
    parameterSpecId: row.parameter_spec_id,
    parameterSpecVersionId: row.parameter_spec_version_id,
    propertyKey: row.property_key,
    moduleId: row.module_id,
    risk: normalizeRisk(row.risk),
    effectiveValue: row.effective_value,
    rawValue: row.raw_value ?? ""
  }));
}
