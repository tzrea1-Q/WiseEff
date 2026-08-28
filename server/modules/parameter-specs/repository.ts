import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import type { DriverSchema, PropertySpec, SpecReviewTaskDraft } from "./types";
import {
  ensureAttributionSubjectForCompatible,
  ensureAttributionSubjectForDriverSchema,
} from "../parameter-modules/resolveAttributionSubject";

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
    candidateSchemas: Array.isArray(row.candidate_schemas)
      ? row.candidate_schemas
      : [],
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
  const evidence = input.draft.sourceEvidence ?? {};
  const projectId =
    input.draft.projectId ??
    (typeof evidence.projectId === "string" && evidence.projectId.trim()
      ? evidence.projectId
      : null);
  const configRevisionId =
    input.draft.configRevisionId ??
    (typeof evidence.configRevisionId === "string" &&
    evidence.configRevisionId.trim()
      ? evidence.configRevisionId
      : null);
  const propertyOccurrenceId =
    input.draft.propertyOccurrenceId ??
    (typeof evidence.propertyOccurrenceId === "string" &&
    evidence.propertyOccurrenceId.trim()
      ? evidence.propertyOccurrenceId
      : null);
  const blockerScope = input.draft.blockerScope ?? "revision";

  const result = await db.query<ReviewTaskRow>(
    `
    insert into parameter_spec_review_tasks (
      id, organization_id, parameter_spec_id, project_id, config_revision_id,
      property_occurrence_id, blocker_scope, source_evidence, candidate_schemas,
      project_count, status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
    returning *
    `,
    [
      id,
      input.organizationId,
      input.draft.parameterSpecId ?? null,
      projectId,
      configRevisionId,
      propertyOccurrenceId,
      blockerScope,
      JSON.stringify(evidence),
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

export type SpecReviewTaskListCursor = {
  createdAt: string;
  id: string;
};

export async function listSpecReviewTaskRows(
  db: Queryable,
  input: {
    organizationId: string;
    status?: "open" | "resolved" | "dismissed";
    projectId?: string;
    configRevisionId?: string;
    limit: number;
    cursor?: SpecReviewTaskListCursor | null;
  },
): Promise<{
  items: PersistedSpecReviewTask[];
  nextCursor: SpecReviewTaskListCursor | null;
}> {
  const values: unknown[] = [input.organizationId];
  const conditions = ["organization_id = $1"];

  if (input.status) {
    values.push(input.status);
    conditions.push(`status = $${values.length}`);
  }

  if (input.projectId) {
    values.push(input.projectId);
    conditions.push(
      `(project_id = $${values.length} or coalesce(source_evidence->>'projectId', '') = $${values.length})`,
    );
  }

  if (input.configRevisionId) {
    values.push(input.configRevisionId);
    conditions.push(
      `(config_revision_id = $${values.length} or coalesce(source_evidence->>'configRevisionId', '') = $${values.length})`,
    );
  }

  if (input.cursor) {
    values.push(input.cursor.createdAt, input.cursor.id);
    conditions.push(
      `(created_at, id) > ($${values.length - 1}::timestamptz, $${values.length}::text)`,
    );
  }

  values.push(input.limit + 1);
  const result = await db.query<ReviewTaskRow>(
    `
    select *
    from parameter_spec_review_tasks
    where ${conditions.join(" and ")}
    order by created_at asc, id asc
    limit $${values.length}
    `,
    values,
  );

  const hasMore = result.rows.length > input.limit;
  const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const items = rows.map(toDto);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
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

export async function lockOpenSpecReviewTask(
  db: Queryable,
  input: { organizationId: string; taskId: string },
): Promise<PersistedSpecReviewTask | null> {
  const result = await db.query<ReviewTaskRow>(
    `
    select *
    from parameter_spec_review_tasks
    where id = $1 and organization_id = $2 and status = 'open'
    for update
    `,
    [input.taskId, input.organizationId],
  );
  const row = result.rows[0];
  return row ? toDto(row) : null;
}

export type MatcherOverrideDecision = "resolved" | "dismissed";

export type PersistedMatcherOverride = {
  id: string;
  organizationId: string;
  projectId: string;
  compatibleFingerprint: string;
  nodeLocator: string | null;
  propertyKey: string;
  decision: MatcherOverrideDecision;
  parameterSpecId: string | null;
  sourceReviewTaskId: string | null;
  reason: string | null;
};

type MatcherOverrideRow = {
  id: string;
  organization_id: string;
  project_id: string;
  compatible_fingerprint: string;
  node_locator: string | null;
  property_key: string;
  decision: MatcherOverrideDecision;
  parameter_spec_id: string | null;
  source_review_task_id: string | null;
  reason: string | null;
};

function toMatcherOverride(row: MatcherOverrideRow): PersistedMatcherOverride {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    compatibleFingerprint: row.compatible_fingerprint,
    nodeLocator: row.node_locator,
    propertyKey: row.property_key,
    decision: row.decision,
    parameterSpecId: row.parameter_spec_id,
    sourceReviewTaskId: row.source_review_task_id,
    reason: row.reason,
  };
}

/** Stable fingerprint for compatible[] used by matcher override lookup. */
export function compatibleFingerprint(compatible: string[]): string {
  return [...compatible]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join("\0");
}

/** Normalized node locator fingerprint for matcher override scope. */
export function nodeLocatorFingerprint(nodeLocator?: string | null): string {
  const normalized = (nodeLocator ?? "")
    .trim()
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized;
}

/** Lookup key for matcher overrides: compatible + normalized locator + property (org/project scoped by query). */
export function matcherOverrideLookupKey(input: {
  compatible: string[];
  nodeLocator: string;
  propertyKey: string;
}): string {
  return `${compatibleFingerprint(input.compatible)}\0${nodeLocatorFingerprint(input.nodeLocator)}\0${input.propertyKey}`;
}

function matcherOverrideIndexKey(override: PersistedMatcherOverride): string {
  return `${override.compatibleFingerprint}\0${nodeLocatorFingerprint(override.nodeLocator)}\0${override.propertyKey}`;
}

export function persistedMatcherOverrideLookupKey(
  override: PersistedMatcherOverride,
): string {
  return matcherOverrideIndexKey(override);
}

export async function listMatcherOverridesForProject(
  db: Queryable,
  input: { organizationId: string; projectId: string },
): Promise<PersistedMatcherOverride[]> {
  const result = await db.query<MatcherOverrideRow>(
    `
    select *
    from parameter_spec_matcher_overrides
    where organization_id = $1 and project_id = $2
    `,
    [input.organizationId, input.projectId],
  );
  return result.rows.map(toMatcherOverride);
}

export type ValidatedSpecReviewLocate = {
  organizationId: string;
  projectId: string;
  configRevisionId: string;
  configSetId: string;
  propertyOccurrenceId: string;
  logicalNodeId: string;
  propertyKey: string;
};

type ValidatedSpecReviewLocateRow = {
  organization_id: string;
  project_id: string;
  config_revision_id: string;
  config_set_id: string;
  property_occurrence_id: string;
  logical_node_id: string;
  property_key: string;
};

/**
 * Tenant-scoped join: task org + project org + revision org/project + occurrence on revision
 * + logical node org/project/config set + node revision on same config revision.
 */
export async function validateSpecReviewTenantEvidence(
  db: Queryable,
  input: {
    organizationId: string;
    taskId: string;
    locate: {
      projectId: string;
      configRevisionId: string;
      propertyOccurrenceId: string;
      logicalNodeId: string;
      propertyKey: string;
    };
  },
): Promise<ValidatedSpecReviewLocate> {
  const result = await db.query<ValidatedSpecReviewLocateRow>(
    `
    select
      t.organization_id,
      p.id as project_id,
      cr.id as config_revision_id,
      cr.config_set_id,
      po.id as property_occurrence_id,
      ln.id as logical_node_id,
      po.property_name as property_key
    from parameter_spec_review_tasks t
    inner join projects p
      on p.id = $3
     and p.organization_id = t.organization_id
    inner join dts_config_revisions cr
      on cr.id = $4
     and cr.organization_id = t.organization_id
     and cr.project_id = p.id
    inner join dts_property_occurrences po
      on po.id = $5
     and po.config_revision_id = cr.id
     and po.property_name = $7
    inner join dts_logical_nodes ln
      on ln.id = $6
     and ln.organization_id = t.organization_id
     and ln.project_id = p.id
     and ln.config_set_id = cr.config_set_id
    inner join dts_logical_node_revisions lnr
      on lnr.logical_node_id = ln.id
     and lnr.config_revision_id = cr.id
    where t.id = $2
      and t.organization_id = $1
    limit 1
    `,
    [
      input.organizationId,
      input.taskId,
      input.locate.projectId,
      input.locate.configRevisionId,
      input.locate.propertyOccurrenceId,
      input.locate.logicalNodeId,
      input.locate.propertyKey,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "NOT_FOUND",
      "Review task evidence could not be verified for this organization.",
      { taskId: input.taskId },
    );
  }
  return {
    organizationId: row.organization_id,
    projectId: row.project_id,
    configRevisionId: row.config_revision_id,
    configSetId: row.config_set_id,
    propertyOccurrenceId: row.property_occurrence_id,
    logicalNodeId: row.logical_node_id,
    propertyKey: row.property_key,
  };
}

export async function assertProjectBelongsToOrganization(
  db: Queryable,
  input: { organizationId: string; projectId: string },
): Promise<void> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from projects
    where id = $2 and organization_id = $1
    limit 1
    `,
    [input.organizationId, input.projectId],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      "NOT_FOUND",
      "Project was not found for this organization.",
      {
        projectId: input.projectId,
      },
    );
  }
}

export async function assertBindingBelongsToTenant(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<void> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from project_parameter_bindings
    where id = $3
      and organization_id = $1
      and project_id = $2
    limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      "NOT_FOUND",
      "Project parameter binding could not be verified for this organization.",
      { bindingId: input.bindingId },
    );
  }
}

export async function upsertMatcherOverride(
  db: Queryable,
  input: {
    id?: string;
    organizationId: string;
    projectId: string;
    compatibleFingerprint: string;
    nodeLocator?: string | null;
    propertyKey: string;
    decision: MatcherOverrideDecision;
    parameterSpecId?: string | null;
    sourceReviewTaskId?: string | null;
    reason?: string | null;
    createdByUserId: string;
  },
): Promise<PersistedMatcherOverride> {
  await assertProjectBelongsToOrganization(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const id = input.id ?? randomUUID();
  const locatorFingerprint = nodeLocatorFingerprint(input.nodeLocator);
  const result = await db.query<MatcherOverrideRow>(
    `
    insert into parameter_spec_matcher_overrides (
      id, organization_id, project_id, compatible_fingerprint, node_locator,
      node_locator_fingerprint, property_key, decision, parameter_spec_id,
      source_review_task_id, reason, created_by_user_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    on conflict (organization_id, project_id, compatible_fingerprint, node_locator_fingerprint, property_key) do update set
      node_locator = excluded.node_locator,
      decision = excluded.decision,
      parameter_spec_id = excluded.parameter_spec_id,
      source_review_task_id = excluded.source_review_task_id,
      reason = excluded.reason,
      updated_at = now()
    returning *
    `,
    [
      id,
      input.organizationId,
      input.projectId,
      input.compatibleFingerprint,
      input.nodeLocator ?? null,
      locatorFingerprint,
      input.propertyKey,
      input.decision,
      input.parameterSpecId ?? null,
      input.sourceReviewTaskId ?? null,
      input.reason ?? null,
      input.createdByUserId,
    ],
  );
  return toMatcherOverride(result.rows[0]);
}

export async function upsertOccurrenceSpecDecision(
  db: Queryable,
  input: {
    id?: string;
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    propertyOccurrenceId: string;
    logicalNodeId?: string | null;
    propertyKey: string;
    decision: MatcherOverrideDecision;
    parameterSpecId?: string | null;
    bindingId?: string | null;
    reviewTaskId?: string | null;
  },
): Promise<void> {
  await assertProjectBelongsToOrganization(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const revision = await db.query<{ id: string }>(
    `
    select cr.id
    from dts_config_revisions cr
    inner join projects p on p.id = cr.project_id and p.organization_id = $1
    where cr.id = $2
      and cr.organization_id = $1
      and cr.project_id = $3
    limit 1
    `,
    [input.organizationId, input.configRevisionId, input.projectId],
  );
  if (!revision.rows[0]) {
    throw new ApiError(
      "NOT_FOUND",
      "Config revision could not be verified for this organization.",
      { configRevisionId: input.configRevisionId },
    );
  }
  const occurrence = await db.query<{ id: string }>(
    `
    select po.id
    from dts_property_occurrences po
    where po.id = $1
      and po.config_revision_id = $2
      and po.property_name = $3
    limit 1
    `,
    [input.propertyOccurrenceId, input.configRevisionId, input.propertyKey],
  );
  if (!occurrence.rows[0]) {
    throw new ApiError(
      "NOT_FOUND",
      "Property occurrence could not be verified for this organization.",
      { propertyOccurrenceId: input.propertyOccurrenceId },
    );
  }
  const id = input.id ?? randomUUID();
  await db.query(
    `
    insert into dts_property_occurrence_spec_decisions (
      id, organization_id, project_id, config_revision_id, property_occurrence_id,
      logical_node_id, property_key, decision, parameter_spec_id, binding_id, review_task_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    on conflict (property_occurrence_id) do update set
      logical_node_id = excluded.logical_node_id,
      property_key = excluded.property_key,
      decision = excluded.decision,
      parameter_spec_id = excluded.parameter_spec_id,
      binding_id = excluded.binding_id,
      review_task_id = excluded.review_task_id,
      updated_at = now()
    `,
    [
      id,
      input.organizationId,
      input.projectId,
      input.configRevisionId,
      input.propertyOccurrenceId,
      input.logicalNodeId ?? null,
      input.propertyKey,
      input.decision,
      input.parameterSpecId ?? null,
      input.bindingId ?? null,
      input.reviewTaskId ?? null,
    ],
  );
}

export async function countOpenSpecReviewTasksForRevision(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    excludePropertyKeys?: string[];
    unmatchedOnly?: boolean;
  },
): Promise<number> {
  const values: unknown[] = [
    input.organizationId,
    input.projectId,
    input.configRevisionId,
  ];
  const extraConditions: string[] = [];

  if (input.excludePropertyKeys && input.excludePropertyKeys.length > 0) {
    values.push(input.excludePropertyKeys);
    extraConditions.push(
      `coalesce(t.source_evidence->>'propertyKey', '') <> all($${values.length}::text[])`,
    );
    // Match isStructuralPropertyKey: any `#…` cells key is structural.
    extraConditions.push(
      `coalesce(t.source_evidence->>'propertyKey', '') not like '#%'`,
    );
  }

  if (input.unmatchedOnly) {
    extraConditions.push(
      `(
        coalesce(jsonb_array_length(t.candidate_schemas), 0) = 0
        or coalesce(t.source_evidence->>'inferred', '') = 'true'
      )`,
    );
  }

  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from parameter_spec_review_tasks t
    where t.organization_id = $1
      and t.status = 'open'
      and (
        (
          t.blocker_scope = 'revision'
          and coalesce(
            nullif(t.config_revision_id, ''),
            nullif(t.source_evidence->>'configRevisionId', '')
          ) = $3
        )
        or (
          t.blocker_scope = 'project'
          and coalesce(
            nullif(t.project_id, ''),
            nullif(t.source_evidence->>'projectId', '')
          ) = $2
        )
        or t.blocker_scope = 'platform'
      )
      ${extraConditions.length > 0 ? `and ${extraConditions.join(" and ")}` : ""}
    `,
    values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Backfill scoped columns on legacy review tasks from source_evidence (idempotent, tenant-validated). */
export async function backfillReviewTaskScopeColumns(
  db: Queryable,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
    with scoped as (
      select
        t.id,
        coalesce(
          nullif(t.project_id, ''),
          (
            select p.id
            from projects p
            where p.id = nullif(t.source_evidence->>'projectId', '')
              and p.organization_id = t.organization_id
            limit 1
          )
        ) as validated_project_id,
        coalesce(
          nullif(t.config_revision_id, ''),
          (
            select cr.id
            from dts_config_revisions cr
            inner join projects p
              on p.id = cr.project_id
             and p.organization_id = t.organization_id
            where cr.id = nullif(t.source_evidence->>'configRevisionId', '')
              and cr.organization_id = t.organization_id
              and p.id = coalesce(
                nullif(t.project_id, ''),
                nullif(t.source_evidence->>'projectId', '')
              )
            limit 1
          )
        ) as validated_config_revision_id,
        coalesce(
          nullif(t.property_occurrence_id, ''),
          (
            select po.id
            from dts_property_occurrences po
            inner join dts_config_revisions cr on cr.id = po.config_revision_id
            inner join projects p
              on p.id = cr.project_id
             and p.organization_id = t.organization_id
            where po.id = nullif(t.source_evidence->>'propertyOccurrenceId', '')
              and cr.organization_id = t.organization_id
              and cr.id = coalesce(
                nullif(t.config_revision_id, ''),
                nullif(t.source_evidence->>'configRevisionId', '')
              )
              and p.id = coalesce(
                nullif(t.project_id, ''),
                nullif(t.source_evidence->>'projectId', '')
              )
            limit 1
          )
        ) as validated_property_occurrence_id,
        nullif(t.source_evidence->>'projectId', '') as requested_project_id,
        nullif(t.source_evidence->>'configRevisionId', '') as requested_config_revision_id,
        nullif(t.source_evidence->>'propertyOccurrenceId', '') as requested_property_occurrence_id,
        t.source_evidence,
        t.blocker_scope
      from parameter_spec_review_tasks t
    ),
    computed as (
      select
        s.id,
        s.validated_project_id as project_id,
        s.validated_config_revision_id as config_revision_id,
        s.validated_property_occurrence_id as property_occurrence_id,
        case
          when s.validated_config_revision_id is not null then 'revision'
          when s.validated_project_id is not null then 'project'
          when coalesce(s.source_evidence->>'inferred', '') = 'true' then 'platform'
          when s.requested_project_id is not null
            or s.requested_config_revision_id is not null
            or s.requested_property_occurrence_id is not null
            then 'platform'
          else coalesce(nullif(s.blocker_scope, ''), 'revision')
        end as blocker_scope,
        case
          when (
            s.requested_project_id is not null
            and s.validated_project_id is null
          )
          or (
            s.requested_config_revision_id is not null
            and s.validated_config_revision_id is null
          )
          or (
            s.requested_property_occurrence_id is not null
            and s.validated_property_occurrence_id is null
          )
            then coalesce(s.source_evidence, '{}'::jsonb) || jsonb_build_object(
              'scopeBackfill',
              jsonb_build_object(
                'code', 'invalid_review_evidence',
                'requestedProjectId', s.requested_project_id,
                'requestedConfigRevisionId', s.requested_config_revision_id,
                'requestedPropertyOccurrenceId', s.requested_property_occurrence_id,
                'migration', 'repository-backfill'
              )
            )
          else s.source_evidence
        end as source_evidence
      from scoped s
    ),
    updated as (
      update parameter_spec_review_tasks t
      set
        project_id = c.project_id,
        config_revision_id = c.config_revision_id,
        property_occurrence_id = c.property_occurrence_id,
        blocker_scope = c.blocker_scope,
        source_evidence = c.source_evidence
      from computed c
      where t.id = c.id
        and (
          t.project_id is distinct from c.project_id
          or t.config_revision_id is distinct from c.config_revision_id
          or t.property_occurrence_id is distinct from c.property_occurrence_id
          or t.blocker_scope is distinct from c.blocker_scope
          or t.source_evidence is distinct from c.source_evidence
        )
      returning 1
    )
    select count(*)::text as count from updated
    `,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Dismissed properties still block release: they are not matched bindings.
 * Count occurrence decisions or project overrides that dismiss without a binding on this revision.
 */
export async function countDismissedSpecBlockersForRevision(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
  },
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from dts_property_occurrence_spec_decisions d
    where d.organization_id = $1
      and d.project_id = $2
      and d.config_revision_id = $3
      and d.decision = 'dismissed'
      and d.binding_id is null
    `,
    [input.organizationId, input.projectId, input.configRevisionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

type SpecListRow = {
  id: string;
  organization_id: string | null;
  source_kind: "dts" | "json" | "manual";
  specification_key: string;
  property_key: string | null;
  driver_module: string | null;
  lifecycle: "draft" | "active" | "deprecated" | null;
  current_version_id: string | null;
  current_version: number | string | null;
  value_shape: unknown;
  compatible_patterns: unknown;
  attribution_subject_id: string | null;
  active_version_count?: number | string | null;
  effective_scope?: "organization" | "platform" | "governance";
  override_of_spec_id?: string | null;
  declared_placement?: {
    moduleId: string;
    moduleName: string;
    categoryId: string | null;
    categoryName: string | null;
    path?: string[];
  } | null;
  observation_state?: "observed" | "not-yet-observed" | "unclassified";
};

export type SpecAttributionModuleRow = {
  id: string;
  name: string;
  kind: "business" | "driver-group" | "node-type" | "unclassified";
  /** Root→leaf display names. */
  path: string[];
};

export type ParameterSpecListRow = {
  id: string;
  organizationId: string | null;
  sourceKind: "dts" | "json" | "manual";
  specificationKey: string;
  propertyKey: string | null;
  driverModule: string | null;
  lifecycle: "draft" | "active" | "deprecated";
  currentVersionId: string | null;
  currentVersion: number | null;
  valueShape: unknown | null;
  compatiblePatterns: string[] | null;
  attributionModules: SpecAttributionModuleRow[];
  attributionSubjectId: string | null;
  referenceCount: number;
  effectiveScope?: "organization" | "platform" | "governance";
  overrideOfSpecId?: string | null;
  declaredPlacement?: {
    moduleId: string;
    moduleName: string;
    categoryId: string | null;
    categoryName: string | null;
    path?: string[];
  } | null;
  observationState?: "observed" | "not-yet-observed" | "unclassified";
};

export type ParameterSpecDetailRow = ParameterSpecListRow & {
  displayName: string | null;
  description: string | null;
  schemaDefault: unknown | null;
  exampleValue: unknown | null;
  schemaNamespace: string | null;
  units: string | null;
  constraints: Record<string, unknown> | null;
  documentation: string | null;
  policyTarget: unknown | null;
  /** Current version row status (ADR-0014). */
  versionStatus: "draft" | "active" | "superseded" | null;
};

function toListRow(row: SpecListRow): ParameterSpecListRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceKind: row.source_kind,
    specificationKey: row.specification_key,
    propertyKey: row.property_key,
    driverModule: row.driver_module,
    lifecycle: row.lifecycle ?? "draft",
    currentVersionId: row.current_version_id,
    currentVersion:
      row.current_version == null ? null : Number(row.current_version),
    valueShape: row.value_shape ?? null,
    compatiblePatterns: Array.isArray(row.compatible_patterns)
      ? row.compatible_patterns.map(String)
      : null,
    attributionModules: [],
    attributionSubjectId: row.attribution_subject_id ?? null,
    referenceCount: 0,
    effectiveScope: row.effective_scope,
    overrideOfSpecId: row.override_of_spec_id ?? null,
    declaredPlacement: row.declared_placement ?? null,
    observationState: row.observation_state,
  };
}

export async function listParameterSpecRows(
  db: Queryable,
  input: {
    organizationId: string;
    q?: string;
    sourceKind?: "dts" | "json" | "manual";
    lifecycle?: "draft" | "active" | "deprecated";
    attributionSubjectId?: string;
    propertyKey?: string;
    view?: "effective" | "governance";
  },
): Promise<ParameterSpecListRow[]> {
  // The product/read API is always the effective projection by default. Admin
  // surfaces that need drafts/history must opt into `view=governance` explicitly.
  const view = input.view ?? "effective";
  const values: unknown[] = [input.organizationId];
  const conditions = ["(c.organization_id = $1 or c.organization_id is null)"];

  if (input.sourceKind) {
    values.push(input.sourceKind);
    conditions.push(`c.source_kind = $${values.length}`);
  }
  if (input.lifecycle) {
    values.push(input.lifecycle);
    conditions.push(`c.lifecycle = $${values.length}`);
  }
  if (input.attributionSubjectId) {
    values.push(input.attributionSubjectId);
    conditions.push(`c.attribution_subject_id = $${values.length}`);
  }
  if (input.propertyKey) {
    values.push(input.propertyKey);
    conditions.push(`c.property_key = $${values.length}`);
  }
  if (input.q) {
    values.push(`%${input.q}%`);
    conditions.push(
      `(c.specification_key ilike $${values.length} or coalesce(c.property_key, '') ilike $${values.length} or coalesce(c.display_name, '') ilike $${values.length} or coalesce(c.driver_module, '') ilike $${values.length})`,
    );
  }

  const result = await db.query<SpecListRow>(
    `
    with candidate as (
      select
        ps.id,
        ps.organization_id,
        ps.source_kind,
        ps.specification_key,
        coalesce(
          ps.property_key,
          dps.property_key,
          nullif(
            (string_to_array(ps.specification_key, '/'))[
              cardinality(string_to_array(ps.specification_key, '/'))
            ],
            ''
          )
        ) as property_key,
        asub.display_name as driver_module,
        ps.definition_lifecycle as lifecycle,
        ps.attribution_subject_id,
        coalesce(lower(asub.source_key), 'subject:' || coalesce(ps.attribution_subject_id, ps.id))
          as driver_identity_key,
        psv.id as current_version_id,
        psv.version as current_version,
        psv.version_status,
        psv.lifecycle as version_lifecycle,
        psv.active_version_count,
        psv.value_shape,
        dsv.compatible_patterns,
        ds.attribution_subject_id as driver_schema_subject_id,
        dr.attribution_subject_id as driver_registration_id,
        drp.id as declared_placement_id,
        coalesce(dgm.id, node_type_module.id) as declared_module_id,
        coalesce(dgm.name, node_type_module.name) as declared_module_name,
        coalesce(category.id, node_type_category.id) as declared_category_id,
        coalesce(category.name, node_type_category.name) as declared_category_name,
        case
          -- Legacy/manual policy rows are not driver definitions and therefore
          -- do not participate in the driver-placement invariant. DTS rows do.
          when ps.source_kind <> 'dts'
            and dps.driver_schema_id is null
            and ps.attribution_subject_id is null then true
          when asub.subject_kind = 'node-type-definition'
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and node_type_module.id is not null
            and exists (
              select 1
              from node_type_definitions node_type_definition
              where node_type_definition.attribution_subject_id = ps.attribution_subject_id
            )
            and (
              ps.source_kind <> 'dts'
              or (
                dps.driver_schema_id is not null
                and ds.attribution_subject_id = ps.attribution_subject_id
                and (ds.organization_id is null or ds.organization_id = ps.organization_id)
                and exists (
                  select 1
                  from driver_schema_versions active_schema_version
                  where active_schema_version.driver_schema_id = dps.driver_schema_id
                    and active_schema_version.lifecycle = 'active'
                )
              )
            ) then true
          when ps.source_kind <> 'dts'
            and dps.driver_schema_id is null
            and ps.attribution_subject_id is not null
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and dr.attribution_subject_id is not null
            and drp.id is not null
            and dgm.id is not null
            and dgm.organization_id = $1
            and dgm.kind = 'driver-group'
            and dgm.attribution_subject_id = ps.attribution_subject_id
            and (
              drp.default_business_category_module_id is null
              or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
            ) then true
          when dps.driver_schema_id is not null
            and asub.subject_kind = 'driver-registration'
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and ds.attribution_subject_id is not distinct from ps.attribution_subject_id
            and (ds.organization_id is null or ds.organization_id = ps.organization_id)
            and exists (
              select 1
              from driver_schema_versions active_schema_version
              where active_schema_version.driver_schema_id = dps.driver_schema_id
                and active_schema_version.lifecycle = 'active'
            )
            and dr.attribution_subject_id is not null
            and drp.id is not null
            and dgm.id is not null
            and dgm.organization_id = $1
            and dgm.kind = 'driver-group'
            and dgm.attribution_subject_id = ps.attribution_subject_id
            and (
              drp.default_business_category_module_id is null
              or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
            ) then true
          else false
        end as placement_ready,
        case
          when exists (
            select 1 from project_parameter_bindings observed_binding
            where observed_binding.organization_id = $1
              and observed_binding.parameter_spec_id = ps.id
          ) then 'observed'
          when drp.id is not null or node_type_module.id is not null then 'not-yet-observed'
          else 'unclassified'
        end as observation_state,
        (ps.source_kind <> 'dts' or ps.property_key is not distinct from dps.property_key)
          as property_key_consistent,
        psv.display_name
      from parameter_specs ps
      left join attribution_subjects asub on asub.id = ps.attribution_subject_id
      left join lateral (
        select
          psv.*,
          count(*) filter (where psv.version_status = 'active' and psv.lifecycle = 'active') over () as active_version_count
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by
          case
            when psv.version_status = 'active' and psv.lifecycle = 'active' then 0
            when psv.version_status = 'active' then 1
            when psv.version_status = 'superseded' then 2
            else 3
          end,
          psv.version desc
        limit 1
      ) psv on true
      left join driver_schema_versions dsv on dsv.parameter_spec_version_id = psv.id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join driver_schemas ds on ds.id = dps.driver_schema_id
      left join driver_registrations dr on dr.attribution_subject_id = ps.attribution_subject_id
      left join driver_registration_placements drp
        on drp.organization_id = $1
       and drp.attribution_subject_id = ps.attribution_subject_id
      left join parameter_modules dgm on dgm.id = drp.driver_group_module_id
      left join parameter_modules category on category.id = drp.default_business_category_module_id
      left join parameter_modules node_type_module
        on node_type_module.organization_id = $1
       and node_type_module.kind = 'node-type'
       and (
         node_type_module.attribution_subject_id = ps.attribution_subject_id
         or lower(coalesce(node_type_module.source_key, '')) = lower(coalesce(asub.source_key, ''))
       )
      left join parameter_modules node_type_category
        on node_type_category.id = node_type_module.parent_id
       and node_type_category.organization_id = node_type_module.organization_id
       and node_type_category.kind = 'business'
      where (ps.organization_id = $1 or ps.organization_id is null)
        and not exists (
          select 1 from driver_schemas driver_root
          where driver_root.parameter_spec_id = ps.id
        )
        and coalesce(
          ps.property_key,
          dps.property_key,
          nullif(
            (string_to_array(ps.specification_key, '/'))[
              cardinality(string_to_array(ps.specification_key, '/'))
            ],
            ''
          )
        ) is not null
    ),
    ranked as (
      select
        c.*,
        row_number() over (
          partition by c.driver_identity_key, c.property_key
          order by
            case when c.organization_id = $1 then 0 else 1 end,
            c.id
        ) as effective_rank,
        count(*) filter (where c.organization_id = $1)
          over (partition by c.driver_identity_key, c.property_key) as organization_active_count,
        count(*) filter (where c.organization_id is null)
          over (partition by c.driver_identity_key, c.property_key) as platform_active_count
      from candidate c
      where c.lifecycle = 'active'
        and c.version_status = 'active'
        and c.version_lifecycle = 'active'
    ),
    visible as (
      select
        c.id,
        c.organization_id,
        c.source_kind,
        c.specification_key,
        c.property_key,
        c.driver_module,
        c.display_name,
        c.lifecycle,
        c.attribution_subject_id,
        c.current_version_id,
        c.current_version,
        c.value_shape,
        c.compatible_patterns,
        case when c.organization_id = $1 then 'organization' else 'platform' end as effective_scope,
        case
          when c.organization_id is null and c.organization_active_count > 0 then (
            select org.id
            from candidate org
            where org.organization_id = $1
              and org.driver_identity_key = c.driver_identity_key
              and org.property_key = c.property_key
              and org.lifecycle = 'active'
              and org.version_status = 'active'
              and org.version_lifecycle = 'active'
              and org.property_key_consistent
            order by org.id
            limit 1
          )
          when c.organization_id = $1 and c.platform_active_count > 0 then (
            select platform.id
            from candidate platform
            where platform.organization_id is null
              and platform.driver_identity_key = c.driver_identity_key
              and platform.property_key = c.property_key
              and platform.lifecycle = 'active'
              and platform.version_status = 'active'
              and platform.version_lifecycle = 'active'
              and platform.property_key_consistent
            order by platform.id
            limit 1
          )
          else null
        end as override_of_spec_id,
        case when c.declared_module_id is null then null else jsonb_build_object(
          'moduleId', c.declared_module_id,
          'moduleName', c.declared_module_name,
          'categoryId', c.declared_category_id,
          'categoryName', c.declared_category_name
        ) end as declared_placement,
        c.observation_state
      from ranked c
      where c.effective_rank = 1
        and c.organization_active_count <= 1
        and (
          c.organization_id = $1
          or (c.organization_id is null and c.organization_active_count = 0 and c.platform_active_count <= 1)
        )
        and c.active_version_count = 1
        and not exists (
          select 1
          from ranked organization_candidate
          where organization_candidate.organization_id = $1
            and organization_candidate.driver_identity_key = c.driver_identity_key
            and organization_candidate.property_key = c.property_key
            and organization_candidate.active_version_count <> 1
        )
        and c.property_key_consistent
        and c.placement_ready
        and $${values.length + 1} = 'effective'
      union all
      select
        c.id,
        c.organization_id,
        c.source_kind,
        c.specification_key,
        c.property_key,
        c.driver_module,
        c.display_name,
        c.lifecycle,
        c.attribution_subject_id,
        c.current_version_id,
        c.current_version,
        c.value_shape,
        c.compatible_patterns,
        'governance' as effective_scope,
        null as override_of_spec_id,
        case when c.declared_module_id is null then null else jsonb_build_object(
          'moduleId', c.declared_module_id,
          'moduleName', c.declared_module_name,
          'categoryId', c.declared_category_id,
          'categoryName', c.declared_category_name
        ) end as declared_placement,
        c.observation_state
      from candidate c
      where $${values.length + 1} = 'governance'
    )
    select *
    from visible c
    where ${conditions.join(" and ")}
    order by c.specification_key asc, c.id asc
    `,
    [...values, view],
  );
  const rows = result.rows.map(toListRow);
  const attributionBySpec = await loadAttributionModulesBySpecIds(db, {
    organizationId: input.organizationId,
    specIds: rows.map((row) => row.id),
  });
  const referenceCountBySpec = await loadReferenceCountsBySpecIds(db, {
    organizationId: input.organizationId,
    specIds: rows.map((row) => row.id),
  });
  return rows.map((row) => ({
    ...row,
    attributionModules: attributionBySpec.get(row.id) ?? [],
    referenceCount: referenceCountBySpec.get(row.id) ?? 0,
  }));
}

type AttributionModuleQueryRow = {
  parameter_spec_id: string;
  id: string;
  name: string;
  kind: SpecAttributionModuleRow["kind"];
  path_names: string[] | null;
};

/** Organization-scoped binding counts per parameter definition. */
export async function loadReferenceCountsBySpecIds(
  db: Queryable,
  input: { organizationId: string; specIds: readonly string[] },
): Promise<Map<string, number>> {
  if (input.specIds.length === 0) {
    return new Map();
  }
  const result = await db.query<{
    parameter_spec_id: string;
    reference_count: string | number;
  }>(
    `
    select parameter_spec_id, count(*)::int as reference_count
    from project_parameter_bindings
    where organization_id = $1
      and parameter_spec_id = any($2::text[])
    group by parameter_spec_id
    `,
    [input.organizationId, input.specIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.parameter_spec_id,
      Number(row.reference_count),
    ]),
  );
}

/** Distinct attribution units (driver-group / node-type) observed via project bindings. */
export async function loadAttributionModulesBySpecIds(
  db: Queryable,
  input: { organizationId: string; specIds: readonly string[] },
): Promise<Map<string, SpecAttributionModuleRow[]>> {
  if (input.specIds.length === 0) {
    return new Map();
  }

  const result = await db.query<AttributionModuleQueryRow>(
    `
    with recursive leaves as (
      select distinct
        ppb.parameter_spec_id,
        pm.id,
        pm.name,
        pm.kind,
        pm.parent_id
      from project_parameter_bindings ppb
      inner join parameter_modules pm on pm.id = ppb.module_id
      where ppb.organization_id = $1
        and ppb.parameter_spec_id = any($2::text[])
        and pm.kind in ('driver-group', 'node-type')
    ),
    walk as (
      select
        leaves.parameter_spec_id,
        leaves.id as leaf_id,
        leaves.id as module_id,
        leaves.name as module_name,
        leaves.parent_id,
        0 as depth
      from leaves
      union all
      select
        walk.parameter_spec_id,
        walk.leaf_id,
        parent.id,
        parent.name,
        parent.parent_id,
        walk.depth + 1
      from walk
      inner join parameter_modules parent on parent.id = walk.parent_id
      where walk.depth < 32
    )
    select
      leaves.parameter_spec_id,
      leaves.id,
      leaves.name,
      leaves.kind,
      coalesce(
        (
          select array_agg(walk.module_name order by walk.depth desc)
          from walk
          where walk.parameter_spec_id = leaves.parameter_spec_id
            and walk.leaf_id = leaves.id
        ),
        array[leaves.name]
      ) as path_names
    from leaves
    order by leaves.parameter_spec_id asc, leaves.name asc
    `,
    [input.organizationId, input.specIds],
  );

  const map = new Map<string, SpecAttributionModuleRow[]>();
  for (const row of result.rows) {
    const modules = map.get(row.parameter_spec_id) ?? [];
    const path =
      row.path_names && row.path_names.length > 0 ? row.path_names : [row.name];
    modules.push({ id: row.id, name: row.name, kind: row.kind, path });
    map.set(row.parameter_spec_id, modules);
  }
  return map;
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
  version_status: "draft" | "active" | "superseded" | null;
};

/**
 * Locate a definition by its business identity triple (ADR-0017).
 * Does not re-derive `parameter_specs.id` from the triple — historical ids are surrogates.
 */
export async function findParameterSpecByIdentity(
  db: Queryable,
  input: {
    organizationId: string | null;
    attributionSubjectId: string;
    propertyKey: string;
  },
): Promise<{
  parameterSpecId: string;
  parameterSpecVersionId: string | null;
} | null> {
  const result = await db.query<{ id: string; version_id: string | null }>(
    `
    select ps.id, psv.id as version_id
    from parameter_specs ps
    left join lateral (
      select id
      from parameter_spec_versions
      where parameter_spec_id = ps.id
      order by
        case
          when version_status = 'active' and lifecycle = 'active' then 0
          when version_status = 'active' then 1
          when version_status = 'superseded' then 2
          else 3
        end,
        version desc
      limit 1
    ) psv on true
    where ps.attribution_subject_id = $2
      and coalesce(ps.property_key, '') = $3
      and (
        ($1::text is null and ps.organization_id is null)
        or ps.organization_id = $1
      )
    limit 1
    `,
    [input.organizationId, input.attributionSubjectId, input.propertyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    parameterSpecId: row.id,
    parameterSpecVersionId: row.version_id,
  };
}

export async function getParameterSpecRow(
  db: Queryable,
  input: { organizationId: string; specId: string },
): Promise<ParameterSpecDetailRow | null> {
  const result = await db.query<SpecDetailRow>(
    `
    select
      ps.id,
      ps.organization_id,
      ps.source_kind,
      ps.specification_key,
      coalesce(
        ps.property_key,
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        )
      ) as property_key,
      asub.display_name as driver_module,
      ps.definition_lifecycle as lifecycle,
      ps.attribution_subject_id,
      psv.id as current_version_id,
      psv.version as current_version,
      psv.version_status,
      psv.lifecycle as version_lifecycle,
      psv.display_name,
      psv.description,
      psv.value_shape,
      psv.schema_default,
      psv.example_value,
      dps.schema_namespace,
      coalesce(psv.units, dps.units) as units,
      coalesce(nullif(psv.constraints, '{}'::jsonb), dps.constraints) as constraints,
      coalesce(psv.documentation, dps.documentation) as documentation,
      dsv.compatible_patterns,
      ppt.target_value as policy_target,
      case
        when ps.definition_lifecycle = 'active'
          and psv.version_status = 'active'
          and psv.lifecycle = 'active'
          and psv.active_version_count = 1
          and (ps.source_kind <> 'dts' or ps.property_key is not distinct from dps.property_key)
          and (
            (ps.source_kind <> 'dts'
              and dps.driver_schema_id is null
              and ps.attribution_subject_id is null)
            or (
              asub.subject_kind = 'node-type-definition'
              and (asub.organization_id is null or asub.organization_id = ps.organization_id)
              and node_type_module.id is not null
              and exists (
                select 1
                from node_type_definitions node_type_definition
                where node_type_definition.attribution_subject_id = ps.attribution_subject_id
              )
              and (
                ps.source_kind <> 'dts'
                or (
                  dps.driver_schema_id is not null
                  and property_ds.attribution_subject_id = ps.attribution_subject_id
                  and (property_ds.organization_id is null or property_ds.organization_id = ps.organization_id)
                  and exists (
                    select 1
                    from driver_schema_versions active_schema_version
                    where active_schema_version.driver_schema_id = dps.driver_schema_id
                      and active_schema_version.lifecycle = 'active'
                  )
                )
              )
            )
            or (
              ps.source_kind <> 'dts'
              and dps.driver_schema_id is null
              and ps.attribution_subject_id is not null
              and (asub.organization_id is null or asub.organization_id = ps.organization_id)
              and property_dr.attribution_subject_id is not null
              and drp.id is not null
              and dgm.id is not null
              and dgm.organization_id = $1
              and dgm.kind = 'driver-group'
              and dgm.attribution_subject_id = ps.attribution_subject_id
              and (
                drp.default_business_category_module_id is null
                or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
              )
            )
            or (
              dps.driver_schema_id is not null
              and asub.subject_kind = 'driver-registration'
              and (asub.organization_id is null or asub.organization_id = ps.organization_id)
              and property_ds.attribution_subject_id is not distinct from ps.attribution_subject_id
              and (property_ds.organization_id is null or property_ds.organization_id = ps.organization_id)
              and exists (
                select 1
                from driver_schema_versions active_schema_version
                where active_schema_version.driver_schema_id = dps.driver_schema_id
                  and active_schema_version.lifecycle = 'active'
              )
              and property_dr.attribution_subject_id is not null
              and drp.id is not null
              and dgm.id is not null
              and dgm.organization_id = $1
              and dgm.kind = 'driver-group'
              and dgm.attribution_subject_id = ps.attribution_subject_id
              and (
                drp.default_business_category_module_id is null
                or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
              )
            )
          )
          then case when ps.organization_id = $1 then 'organization' else 'platform' end
        else 'governance'
      end as effective_scope,
      case when coalesce(dgm.id, node_type_module.id) is null then null else jsonb_build_object(
        'moduleId', coalesce(dgm.id, node_type_module.id),
        'moduleName', coalesce(dgm.name, node_type_module.name),
        'categoryId', coalesce(category.id, node_type_category.id),
        'categoryName', coalesce(category.name, node_type_category.name)
      ) end as declared_placement,
      case
        when exists (
          select 1 from project_parameter_bindings observed_binding
          where observed_binding.organization_id = $1
            and observed_binding.parameter_spec_id = ps.id
        ) then 'observed'
        when drp.id is not null or node_type_module.id is not null then 'not-yet-observed'
        else 'unclassified'
      end as observation_state
    from parameter_specs ps
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join lateral (
      select
        psv.*,
        count(*) filter (where psv.version_status = 'active' and psv.lifecycle = 'active') over () as active_version_count
      from parameter_spec_versions psv
      where psv.parameter_spec_id = ps.id
      order by
        case
          when psv.version_status = 'active' and psv.lifecycle = 'active' then 0
          when psv.version_status = 'active' then 1
          when psv.version_status = 'superseded' then 2
          else 3
        end,
        psv.version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join driver_schemas property_ds on property_ds.id = dps.driver_schema_id
    left join driver_registrations property_dr on property_dr.attribution_subject_id = ps.attribution_subject_id
    left join driver_schemas ds on ds.parameter_spec_id = ps.id
    left join lateral (
      select *
      from driver_schema_versions
      where driver_schema_id = ds.id
      order by version desc
      limit 1
    ) dsv on true
    left join driver_registration_placements drp
      on drp.organization_id = $1
     and drp.attribution_subject_id = ps.attribution_subject_id
    left join parameter_modules dgm on dgm.id = drp.driver_group_module_id
    left join parameter_modules category on category.id = drp.default_business_category_module_id
    left join parameter_modules node_type_module
      on node_type_module.organization_id = $1
     and node_type_module.kind = 'node-type'
     and (
       node_type_module.attribution_subject_id = ps.attribution_subject_id
       or lower(coalesce(node_type_module.source_key, '')) = lower(coalesce(asub.source_key, ''))
     )
    left join parameter_modules node_type_category
      on node_type_category.id = node_type_module.parent_id
     and node_type_category.organization_id = node_type_module.organization_id
     and node_type_category.kind = 'business'
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

  const attributionBySpec = await loadAttributionModulesBySpecIds(db, {
    organizationId: input.organizationId,
    specIds: [row.id],
  });
  const referenceCountBySpec = await loadReferenceCountsBySpecIds(db, {
    organizationId: input.organizationId,
    specIds: [row.id],
  });

  return {
    ...toListRow(row),
    attributionModules: attributionBySpec.get(row.id) ?? [],
    referenceCount: referenceCountBySpec.get(row.id) ?? 0,
    displayName: row.display_name,
    description: row.description,
    schemaDefault: row.schema_default ?? null,
    exampleValue: row.example_value ?? null,
    schemaNamespace: row.schema_namespace,
    units: row.units,
    constraints:
      row.constraints &&
      typeof row.constraints === "object" &&
      !Array.isArray(row.constraints)
        ? (row.constraints as Record<string, unknown>)
        : null,
    documentation: row.documentation,
    policyTarget: row.policy_target ?? null,
    versionStatus: row.version_status ?? null,
  };
}

function driverSchemaRootId(driverSchemaId: string): string {
  return driverSchemaId.replace(/:v\d+$/, "");
}

function organizationIdFromOverlayNamespace(
  schemaNamespace: string,
): string | null {
  const match = /^org\/([^/]+)\//.exec(schemaNamespace);
  return match?.[1] ?? null;
}

function compatibleFromOverlayNamespace(
  schemaNamespace: string,
): string | null {
  const match = /^org\/[^/]+\/(.+)$/.exec(schemaNamespace);
  return match?.[1] ?? null;
}

/**
 * Ensure ParameterSpec (+ version) and dts_property_specs rows exist for a matched property.
 * Binding FKs require these rows before createOrReuseBinding / upsertBindingRevisionValues.
 * Org overlay matches write organization-scoped manual specs so they share identity with
 * provisional surface rows (ADR-0008).
 */
export async function upsertMatchedPropertySpec(
  db: Queryable,
  property: PropertySpec,
): Promise<{
  parameterSpecId: string;
  parameterSpecVersionId: string;
  attributionSubjectId: string | null;
}> {
  const overlayOrgId =
    property.source === "manual"
      ? organizationIdFromOverlayNamespace(property.schemaNamespace)
      : null;
  const overlayCompatible = overlayOrgId
    ? compatibleFromOverlayNamespace(property.schemaNamespace)
    : null;

  let attributionSubjectId: string | null = null;
  let driverSchemaId: string | null = property.driverSchemaId
    ? driverSchemaRootId(property.driverSchemaId)
    : null;
  let schemaOrganizationId: string | null = overlayOrgId;

  if (driverSchemaId) {
    const driverSchema = await db.query<{
      id: string;
      organization_id: string | null;
      attribution_subject_id: string | null;
    }>(
      `
      select id, organization_id, attribution_subject_id
      from driver_schemas
      where id = $1
      limit 1
      `,
      [driverSchemaId],
    );
    const schemaRow = driverSchema.rows[0];
    if (!schemaRow?.attribution_subject_id) {
      throw new ApiError(
        "CONFLICT",
        "Cannot materialize a property before its driver schema has a canonical attribution subject.",
        { driverSchemaId, propertyKey: property.propertyKey },
      );
    }
    attributionSubjectId = schemaRow.attribution_subject_id;
    schemaOrganizationId = schemaRow.organization_id;
  }

  let manualIds: ReturnType<typeof buildSubjectScopedManualSpecIds> | null =
    null;
  let parameterSpecId = property.parameterSpecId;
  if (!attributionSubjectId && overlayOrgId && overlayCompatible) {
    attributionSubjectId = await ensureAttributionSubjectForCompatible(db, {
      organizationId: overlayOrgId,
      compatible: overlayCompatible,
    });
    schemaOrganizationId = overlayOrgId;
  }
  if (attributionSubjectId) {
    const existing = await findParameterSpecByIdentity(db, {
      organizationId: schemaOrganizationId,
      attributionSubjectId,
      propertyKey: property.propertyKey,
    });
    if (existing) {
      parameterSpecId = existing.parameterSpecId;
    } else {
      // A matched property is owned by its canonical subject, regardless of
      // whether the source is a platform DTS schema or an organization
      // overlay. CommonRefs clones carry the common document's parameterSpecId;
      // only retain the loader id when it is already scoped to this concrete
      // driver namespace. Otherwise mint the durable owner+subject+property
      // surrogate so two concrete drivers cannot merge on a shared shape.
      const driverScopedLoaderId = `pspec:${property.schemaNamespace}:${property.propertyKey}`;
      const commonShapeId =
        property.parameterSpecId.startsWith("pspec:common/") ||
        property.id.startsWith("propspec:common/");
      if (commonShapeId || parameterSpecId !== driverScopedLoaderId) {
        manualIds = buildSubjectScopedManualSpecIds({
          organizationId: schemaOrganizationId,
          attributionSubjectId,
          propertyKey: property.propertyKey,
        });
        parameterSpecId = manualIds.parameterSpecId;
      }
    }
  }

  // Migration 0120 enforces one active ParameterSpecVersion per definition.
  // Property catalog sync can advance an existing definition from vN to vN+1,
  // so serialize the transition and retire the previous active version before
  // inserting/promoting the successor. Replaying the same active version is
  // idempotent; draft/deprecated syncs never demote an already active version.
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [
    parameterSpecId,
  ]);
  const existingVersion = await db.query<{
    id: string;
    version_status: string;
    lifecycle: string;
  }>(
    `select id, version_status, lifecycle
     from parameter_spec_versions
     where parameter_spec_id = $1 and version = $2
     limit 1`,
    [parameterSpecId, property.version ?? 1],
  );
  const existingVersionRow = existingVersion.rows[0];
  // A vendor catalog can replay a draft/deprecated source row after a newer
  // active version is already installed. Never let that replay demote the
  // active row for the same definition; explicit lifecycle transitions use
  // the parameter-spec workflow instead.
  const preserveExistingActiveVersion =
    property.lifecycle !== "active" &&
    existingVersionRow?.version_status === "active" &&
    existingVersionRow.lifecycle === "active";
  if (property.lifecycle === "active") {
    const sameVersionIsActive =
      existingVersionRow?.version_status === "active" &&
      existingVersionRow?.lifecycle === "active";
    if (!sameVersionIsActive) {
      await db.query(
        `update parameter_spec_versions
         set version_status = 'superseded', lifecycle = 'deprecated'
         where parameter_spec_id = $1
           and version_status = 'active'`,
        [parameterSpecId],
      );
    }
  }
  let parameterSpecVersionId = existingVersionRow?.id ?? property.id;
  const conflictingVersion = await db.query<{ parameter_spec_id: string }>(
    `select parameter_spec_id from parameter_spec_versions where id = $1 limit 1`,
    [parameterSpecVersionId],
  );
  if (
    conflictingVersion.rows[0] &&
    conflictingVersion.rows[0].parameter_spec_id !== parameterSpecId
  ) {
    parameterSpecVersionId = `${property.id}:${parameterSpecId}`;
  }

  const existingDtsPropertySpec = await db.query<{ id: string }>(
    `select id from dts_property_specs where parameter_spec_id = $1 limit 1`,
    [parameterSpecId],
  );
  const dtsPropertySpecId =
    existingDtsPropertySpec.rows[0]?.id ??
    manualIds?.dtsPropertySpecId ??
    `dps:${parameterSpecId}`;

  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (id) do update set
      attribution_subject_id = coalesce(parameter_specs.attribution_subject_id, excluded.attribution_subject_id),
      property_key = coalesce(parameter_specs.property_key, excluded.property_key)
    `,
    [
      parameterSpecId,
      schemaOrganizationId,
      schemaOrganizationId ? "manual" : "dts",
      manualIds?.specificationKey ??
        `${property.schemaNamespace}/${property.propertyKey}`,
      property.lifecycle === "deprecated"
        ? "deprecated"
        : property.lifecycle === "active"
          ? "active"
          : "draft",
      attributionSubjectId,
      property.propertyKey,
    ],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle, version_status,
      units, constraints, documentation
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb, $13)
    on conflict (parameter_spec_id, version) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      value_shape = excluded.value_shape,
      schema_default = excluded.schema_default,
      example_value = excluded.example_value,
      lifecycle = excluded.lifecycle,
      version_status = excluded.version_status,
      units = excluded.units,
      constraints = excluded.constraints,
      documentation = excluded.documentation
    `,
    [
      parameterSpecVersionId,
      parameterSpecId,
      property.version ?? 1,
      property.propertyKey,
      property.documentation ?? property.propertyKey,
      JSON.stringify(property.valueShape),
      property.schemaDefault === undefined
        ? null
        : JSON.stringify(property.schemaDefault),
      property.exampleValue === undefined
        ? null
        : JSON.stringify(property.exampleValue),
      preserveExistingActiveVersion ? "active" : property.lifecycle,
      preserveExistingActiveVersion
        ? "active"
        : property.lifecycle === "deprecated"
          ? "superseded"
          : property.lifecycle,
      property.units ?? null,
      JSON.stringify(property.constraints ?? {}),
      property.documentation ?? null,
    ],
  );

  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    on conflict (id) do update set
      property_key = excluded.property_key,
      schema_namespace = excluded.schema_namespace,
      units = excluded.units,
      constraints = excluded.constraints,
      documentation = excluded.documentation,
      driver_schema_id = coalesce(dts_property_specs.driver_schema_id, excluded.driver_schema_id)
    `,
    [
      dtsPropertySpecId,
      parameterSpecId,
      driverSchemaId,
      property.propertyKey,
      property.driverSchemaId
        ? property.schemaNamespace
        : (manualIds?.schemaNamespace ?? property.schemaNamespace),
      property.units ?? null,
      JSON.stringify(property.constraints ?? {}),
      property.documentation ?? null,
    ],
  );

  return {
    parameterSpecId,
    parameterSpecVersionId,
    attributionSubjectId,
  };
}

/**
 * Ensure driver_schemas (+ version) rows exist so logical node revisions can store
 * driver_schema_version_id for continuity evidence.
 */
export async function upsertMatchedDriverSchema(
  db: Queryable,
  driver: DriverSchema,
): Promise<{
  driverSchemaId: string;
  driverSchemaVersionId: string;
  attributionSubjectId: string;
}> {
  const rootId = driverSchemaRootId(driver.id);
  const overlayOrgId =
    driver.source === "manual"
      ? organizationIdFromOverlayNamespace(driver.schemaNamespace)
      : null;
  const driverParamSpecId = `pspec:driver:${driver.schemaNamespace}`;
  let driverParamVersionId = `psv:driver:${driver.schemaNamespace}:v${driver.version}`;
  const attributionSubjectId = await ensureAttributionSubjectForDriverSchema(
    db,
    {
      organizationId: overlayOrgId,
      compatible: driver.compatiblePatterns[0] ?? null,
      nodename: driver.nodenamePatterns[0] ?? null,
      displayName: driver.compatible,
    },
  );

  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key, attribution_subject_id
    ) values ($1, $2, $3, $4, $5)
    on conflict (id) do update set
      attribution_subject_id = coalesce(parameter_specs.attribution_subject_id, excluded.attribution_subject_id)
    `,
    [
      driverParamSpecId,
      overlayOrgId,
      overlayOrgId ? "manual" : "dts",
      `driver/${driver.schemaNamespace}`,
      attributionSubjectId,
    ],
  );

  // Migration 0120 enforces one active ParameterSpecVersion per definition.
  // Schema registry sync is allowed to advance a driver from vN to vN+1, so
  // serialize that transition and retire the previous active version before
  // inserting/promoting the new one. Replaying the same version is idempotent;
  // draft/deprecated syncs never demote an already active version.
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [
    driverParamSpecId,
  ]);
  const existingVersion = await db.query<{
    id: string;
    version_status: string;
    lifecycle: string;
  }>(
    `select id, version_status, lifecycle
     from parameter_spec_versions
     where parameter_spec_id = $1 and version = $2
     limit 1`,
    [driverParamSpecId, driver.version],
  );
  const existingVersionRow = existingVersion.rows[0];
  if (driver.lifecycle === "active") {
    const sameVersionIsActive =
      existingVersionRow?.version_status === "active" &&
      existingVersionRow?.lifecycle === "active";
    if (!sameVersionIsActive) {
      await db.query(
        `update parameter_spec_versions
         set version_status = 'superseded', lifecycle = 'deprecated'
         where parameter_spec_id = $1
           and version_status = 'active'`,
        [driverParamSpecId],
      );
    }
  }

  if (existingVersionRow) {
    driverParamVersionId = existingVersionRow.id;
    if (driver.lifecycle === "active") {
      await db.query(
        `update parameter_spec_versions
         set display_name = $2,
             description = $3,
             value_shape = $4::jsonb,
             lifecycle = 'active',
             version_status = 'active'
         where id = $1`,
        [
          existingVersionRow.id,
          driver.compatible,
          `Driver schema ${driver.schemaNamespace}`,
          JSON.stringify({ kind: "unknown" }),
        ],
      );
    }
  } else {
    await db.query(
      `
      insert into parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        schema_default, example_value, lifecycle
      ) values ($1, $2, $3, $4, $5, $6::jsonb, null, null, $7)
      on conflict (parameter_spec_id, version) do nothing
      `,
      [
        driverParamVersionId,
        driverParamSpecId,
        driver.version,
        driver.compatible,
        `Driver schema ${driver.schemaNamespace}`,
        JSON.stringify({ kind: "unknown" }),
        driver.lifecycle,
      ],
    );
  }
  const persistedVersion = await db.query<{ id: string }>(
    `select id from parameter_spec_versions where parameter_spec_id = $1 and version = $2 limit 1`,
    [driverParamSpecId, driver.version],
  );
  if (!persistedVersion.rows[0]?.id) {
    throw new ApiError(
      "CONFLICT",
      "Driver schema version could not be materialized.",
      { driverSchemaId: rootId, version: driver.version },
    );
  }
  driverParamVersionId = persistedVersion.rows[0].id;
  await db.query(
    `
    insert into driver_schemas (
      id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id
    ) values ($1, $2, $3, $4, $5)
    on conflict (id) do update set
      attribution_subject_id = coalesce(driver_schemas.attribution_subject_id, excluded.attribution_subject_id)
    `,
    [
      rootId,
      driverParamSpecId,
      overlayOrgId,
      driver.schemaNamespace,
      attributionSubjectId,
    ],
  );
  await db.query(
    `
    insert into driver_schema_versions (
      id, driver_schema_id, parameter_spec_version_id, version,
      compatible_patterns, parent_bus_constraints, source, lifecycle
    ) values ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, $6, $7)
    on conflict (id) do nothing
    `,
    [
      driver.id,
      rootId,
      driverParamVersionId,
      driver.version,
      JSON.stringify(driver.compatiblePatterns),
      driver.source,
      driver.lifecycle,
    ],
  );

  return {
    driverSchemaId: rootId,
    driverSchemaVersionId: driver.id,
    attributionSubjectId,
  };
}
