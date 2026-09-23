/**
 * Canonical pending value drafts (Issue #849 C4).
 *
 * A draft is pending work. These rows never touch the canonical current value
 * tip, the binding's `current_value_id` pointer, or the active config revision.
 * The physical storage is `public.project_parameter_value_drafts`; every
 * reference it holds is a genuine canonical identity plus the exact base pins.
 */
import { randomUUID } from "node:crypto";

import type { Queryable } from "../../../shared/database/client";

export type CanonicalValueDraftAction = "set" | "delete";

export type CanonicalValueDraftRow = {
  id: string;
  organization_id: string;
  project_id: string;
  binding_id: string;
  definition_id: string;
  definition_revision_id: string;
  catalog_release_id: string;
  base_current_value_id: string;
  config_revision_id: string;
  source_ref: string;
  action: CanonicalValueDraftAction;
  target_value: unknown;
  reason: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  source_pin_id: string | null;
  candidate_id: string | null;
  candidate_base_digest: string | null;
  candidate_proposed_digest: string | null;
  candidate_diff_digest: string | null;
  candidate_member_manifest: unknown[] | null;
  candidate_binding_manifest: unknown[] | null;
  source_format: "dts" | "json";
};

/** The exact canonical pins a draft must be created against. */
export type CanonicalBindingPins = {
  bindingId: string;
  projectId: string;
  organizationId: string;
  definitionId: string;
  definitionRevisionId: string;
  catalogReleaseId: string;
  currentValueId: string;
  configRevisionId: string;
  sourceRef: string;
  sourceFormat: "dts" | "json";
};

/**
 * Bounded, target-free projection used by an authorized reviewer to inspect
 * every author's canonical draft for one Binding.
 */
export type CanonicalValueDraftReviewRow = {
  id: string;
  organization_id: string;
  project_id: string;
  binding_id: string;
  user_id: string | null;
  definition_id: string;
  definition_revision_id: string;
  catalog_release_id: string;
  base_current_value_id: string;
  config_revision_id: string;
  source_ref: string;
  source_pin_id: string | null;
  candidate_id: string | null;
  candidate_base_digest: string | null;
  candidate_proposed_digest: string | null;
  candidate_diff_digest: string | null;
  source_format: "dts" | "json" | null;
  pending_request_id: string | null;
  stale: boolean;
};

