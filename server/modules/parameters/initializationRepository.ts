import type { Queryable } from "../../shared/database/client";
import { serializePostgresJsonb } from "../../shared/database/jsonb";
import {
  listCanonicalInitializationBindingCandidates,
  payloadToBindingView,
} from "../parameter-bindings/catalogProjectValueSync";
import { ApiError } from "../../shared/http/errors";
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
  owner_user_id: string | null;
  source_project_ids: unknown;
  primary_source_project_id: string | null;
  supplement_source_project_ids: unknown;
  selected_module_ids: unknown;
  selected_risks: unknown;
  selected_source_binding_ids: unknown;
  binding_snapshots: unknown;
  empty_library: boolean;
  notes: string;
  created_by_user_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type ReviewRow = {
  id: string;
  organization_id: string;
  project_id: string;
  draft_id: string;
  status: "pending" | "approved" | "rejected";
  submitted_by_user_id: string | null;
  submitted_at: string | Date;
  reviewed_by_user_id: string | null;
  reviewed_at: string | Date | null;
  rejection_reason: string | null;
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
    reviewedByUserId: row.reviewed_by_user_id,
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

/** Serialize the complete initialization draft/review lifecycle on the project row. */
export async function lockProjectInitialization(
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
    for update
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

/** Approval serializes on the review row so retry/concurrent requests cannot clone twice. */
export async function getReviewByIdForUpdate(
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
    for update
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
  const rows = await listCanonicalInitializationBindingCandidates(db, input);

  return rows.map((row) => {
    const view = payloadToBindingView(row.payload, row.sourceFormat);
    return {
      sourceProjectId: row.sourceProjectId,
      sourceBindingId: row.sourceBindingId,
      sourceProjectValueId: row.currentValueId,
      parameterSpecId: row.definitionId,
      parameterSpecVersionId: row.effectiveRevisionId,
      propertyKey: row.propertyKey,
      moduleId: row.moduleId ?? "",
      risk: normalizeRisk(row.risk),
      effectiveValue: view.typedValue,
      rawValue: view.rawValue,
      sourceConfigSetId: row.sourceConfigSetId,
      sourceConfigRevisionId: row.sourceConfigRevisionId,
      sourceOccurrenceId: row.sourceOccurrenceId,
      sourceFormat: row.sourceFormat,
      sourceName: row.sourceName ?? undefined,
      sourceLocatorLabel: row.sourceLocatorLabel ?? undefined
    };
  });
}

/** Reject cross-tenant or missing source projects before reading canonical rows. */
export async function assertSourceProjectsOwned(
  db: Queryable,
  input: { organizationId: string; projectIds: string[] }
): Promise<void> {
  const projectIds = [...new Set(input.projectIds.filter(Boolean))];
  if (projectIds.length === 0) return;
  const result = await db.query<{ id: string }>(
    `select id from projects where organization_id=$1 and id=any($2::text[])`,
    [input.organizationId, projectIds]
  );
  if (result.rows.length !== projectIds.length) {
    throw new ApiError("FORBIDDEN", "Every initialization source project must belong to the current organization.");
  }
}
