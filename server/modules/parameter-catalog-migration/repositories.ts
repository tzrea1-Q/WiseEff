/**
 * SQL access for the definition identity correction migration.  Every read that
 * answers "what is current" goes through
 * `parameter_catalog.current_project_parameter_bindings`; historical and pinned
 * reads never consult the replacement projection.
 */
import type pg from "pg";
import { randomUUID } from "node:crypto";

import type { DefinitionReplacementFailure, FrozenProjectTip, ReplacementStatus } from "./types";

export type MigrationRow = pg.QueryResultRow;

export type MigrationClient = {
  query<Row extends MigrationRow = MigrationRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

export type ReleasePinRow = { id: string; digest: string };

export const loadCurrentReleasePin = async (
  client: MigrationClient,
): Promise<ReleasePinRow | null> => {
  const result = await client.query<ReleasePinRow>(
    `select state.current_catalog_release_id as id, release.release_digest as digest
       from parameter_catalog.catalog_state state
       join parameter_catalog.catalog_releases release
         on release.id = state.current_catalog_release_id
      where state.singleton`,
  );
  return result.rows[0] ?? null;
};

export const loadReleasePinById = async (
  client: MigrationClient,
  releaseId: string,
): Promise<ReleasePinRow | null> => {
  const result = await client.query<ReleasePinRow>(
    `select id, release_digest as digest
       from parameter_catalog.catalog_releases
      where id = $1`,
    [releaseId],
  );
  return result.rows[0] ?? null;
};

export type DefinitionRow = {
  id: string;
  subject_id: string;
  property_key: string;
  revision_id: string;
  revision_content: { lifecycle?: string; valueSchema?: unknown } | null;
  subject_status: string | null;
  subject_name: string | null;
};

export const loadDefinitionInRelease = async (
  client: MigrationClient,
  releaseId: string,
  definitionId: string,
): Promise<DefinitionRow | null> => {
  const result = await client.query<DefinitionRow>(
    `select definition.id,
            definition.subject_id,
            definition.property_key,
            head.revision_id,
            revision.content as revision_content,
            membership.lifecycle as subject_status,
            subject.canonical_key as subject_name
       from parameter_catalog.parameter_definitions definition
       join parameter_catalog.catalog_release_definition_heads head
         on head.definition_id = definition.id
        and head.release_id = $1
       join parameter_catalog.definition_revisions revision
         on revision.id = head.revision_id
        and revision.definition_id = definition.id
       left join parameter_catalog.catalog_release_subjects membership
         on membership.subject_id = definition.subject_id
        and membership.release_id = head.release_id
       left join parameter_catalog.catalog_subjects subject
         on subject.id = definition.subject_id
      where definition.id = $2`,
    [releaseId, definitionId],
  );
  return result.rows[0] ?? null;
};

export type SubjectRow = { id: string; kind: string; status: string; canonical_key: string };
export type SubjectIdentityRow = { id: string; kind: string; canonical_key: string };

export const loadSubjectById = async (
  client: MigrationClient,
  subjectId: string,
): Promise<SubjectIdentityRow | null> => {
  const result = await client.query<SubjectIdentityRow>(
    `select id, kind, canonical_key
       from parameter_catalog.catalog_subjects
      where id = $1`,
    [subjectId],
  );
  return result.rows[0] ?? null;
};

export const loadSubjectInRelease = async (
  client: MigrationClient,
  releaseId: string,
  subjectId: string,
): Promise<SubjectRow | null> => {
  const result = await client.query<SubjectRow>(
    `select subject.id, subject.kind, membership.lifecycle as status, subject.canonical_key
       from parameter_catalog.catalog_subjects subject
       join parameter_catalog.catalog_release_subjects membership
         on membership.subject_id = subject.id
        and membership.release_id = $1
      where subject.id = $2`,
    [releaseId, subjectId],
  );
  return result.rows[0] ?? null;
};

export type ProjectRow = { id: string; organization_id: string; name: string | null };

export const loadProjects = async (
  client: MigrationClient,
  organizationId: string,
  projectIds: readonly string[],
): Promise<readonly ProjectRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await client.query<ProjectRow>(
    `select project.id,
            project.organization_id,
            coalesce(project.name, project.id) as name
       from public.projects project
      where project.id = any($1::text[])`,
    [[...projectIds]],
  );
  return result.rows;
};