export async function loadCanonicalBindingPins(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string }
): Promise<CanonicalBindingPins | null> {
  const result = await db.query<{
    binding_id: string;
    project_id: string;
    organization_id: string;
    definition_id: string;
    effective_revision_id: string;
    catalog_release_id: string;
    current_value_id: string;
    config_revision_id: string | null;
    source_ref: string | null;
    source_format: "dts" | "json" | null;
  }>(
    `
    select b.id as binding_id,
           b.project_id,
           b.organization_id,
           b.definition_id,
           b.effective_revision_id,
           b.catalog_release_id,
           b.current_value_id,
           value.config_revision_id,
           value.source_ref,
           pin.format as source_format
      from parameter_catalog.project_parameter_bindings b
      left join parameter_catalog.project_parameter_values value
        on value.binding_id = b.id
       and value.id = b.current_value_id
      left join parameter_catalog.project_value_source_pins pin
        on pin.project_value_id = value.id
       and pin.binding_id = b.id
     where b.organization_id = $1
       and b.project_id = $2
       and b.id = $3
     limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId]
  );
  const row = result.rows[0];
  if (!row || !row.config_revision_id || !row.source_ref || !row.source_format) return null;
  return {
    bindingId: row.binding_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    definitionId: row.definition_id,
    definitionRevisionId: row.effective_revision_id,
    catalogReleaseId: row.catalog_release_id,
    currentValueId: row.current_value_id,
    configRevisionId: row.config_revision_id,
    sourceRef: row.source_ref,
    sourceFormat: row.source_format
  };
}

/**
 * List all canonical drafts for one exact tenant/project/Binding scope.
 * Pending review requests deliberately remain visible: review needs to know
 * every competing frozen base before choosing one draft.
 */
export async function listCanonicalValueDraftsForBinding(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string }
): Promise<CanonicalValueDraftReviewRow[]> {
  const result = await db.query<CanonicalValueDraftReviewRow>(
    `
    select draft.id,
           draft.organization_id,
           draft.project_id,
           draft.binding_id,
           draft.user_id,
           draft.definition_id,
           draft.definition_revision_id,
           draft.catalog_release_id,
           draft.base_current_value_id,
           draft.config_revision_id,
           draft.source_ref,
           draft.source_pin_id,
           draft.candidate_id,
           draft.candidate_base_digest,
           draft.candidate_proposed_digest,
           draft.candidate_diff_digest,
           draft_pin.format as source_format,
           pending.id as pending_request_id,
           (
             current_binding.id is null
             or current_value.id is null
             or draft.definition_id is distinct from current_binding.definition_id
             or draft.definition_id is distinct from current_value.definition_id
             or draft.definition_revision_id is distinct from current_binding.effective_revision_id
             or draft.definition_revision_id is distinct from current_value.definition_revision_id
             or draft.catalog_release_id is distinct from current_binding.catalog_release_id
             or draft.base_current_value_id is distinct from current_binding.current_value_id
             or draft.config_revision_id is distinct from current_value.config_revision_id
             or draft.source_ref is distinct from current_value.source_ref
             or draft.source_pin_id is null
             or current_pin.id is null
             or draft.source_pin_id is distinct from current_pin.id
           ) as stale
      from public.project_parameter_value_drafts draft
      left join parameter_catalog.project_value_source_pins draft_pin
        on draft_pin.id = draft.source_pin_id
       and draft_pin.organization_id = draft.organization_id
       and draft_pin.project_id = draft.project_id
       and draft_pin.binding_id = draft.binding_id
      left join parameter_catalog.project_parameter_bindings current_binding
        on current_binding.organization_id = draft.organization_id
       and current_binding.project_id = draft.project_id
       and current_binding.id = draft.binding_id
      left join parameter_catalog.project_parameter_values current_value
        on current_value.binding_id = current_binding.id
       and current_value.definition_id = current_binding.definition_id
       and current_value.id = current_binding.current_value_id
      left join parameter_catalog.project_value_source_pins current_pin
        on current_pin.organization_id = current_binding.organization_id
       and current_pin.project_id = current_binding.project_id
       and current_pin.binding_id = current_binding.id
       and current_pin.project_value_id = current_binding.current_value_id
      left join lateral (
        select request.id
          from public.project_parameter_value_change_requests request
         where request.organization_id = draft.organization_id
           and request.project_id = draft.project_id
           and request.draft_id = draft.id
           and request.status = 'pending'
         order by request.updated_at desc, request.id
         limit 1
      ) pending on true
     where draft.organization_id = $1
       and draft.project_id = $2
       and draft.binding_id = $3
     order by draft.updated_at desc, draft.id
    `,
    [input.organizationId, input.projectId, input.bindingId]
  );
  return result.rows;
}

export async function upsertCanonicalValueDraft(
  db: Queryable,
  input: {
    organizationId: string;
    pins: CanonicalBindingPins;
    action: CanonicalValueDraftAction;
    targetValue: unknown;
    reason: string;
    userId: string;
    draftId?: string;
    sourcePinId: string;
    candidateId: string;
    candidateBaseDigest: string;
    candidateProposedDigest: string;
    candidateDiffDigest: string;
    candidateMemberManifest: unknown[];
    candidateBindingManifest: unknown[];
  }
): Promise<CanonicalValueDraftRow> {
  const result = await db.query<{ id: string }>(
    `
    insert into project_parameter_value_drafts (
      id, organization_id, project_id, binding_id, definition_id,
      definition_revision_id, catalog_release_id, base_current_value_id,
      config_revision_id, source_ref, action, target_value, reason, user_id,
      source_pin_id, candidate_id, candidate_base_digest, candidate_proposed_digest,
      candidate_diff_digest, candidate_member_manifest, candidate_binding_manifest
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14,
      $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb)
    on conflict (project_id, binding_id, user_id) do update
       set definition_id = excluded.definition_id,
           definition_revision_id = excluded.definition_revision_id,
           catalog_release_id = excluded.catalog_release_id,
           base_current_value_id = excluded.base_current_value_id,
           config_revision_id = excluded.config_revision_id,
           source_ref = excluded.source_ref,
           action = excluded.action,
           target_value = excluded.target_value,
           reason = excluded.reason,
           source_pin_id = excluded.source_pin_id,
           candidate_id = excluded.candidate_id,
           candidate_base_digest = excluded.candidate_base_digest,
           candidate_proposed_digest = excluded.candidate_proposed_digest,
           candidate_diff_digest = excluded.candidate_diff_digest,
           candidate_member_manifest = excluded.candidate_member_manifest,
           candidate_binding_manifest = excluded.candidate_binding_manifest,
           updated_at = now()
     where project_parameter_value_drafts.organization_id = excluded.organization_id
    returning *
    `,
    [
      input.draftId ?? `pvdr_${randomUUID()}`,
      input.organizationId,
      input.pins.projectId,
      input.pins.bindingId,
      input.pins.definitionId,
      input.pins.definitionRevisionId,
      input.pins.catalogReleaseId,
      input.pins.currentValueId,
      input.pins.configRevisionId,
      input.pins.sourceRef,
      input.action,
      JSON.stringify(input.targetValue),
      input.reason,
      input.userId,
      input.sourcePinId,
      input.candidateId,
      input.candidateBaseDigest,
      input.candidateProposedDigest,
      input.candidateDiffDigest,
      JSON.stringify(input.candidateMemberManifest),
      JSON.stringify(input.candidateBindingManifest)
    ]
  );
  const row = result.rows[0];
  if (!row) {
    // `where` on the conflict update rejected a foreign-organization row.
    throw new Error("Canonical value draft upsert matched a row outside the organization.");
  }
  const hydrated = await db.query<CanonicalValueDraftRow>(
    `select draft.*, pin.format as source_format
       from project_parameter_value_drafts draft
       join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
        and pin.organization_id=draft.organization_id and pin.project_id=draft.project_id and pin.binding_id=draft.binding_id
      where draft.id=$1`, [row.id]);
  return hydrated.rows[0]!;
}

export async function listCanonicalValueDrafts(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string }
): Promise<CanonicalValueDraftRow[]> {
  const result = await db.query<CanonicalValueDraftRow>(
    `
    select draft.*, pin.format as source_format
      from project_parameter_value_drafts draft
      join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
       and pin.organization_id=draft.organization_id and pin.project_id=draft.project_id and pin.binding_id=draft.binding_id
     where draft.organization_id = $1
       and draft.project_id = $2
       and draft.user_id = $3
       and not exists (
         select 1 from project_parameter_value_change_requests request
          where request.organization_id = draft.organization_id
            and request.project_id = draft.project_id
            and request.draft_id = draft.id
            and request.status = 'pending'
       )
     order by draft.updated_at desc, draft.id
    `,
    [input.organizationId, input.projectId, input.userId]
  );
  return result.rows;
}

export async function getCanonicalValueDraft(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string; draftId: string }
): Promise<CanonicalValueDraftRow | null> {
  const result = await db.query<CanonicalValueDraftRow>(
    `
    select draft.*, pin.format as source_format
      from project_parameter_value_drafts draft
      join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
       and pin.organization_id=draft.organization_id and pin.project_id=draft.project_id and pin.binding_id=draft.binding_id
     where draft.organization_id = $1
       and draft.project_id = $2
       and draft.user_id = $3
       and draft.id = $4
     limit 1
    `,
    [input.organizationId, input.projectId, input.userId, input.draftId]
  );
  return result.rows[0] ?? null;
}

export async function getCanonicalValueDraftForUpdate(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string; draftId: string }
): Promise<CanonicalValueDraftRow | null> {
  const result = await db.query<CanonicalValueDraftRow>(
    `
    select draft.*, pin.format as source_format
      from project_parameter_value_drafts draft
      join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
       and pin.organization_id=draft.organization_id and pin.project_id=draft.project_id and pin.binding_id=draft.binding_id
     where draft.organization_id = $1
       and draft.project_id = $2
       and draft.user_id = $3
       and draft.id = $4
     for update
    `,
    [input.organizationId, input.projectId, input.userId, input.draftId]
  );
  return result.rows[0] ?? null;
}

export async function deleteCanonicalValueDraft(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string; draftId: string; candidateId?: string }
): Promise<boolean> {
  const result = await db.query(
    `
    delete from project_parameter_value_drafts
     where organization_id = $1
       and project_id = $2
       and user_id = $3
       and id = $4
       and ($5::text is null or candidate_id = $5)
    `,
    [input.organizationId, input.projectId, input.userId, input.draftId, input.candidateId ?? null]
  );
  return (result.rowCount ?? 0) > 0;
}
