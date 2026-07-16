import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { DriverSchema, PropertySpec, SpecReviewTaskDraft } from "./types";

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
  const evidence = input.draft.sourceEvidence ?? {};
  const projectId =
    input.draft.projectId ??
    (typeof evidence.projectId === "string" && evidence.projectId.trim() ? evidence.projectId : null);
  const configRevisionId =
    input.draft.configRevisionId ??
    (typeof evidence.configRevisionId === "string" && evidence.configRevisionId.trim()
      ? evidence.configRevisionId
      : null);
  const propertyOccurrenceId =
    input.draft.propertyOccurrenceId ??
    (typeof evidence.propertyOccurrenceId === "string" && evidence.propertyOccurrenceId.trim()
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
): Promise<{ items: PersistedSpecReviewTask[]; nextCursor: SpecReviewTaskListCursor | null }> {
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
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
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
  return [...compatible].map((item) => item.trim()).filter(Boolean).sort().join("\0");
}

/** Normalized node locator fingerprint for matcher override scope. */
export function nodeLocatorFingerprint(nodeLocator?: string | null): string {
  const normalized = (nodeLocator ?? "").trim().replace(/\/+/g, "/").replace(/\/$/, "");
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

export function persistedMatcherOverrideLookupKey(override: PersistedMatcherOverride): string {
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
      404,
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
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", 404, {
      projectId: input.projectId,
    });
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
      404,
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
      404,
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
      404,
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
export async function backfillReviewTaskScopeColumns(db: Queryable): Promise<number> {
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
  input: { organizationId: string; projectId: string; configRevisionId: string },
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
    organizationId: row.organization_id,
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
    conditions.push(`(
      case
        when cardinality(string_to_array(ps.specification_key, '/')) >= 3
          then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
        else split_part(ps.specification_key, '/', 1)
      end
    ) = $${values.length}`);
  }
  if (input.propertyKey) {
    values.push(input.propertyKey);
    conditions.push(`coalesce(
      dps.property_key,
      (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))]
    ) = $${values.length}`);
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
      ps.organization_id,
      ps.source_kind,
      ps.specification_key,
      coalesce(
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        )
      ) as property_key,
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      ) as driver_module,
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
      ps.organization_id,
      ps.source_kind,
      ps.specification_key,
      coalesce(
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        )
      ) as property_key,
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      ) as driver_module,
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

function driverSchemaRootId(driverSchemaId: string): string {
  return driverSchemaId.replace(/:v\d+$/, "");
}

/**
 * Ensure ParameterSpec (+ version) and dts_property_specs rows exist for a matched property.
 * Binding FKs require these rows before createOrReuseBinding / upsertBindingRevisionValues.
 */
export async function upsertMatchedPropertySpec(
  db: Queryable,
  property: PropertySpec,
): Promise<{ parameterSpecId: string; parameterSpecVersionId: string }> {
  const specificationKey = `${property.schemaNamespace}/${property.propertyKey}`;
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, null, 'dts', $2)
    on conflict (id) do nothing
    `,
    [property.parameterSpecId, specificationKey],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
    on conflict (id) do nothing
    `,
    [
      property.id,
      property.parameterSpecId,
      property.propertyKey,
      property.documentation ?? property.propertyKey,
      JSON.stringify(property.valueShape),
      property.schemaDefault === undefined ? null : JSON.stringify(property.schemaDefault),
      property.exampleValue === undefined ? null : JSON.stringify(property.exampleValue),
      property.lifecycle,
    ],
  );

  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    on conflict (id) do nothing
    `,
    [
      `dps:${property.parameterSpecId}`,
      property.parameterSpecId,
      // Prefer null here; callers upsert drivers first and may patch later.
      // Avoid FK failures when driver_schemas row is not yet present.
      null,
      property.propertyKey,
      property.schemaNamespace,
      property.units ?? null,
      JSON.stringify(property.constraints ?? {}),
      property.documentation ?? null,
    ],
  );

  return {
    parameterSpecId: property.parameterSpecId,
    parameterSpecVersionId: property.id,
  };
}

/**
 * Ensure driver_schemas (+ version) rows exist so logical node revisions can store
 * driver_schema_version_id for continuity evidence.
 */
export async function upsertMatchedDriverSchema(
  db: Queryable,
  driver: DriverSchema,
): Promise<{ driverSchemaId: string; driverSchemaVersionId: string }> {
  const rootId = driverSchemaRootId(driver.id);
  const driverParamSpecId = `pspec:driver:${driver.schemaNamespace}`;
  const driverParamVersionId = `psv:driver:${driver.schemaNamespace}:v${driver.version}`;

  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, null, 'dts', $2)
    on conflict (id) do nothing
    `,
    [driverParamSpecId, `driver/${driver.schemaNamespace}`],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, $3, $4, $5, $6::jsonb, null, null, $7)
    on conflict (id) do nothing
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
  await db.query(
    `
    insert into driver_schemas (id, parameter_spec_id, organization_id, schema_namespace)
    values ($1, $2, null, $3)
    on conflict (id) do nothing
    `,
    [rootId, driverParamSpecId, driver.schemaNamespace],
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

  return { driverSchemaId: rootId, driverSchemaVersionId: driver.id };
}