export type CurrentTipRow = {
  binding_id: string;
  organization_id: string;
  project_id: string;
  logical_node_id: string;
  registration_id: string;
  subject_id: string;
  definition_id: string;
  effective_revision_id: string;
  current_value_id: string;
  value_kind: string | null;
  value_digest: string | null;
  source_ref: string | null;
  config_revision_id: string | null;
  value: unknown;
};

export const loadCurrentBindingTips = async (
  client: MigrationClient,
  organizationId: string,
  projectIds: readonly string[],
  definitionId: string,
): Promise<readonly CurrentTipRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await client.query<CurrentTipRow>(
    `select binding.id as binding_id,
            binding.organization_id,
            binding.project_id,
            binding.logical_node_id,
            binding.registration_id,
            binding.subject_id,
            binding.definition_id,
            binding.effective_revision_id,
            binding.current_value_id,
            value.value_kind,
            value.value_digest,
            value.source_ref,
            value.config_revision_id,
            value.value
       from parameter_catalog.current_project_parameter_bindings binding
       left join parameter_catalog.project_parameter_values value
         on value.id = binding.current_value_id
      where binding.organization_id = $1
        and binding.project_id = any($2::text[])
        and binding.definition_id = $3
      order by binding.project_id, binding.logical_node_id`,
    [organizationId, [...projectIds], definitionId],
  );
  return result.rows;
};

export const countCurrentReferences = async (
  client: MigrationClient,
  organizationId: string,
  definitionId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `select count(distinct binding.project_id)::text as n
       from parameter_catalog.current_project_parameter_bindings binding
      where binding.organization_id = $1
        and binding.definition_id = $2`,
    [organizationId, definitionId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

export const listCurrentReferenceProjects = async (
  client: MigrationClient,
  organizationId: string,
  definitionId: string,
): Promise<readonly string[]> => {
  const result = await client.query<{ project_id: string }>(
    `select distinct binding.project_id
       from parameter_catalog.current_project_parameter_bindings binding
      where binding.organization_id = $1
        and binding.definition_id = $2
      order by binding.project_id`,
    [organizationId, definitionId],
  );
  return result.rows.map((row) => row.project_id);
};

export type SiblingSourceRow = {
  binding_id: string;
  project_id: string;
  logical_node_id: string;
  property_key: string;
  source_ref: string;
  config_revision_id: string;
};

export const loadSiblingSourceFacts = async (
  client: MigrationClient,
  organizationId: string,
  projectIds: readonly string[],
): Promise<readonly SiblingSourceRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await client.query<SiblingSourceRow>(
    `select binding.id as binding_id,
            binding.project_id,
            binding.logical_node_id,
            definition.property_key,
            value.source_ref,
            value.config_revision_id
       from parameter_catalog.current_project_parameter_bindings binding
       join parameter_catalog.parameter_definitions definition
         on definition.id = binding.definition_id
       join parameter_catalog.project_parameter_values value
         on value.id = binding.current_value_id
      where binding.organization_id = $1
        and binding.project_id = any($2::text[])
      order by binding.project_id, binding.logical_node_id, binding.id`,
    [organizationId, [...projectIds]],
  );
  return result.rows;
};

export type RegistrationRow = {
  registration_id: string;
  status: string;
  placement_id: string | null;
  module_id: string | null;
  origin: string | null;
};

export const loadRegistration = async (
  client: MigrationClient,
  organizationId: string,
  subjectId: string,
): Promise<RegistrationRow | null> => {
  const result = await client.query<RegistrationRow>(
    `select registration.id as registration_id,
            registration.status,
            registration.current_placement_id as placement_id,
            placement.module_id,
            placement.origin
       from parameter_catalog.organization_subject_registrations registration
       left join parameter_catalog.subject_placements placement
         on placement.id = registration.current_placement_id
       left join public.parameter_modules module
         on module.id = placement.module_id
      where registration.organization_id = $1
        and registration.subject_id = $2`,
    [organizationId, subjectId],
  );
  return result.rows[0] ?? null;
};

export const countOpenDrafts = async (
  client: MigrationClient,
  organizationId: string,
  definitionRevisionId: string,
  releaseId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `select count(*)::text as n
       from parameter_catalog.definition_proposals proposal
      where proposal.organization_id = $1
        and proposal.status in ('draft', 'submitted')
        and (
          proposal.base_definition_revision_id = $2
          or proposal.base_catalog_release_id = $3
        )`,
    [organizationId, definitionRevisionId, releaseId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

export const countOpenReviewItems = async (
  client: MigrationClient,
  organizationId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `select count(*)::text as n
       from parameter_catalog.parameter_review_items review
      where review.organization_id = $1
        and review.status = 'open'`,
    [organizationId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

export const countOpenCutovers = async (
  client: MigrationClient,
  organizationId: string,
  propertyKey: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `select (
       (select count(*) from parameter_spec_property_key_cutover_runs run
          join parameter_specs spec on spec.id = run.parameter_spec_id
         where run.organization_id = $1
           and spec.specification_key = $2
           and run.status in ('preparing', 'ready'))
       +
       (select count(*) from parameter_spec_version_cutover_runs run
          join parameter_specs spec on spec.id = run.parameter_spec_id
         where run.organization_id = $1
           and spec.specification_key = $2
           and run.status in ('preparing', 'ready'))
     )::text as n`,
    [organizationId, propertyKey],
  );
  return Number(result.rows[0]?.n ?? 0);
};

export const countBindingForDefinition = async (
  client: MigrationClient,
  organizationId: string,
  projectId: string,
  definitionId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `select count(*)::text as n
       from parameter_catalog.project_parameter_bindings binding
      where binding.organization_id = $1
        and binding.project_id = $2
        and binding.definition_id = $3`,
    [organizationId, projectId, definitionId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

// ---------------------------------------------------------------------------
// Preview persistence
// ---------------------------------------------------------------------------

export type PreviewRow = {
  id: string;
  organization_id: string;
  old_definition_id: string;
  old_subject_id: string;
  old_property_key: string;
  old_revision_id: string;
  new_definition_id: string;
  new_subject_id: string;
  new_property_key: string;
  new_revision_id: string;
  preview_fingerprint: string;
  preview_catalog_release_id: string;
  preview_catalog_release_digest: string;
  candidate_id: string;
  artifact_digest: string;
  manifest: FrozenProjectTip[];
  blockers: string[];
  impact: Record<string, unknown>;
  approval_principal_id: string;
  reason: string;
  consumed_by_replacement_id: string | null;
  expires_at: Date | string;
};

export const insertReplacementPreview = async (
  client: MigrationClient,
  input: Omit<PreviewRow, "consumed_by_replacement_id">,
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.definition_replacement_previews (
       id, organization_id, old_definition_id, old_subject_id, old_property_key, old_revision_id,
       new_definition_id, new_subject_id, new_property_key, new_revision_id,
       preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
       candidate_id, artifact_digest, manifest, blockers, impact,
       approval_principal_id, reason, expires_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21)`,
    [
      input.id,
      input.organization_id,
      input.old_definition_id,
      input.old_subject_id,
      input.old_property_key,
      input.old_revision_id,
      input.new_definition_id,
      input.new_subject_id,
      input.new_property_key,
      input.new_revision_id,
      input.preview_fingerprint,
      input.preview_catalog_release_id,
      input.preview_catalog_release_digest,
      input.candidate_id,
      input.artifact_digest,
      JSON.stringify(input.manifest),
      JSON.stringify(input.blockers),
      JSON.stringify(input.impact),
      input.approval_principal_id,
      input.reason,
      input.expires_at,
    ],
  );
};

export const loadReplacementPreview = async (
  client: MigrationClient,
  organizationId: string,
  previewId: string,
): Promise<PreviewRow | null> => {
  const result = await client.query<PreviewRow>(
    `select id, organization_id, old_definition_id, old_subject_id, old_property_key,
            old_revision_id, new_definition_id, new_subject_id, new_property_key,
            new_revision_id, preview_fingerprint, preview_catalog_release_id,
            preview_catalog_release_digest, candidate_id, artifact_digest, manifest,
            blockers, impact, approval_principal_id, reason, consumed_by_replacement_id,
            expires_at
       from parameter_catalog.definition_replacement_previews
      where id = $1 and organization_id = $2
      for update`,
    [previewId, organizationId],
  );
  return result.rows[0] ?? null;
};

export const consumeReplacementPreview = async (
  client: MigrationClient,
  previewId: string,
  replacementId: string,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacement_previews
        set consumed_by_replacement_id = $2
      where id = $1`,
    [previewId, replacementId],
  );
};

// ---------------------------------------------------------------------------
// Replacement persistence
// ---------------------------------------------------------------------------

export type ReplacementRow = {
  id: string;
  organization_id: string;
  status: ReplacementStatus;
  replacement_version: string;
  old_definition_id: string;
  old_subject_id: string;
  old_property_key: string;
  old_revision_id: string;
  new_definition_id: string;
  new_subject_id: string;
  new_property_key: string;
  new_revision_id: string;
  preview_fingerprint: string;
  preview_catalog_release_id: string;
  preview_catalog_release_digest: string;
  source_preview_id: string;
  frozen_manifest: FrozenProjectTip[];
  candidate_id: string | null;
  publication_job_id: string | null;
  authorization_id: string | null;
  successor_release_id: string | null;
  successor_release_digest: string | null;
  approval_principal_id: string;
  approver_principal_id: string | null;
  reason: string;
  success_audit_ref: string | null;
  superseded_at: Date | string | null;
  created_at: Date | string;
};

export const insertReplacement = async (
  client: MigrationClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly status: ReplacementStatus;
    readonly oldDefinitionId: string;
    readonly oldSubjectId: string;
    readonly oldPropertyKey: string;
    readonly oldRevisionId: string;
    readonly newDefinitionId: string;
    readonly newSubjectId: string;
    readonly newPropertyKey: string;
    readonly newRevisionId: string;
    readonly previewFingerprint: string;
    readonly previewReleaseId: string;
    readonly previewReleaseDigest: string;
    readonly sourcePreviewId: string;
    readonly manifest: readonly FrozenProjectTip[];
    readonly approvalPrincipalId: string;
    readonly reason: string;
    readonly candidateId: string;
    readonly publicationJobId: string;
    readonly authorizationId: string;
    readonly successorReleaseId: string;
    readonly successorReleaseDigest: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.definition_replacements (
       id, organization_id, status, replacement_version,
       old_definition_id, old_subject_id, old_property_key, old_revision_id,
       new_definition_id, new_subject_id, new_property_key, new_revision_id,
       preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
       source_preview_id, frozen_manifest, candidate_id, publication_job_id,
       authorization_id, successor_release_id, successor_release_digest,
       approval_principal_id, reason
     ) values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23)`,
    [
      input.id,
      input.organizationId,
      input.status,
      input.oldDefinitionId,
      input.oldSubjectId,
      input.oldPropertyKey,
      input.oldRevisionId,
      input.newDefinitionId,
      input.newSubjectId,
      input.newPropertyKey,
      input.newRevisionId,
      input.previewFingerprint,
      input.previewReleaseId,
      input.previewReleaseDigest,
      input.sourcePreviewId,
      JSON.stringify(input.manifest),
      input.candidateId,
      input.publicationJobId,
      input.authorizationId,
      input.successorReleaseId,
      input.successorReleaseDigest,
      input.approvalPrincipalId,
      input.reason,
    ],
  );
};

export const loadReplacement = async (
  client: MigrationClient,
  organizationId: string,
  replacementId: string,
): Promise<ReplacementRow | null> => {
  const result = await client.query<ReplacementRow>(
    `select id, organization_id, status, replacement_version::text as replacement_version,
            old_definition_id, old_subject_id, old_property_key, old_revision_id,
            new_definition_id, new_subject_id, new_property_key, new_revision_id,
            preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
            source_preview_id, frozen_manifest, candidate_id, publication_job_id,
            authorization_id, successor_release_id, successor_release_digest,
            approval_principal_id, approver_principal_id, reason, success_audit_ref,
            superseded_at, created_at
       from parameter_catalog.definition_replacements
      where id = $1 and organization_id = $2
      for update`,
    [replacementId, organizationId],
  );
  return result.rows[0] ?? null;
};

export const listReplacements = async (
  client: MigrationClient,
  organizationId: string,
): Promise<readonly ReplacementRow[]> => {
  const result = await client.query<ReplacementRow>(
    `select id, organization_id, status, replacement_version::text as replacement_version,
            old_definition_id, old_subject_id, old_property_key, old_revision_id,
            new_definition_id, new_subject_id, new_property_key, new_revision_id,
            preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
            source_preview_id, frozen_manifest, candidate_id, publication_job_id,
            authorization_id, successor_release_id, successor_release_digest,
            approval_principal_id, approver_principal_id, reason, success_audit_ref,
            superseded_at, created_at
       from parameter_catalog.definition_replacements
      where organization_id = $1
      order by created_at desc, id desc`,
    [organizationId],
  );
  return result.rows;
};

export const recordReplacementPublication = async (
  client: MigrationClient,
  replacementId: string,
  input: {
    readonly candidateId: string;
    readonly publicationJobId: string;
    readonly authorizationId: string;
  },
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacements
        set candidate_id = $2,
            publication_job_id = $3,
            authorization_id = $4,
            replacement_version = replacement_version + 1,
            updated_at = now()
      where id = $1`,
    [replacementId, input.candidateId, input.publicationJobId, input.authorizationId],
  );
};

export const updateReplacementStatus = async (
  client: MigrationClient,
  replacementId: string,
  input: {
    readonly status: ReplacementStatus;
    readonly successorReleaseId?: string | null;
    readonly successorReleaseDigest?: string | null;
    readonly approverPrincipalId?: string | null;
    readonly successAuditRef?: string | null;
    readonly superseded?: boolean;
  },
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacements
        set status = $2,
            successor_release_id = coalesce($3, successor_release_id),
            successor_release_digest = coalesce($4, successor_release_digest),
            approver_principal_id = coalesce($5, approver_principal_id),
            success_audit_ref = coalesce($6, success_audit_ref),
            superseded_at = case when $7 then now() else superseded_at end,
            replacement_version = replacement_version + 1,
            updated_at = now()
      where id = $1`,
    [
      replacementId,
      input.status,
      input.successorReleaseId ?? null,
      input.successorReleaseDigest ?? null,
      input.approverPrincipalId ?? null,
      input.successAuditRef ?? null,
      input.superseded === true,
    ],
  );
};

export type ReplacementProjectRow = {
  id: string;
  replacement_id: string;
  organization_id: string;
  project_id: string;
  status: "completed" | "blocked" | "failed" | "pending";
  blocker_reason: string | null;
  blocked_evidence: Record<string, unknown> | null;
  old_binding_id: string;
  old_value_id: string;
  new_binding_id: string | null;
  new_value_id: string | null;
  old_definition_id: string;
  new_definition_id: string;
  attempt_count: number;
  last_error_class: string | null;
  last_error_reason: string | null;
};

export const insertReplacementProjects = async (
  client: MigrationClient,
  input: {
    readonly replacementId: string;
    readonly organizationId: string;
    readonly oldDefinitionId: string;
    readonly newDefinitionId: string;
    readonly manifest: readonly FrozenProjectTip[];
    readonly blockerByProject: ReadonlyMap<string, { reason: string; evidence: Record<string, unknown> }>;
  },
): Promise<void> => {
  for (const project of input.manifest) {
    const blocker = input.blockerByProject.get(project.projectId);
    await client.query(
      `insert into parameter_catalog.definition_replacement_projects (
         id, replacement_id, organization_id, project_id, status,
         blocker_reason, blocked_evidence, old_binding_id, old_value_id,
         old_definition_id, new_definition_id
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
      [
        `drepp_${randomUUID().replace(/-/g, "")}`,
        input.replacementId,
        input.organizationId,
        project.projectId,
        blocker ? "blocked" : "pending",
        blocker?.reason ?? null,
        blocker ? JSON.stringify(blocker.evidence) : null,
        project.bindingId,
        project.currentValueId,
        input.oldDefinitionId,
        input.newDefinitionId,
      ],
    );
  }
};

export const loadReplacementProjects = async (
  client: MigrationClient,
  replacementId: string,
): Promise<readonly ReplacementProjectRow[]> => {
  const result = await client.query<ReplacementProjectRow>(
    `select id, replacement_id, organization_id, project_id, status, blocker_reason,
            blocked_evidence, old_binding_id, old_value_id, new_binding_id, new_value_id,
            old_definition_id, new_definition_id, attempt_count, last_error_class,
            last_error_reason
       from parameter_catalog.definition_replacement_projects
      where replacement_id = $1
      order by project_id`,
    [replacementId],
  );
  return result.rows;
};

export const markReplacementProjectBlocked = async (
  client: MigrationClient,
  projectRowId: string,
  input: { readonly reason: string; readonly evidence: Record<string, unknown> },
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacement_projects
        set status = 'blocked',
            blocker_reason = $2,
            blocked_evidence = $3::jsonb,
            attempt_count = attempt_count + 1,
            last_error_class = 'blocked',
            last_error_reason = $2,
            updated_at = now()
      where id = $1`,
    [projectRowId, input.reason, JSON.stringify(input.evidence)],
  );
};

export const markReplacementProjectCompleted = async (
  client: MigrationClient,
  projectRowId: string,
  input: { readonly newBindingId: string; readonly newValueId: string },
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacement_projects
        set status = 'completed',
            blocker_reason = null,
            blocked_evidence = null,
            new_binding_id = $2,
            new_value_id = $3,
            attempt_count = attempt_count + 1,
            last_error_class = null,
            last_error_reason = null,
            updated_at = now()
      where id = $1`,
    [projectRowId, input.newBindingId, input.newValueId],
  );
};

export const markReplacementProjectPendingAttempt = async (
  client: MigrationClient,
  projectRowId: string,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.definition_replacement_projects
        set attempt_count = attempt_count + 1, updated_at = now()
      where id = $1`,
    [projectRowId],
  );
};

export const insertReplacementBinding = async (
  client: MigrationClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly catalogReleaseId: string;
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly registrationId: string;
    readonly subjectId: string;
    readonly definitionId: string;
    readonly effectiveRevisionId: string;
    readonly currentValueId: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.project_parameter_bindings (
       id, organization_id, catalog_release_id, project_id, logical_node_id,
       registration_id, subject_id, definition_id, effective_revision_id, current_value_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.id,
      input.organizationId,
      input.catalogReleaseId,
      input.projectId,
      input.logicalNodeId,
      input.registrationId,
      input.subjectId,
      input.definitionId,
      input.effectiveRevisionId,
      input.currentValueId,
    ],
  );
};

export const insertReplacementValue = async (
  client: MigrationClient,
  input: {
    readonly id: string;
    readonly bindingId: string;
    readonly definitionId: string;
    readonly definitionRevisionId: string;
    readonly sourceRef: string;
    readonly configRevisionId: string;
    readonly valueDigest: string;
    readonly valueKind: string;
    readonly value: unknown;
    readonly replacedFromValueId: string;
    readonly replacedFromDefinitionId: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.project_parameter_values (
       id, binding_id, definition_id, definition_revision_id, source_ref,
       config_revision_id, value_digest, value_kind, value, replaced_from_value_id,
       replaced_from_definition_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [
      input.id,
      input.bindingId,
      input.definitionId,
      input.definitionRevisionId,
      input.sourceRef,
      input.configRevisionId,
      input.valueDigest,
      input.valueKind,
      JSON.stringify(input.value),
      input.replacedFromValueId,
      input.replacedFromDefinitionId,
    ],
  );
};

export const insertReplacementHistoryEvent = async (
  client: MigrationClient,
  input: {
    readonly id: string;
    readonly bindingId: string;
    readonly newEffectiveRevisionId: string;
    readonly newCurrentValueId: string;
    readonly reason: string;
    readonly successAuditRef: string;
    readonly catalogReleaseId: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.binding_history_events (
       id, binding_id, new_effective_revision_id, new_current_value_id,
       reason, success_audit_ref, catalog_release_id
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.bindingId,
      input.newEffectiveRevisionId,
      input.newCurrentValueId,
      input.reason,
      input.successAuditRef,
      input.catalogReleaseId,
    ],
  );
};

// ---------------------------------------------------------------------------
// Governance idempotency (organization-scoped)
// ---------------------------------------------------------------------------

export type IdempotencyRow = {
  request_fingerprint: string;
  state: "pending" | "committed";
  result_kind: string | null;
  result_ref: string | null;
};

export const loadGovernanceIdempotency = async (
  client: MigrationClient,
  organizationId: string,
  family: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => {
  const result = await client.query<IdempotencyRow>(
    `select request_fingerprint, state, result_kind, result_ref
       from parameter_catalog.governance_command_idempotency
      where organization_id = $1 and command_family = $2 and idempotency_key = $3
      for update`,
    [organizationId, family, idempotencyKey],
  );
  return result.rows[0] ?? null;
};

export const reserveGovernanceIdempotency = async (
  client: MigrationClient,
  input: {
    readonly organizationId: string;
    readonly family: string;
    readonly idempotencyKey: string;
    readonly fingerprint: string;
  },
): Promise<IdempotencyRow> => {
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [input.organizationId, input.family, input.idempotencyKey, input.fingerprint],
  );
  const row = await loadGovernanceIdempotency(
    client,
    input.organizationId,
    input.family,
    input.idempotencyKey,
  );
  if (!row) {
    throw new Error("governance idempotency row missing after reserve");
  }
  return row;
};

export const commitGovernanceIdempotency = async (
  client: MigrationClient,
  input: {
    readonly organizationId: string;
    readonly family: string;
    readonly idempotencyKey: string;
    readonly resultKind: string;
    readonly resultRef: string;
  },
): Promise<void> => {
  await client.query(
    `update parameter_catalog.governance_command_idempotency
        set state = 'committed', result_kind = $4, result_ref = $5, committed_at = now()
      where organization_id = $1 and command_family = $2 and idempotency_key = $3
        and state = 'pending'`,
    [input.organizationId, input.family, input.idempotencyKey, input.resultKind, input.resultRef],
  );
};

// ---------------------------------------------------------------------------
// Publication job observation
// ---------------------------------------------------------------------------

export type PublicationJobRow = {
  id: string;
  candidate_id: string;
  authorization_id: string;
  status: string;
  last_error_reason: string | null;
};

export const loadPublicationJob = async (
  client: MigrationClient,
  jobId: string,
): Promise<PublicationJobRow | null> => {
  const result = await client.query<PublicationJobRow>(
    `select job.id, job.candidate_id, job.authorization_id, job.status, job.last_error_reason
       from catalog_publication.publication_jobs job
      where job.id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
};

export type CandidateRow = {
  id: string;
  artifact_digest: string;
  expected_base_release_id: string;
  expected_base_release_digest: string;
  identity_allocation: Record<string, unknown>;
  capability_contract_digest: string;
};

export const loadCandidate = async (
  client: MigrationClient,
  candidateId: string,
): Promise<CandidateRow | null> => {
  const result = await client.query<CandidateRow>(
    `select candidate.id,
            candidate.artifact_digest,
            candidate.expected_base_release_id,
            candidate.expected_base_release_digest,
            candidate.identity_allocation,
            catalog_publication.digest_jsonb(candidate.capability_contract) as capability_contract_digest
       from catalog_publication.candidates candidate
      where candidate.id = $1`,
    [candidateId],
  );
  return result.rows[0] ?? null;
};

export const loadPolicyRevision = async (client: MigrationClient): Promise<number | null> => {
  const result = await client.query<{ revision: string }>(
    `select revision::text as revision
       from catalog_publication.publication_policies
      where singleton`,
  );
  const row = result.rows[0];
  return row ? Number(row.revision) : null;
};

export const failureOf = (
  kind: DefinitionReplacementFailure["kind"],
): DefinitionReplacementFailure => ({ kind } as DefinitionReplacementFailure);
