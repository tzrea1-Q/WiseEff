/**
 * Stable project×logical-node×parameter-spec bindings and identity mapping tasks.
 *
 * Value split (no “recommended value” field):
 * - effective typed/canonical/raw → project_parameter_binding_revisions
 * - schemaDefault → parameter_spec_versions / PropertySpec
 * - policyTarget → parameter_policy_targets
 */

import { randomUUID } from "node:crypto";

import {
  matchLogicalNode,
  type LogicalNodeCandidate,
  type LogicalNodeSnapshot,
} from "../dts/identity";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { updateConfigRevisionStatus } from "./repository";
import type { ConfigRevisionStatus } from "./types";

export type ProjectPropertyBindingKey = {
  projectId: string;
  logicalNodeId: string | null;
  parameterSpecId: string;
  /** Durable v1 business module. Identity/reuse is keyed on this 4-tuple (phase 2, §5.1). */
  moduleId: string;
};

export type BindingRevisionValues = {
  typedValue: unknown;
  canonicalValue?: unknown;
  rawValue?: string;
  schemaState?: string;
  policyState?: string;
  /** Illustrative only when surfaced — stored on the spec version, not here. */
  schemaDefault?: unknown;
  /** Organization/product target — stored in parameter_policy_targets, not here. */
  policyTarget?: unknown;
};

export type ProjectParameterBinding = {
  id: string;
  organizationId: string;
  projectId: string;
  logicalNodeId: string | null;
  parameterSpecId: string;
  moduleId: string;
  createdAt: string;
};

export type ProjectParameterBindingRevision = {
  id: string;
  bindingId: string;
  configRevisionId: string;
  parameterSpecVersionId: string;
  typedValue: unknown;
  canonicalValue?: unknown;
  rawValue?: string;
  schemaState?: string;
  policyState?: string;
  createdAt: string;
};

export type IdentityMappingTask = {
  id: string;
  organizationId: string;
  projectId: string;
  configRevisionId: string;
  previousLogicalNodeId: string | null;
  candidateLogicalNodeIds: string[];
  evidence: Record<string, unknown>;
  taskKind: "identity-ambiguity" | "singleton-cardinality";
  status: "open" | "resolved" | "dismissed" | "new_identity";
  reviewerUserId?: string;
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ContinuityMatched = {
  kind: "matched";
  /** Stable identity preserved across revisions. */
  stableLogicalNodeId: string;
  candidateLogicalNodeId: string;
  evidence: string[];
  blocksRevision: false;
};

export type ContinuityAmbiguous = {
  kind: "ambiguous";
  candidates: LogicalNodeCandidate[];
  evidence: string[];
  blocksRevision: true;
  revisionStatus: "needs_mapping";
};

export type ContinuityUnmatched = {
  kind: "unmatched";
  evidence: string[];
  blocksRevision: false;
  /** New logical node identity should be allocated by the caller. */
  allocateNewLogicalNode: true;
};

export type ContinuityResult = ContinuityMatched | ContinuityAmbiguous | ContinuityUnmatched;

export function bindingKey(key: ProjectPropertyBindingKey): string {
  return `${key.projectId}\0${key.logicalNodeId ?? ""}\0${key.parameterSpecId}\0${key.moduleId}`;
}

/**
 * Resolve continuity for one previous logical node against new-revision candidates.
 * Matched → reuse previous.logicalNodeId; ambiguous → block revision as needs_mapping.
 */
export function resolveLogicalContinuity(
  previous: LogicalNodeSnapshot,
  candidates: LogicalNodeCandidate[],
): ContinuityResult {
  const decision = matchLogicalNode(previous, candidates);

  if (decision.kind === "matched") {
    return {
      kind: "matched",
      stableLogicalNodeId: previous.logicalNodeId,
      candidateLogicalNodeId: decision.value.logicalNodeId,
      evidence: decision.evidence,
      blocksRevision: false,
    };
  }

  if (decision.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      candidates: decision.candidates,
      evidence: decision.evidence,
      blocksRevision: true,
      revisionStatus: "needs_mapping",
    };
  }

  return {
    kind: "unmatched",
    evidence: decision.evidence,
    blocksRevision: false,
    allocateNewLogicalNode: true,
  };
}

type BindingRow = {
  id: string;
  organization_id: string;
  project_id: string;
  logical_node_id: string | null;
  parameter_spec_id: string;
  module_id: string;
  created_at: string | Date;
};

type BindingRevisionRow = {
  id: string;
  binding_id: string;
  config_revision_id: string;
  parameter_spec_version_id: string;
  typed_value: unknown;
  canonical_value: unknown;
  raw_value: string | null;
  schema_state: string | null;
  policy_state: string | null;
  created_at: string | Date;
};

type IdentityMappingTaskRow = {
  id: string;
  organization_id: string;
  project_id: string;
  config_revision_id: string;
  previous_logical_node_id: string | null;
  candidate_logical_node_ids: unknown;
  evidence: unknown;
  task_kind: "identity-ambiguity" | "singleton-cardinality";
  status: "open" | "resolved" | "dismissed" | "new_identity";
  reviewer_user_id: string | null;
  reason: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toBinding(row: BindingRow): ProjectParameterBinding {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    logicalNodeId: row.logical_node_id,
    parameterSpecId: row.parameter_spec_id,
    moduleId: row.module_id,
    createdAt: dateTimeToIso(row.created_at),
  };
}

function toBindingRevision(row: BindingRevisionRow): ProjectParameterBindingRevision {
  return {
    id: row.id,
    bindingId: row.binding_id,
    configRevisionId: row.config_revision_id,
    parameterSpecVersionId: row.parameter_spec_version_id,
    typedValue: row.typed_value,
    canonicalValue: row.canonical_value ?? undefined,
    rawValue: row.raw_value ?? undefined,
    schemaState: row.schema_state ?? undefined,
    policyState: row.policy_state ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toMappingTask(row: IdentityMappingTaskRow): IdentityMappingTask {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    configRevisionId: row.config_revision_id,
    previousLogicalNodeId: row.previous_logical_node_id,
    candidateLogicalNodeIds: parseJsonArray(row.candidate_logical_node_ids),
    evidence:
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : typeof row.evidence === "string"
          ? (JSON.parse(row.evidence) as Record<string, unknown>)
          : {},
    taskKind: row.task_kind,
    status: row.status,
    reviewerUserId: row.reviewer_user_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
  };
}

export async function findBindingByKey(
  db: Queryable,
  input: { organizationId: string } & ProjectPropertyBindingKey,
): Promise<ProjectParameterBinding | null> {
  const result = await db.query<BindingRow>(
    `
    select id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id, created_at
    from project_parameter_bindings
    where organization_id = $1
      and project_id = $2
      and logical_node_id is not distinct from $3
      and parameter_spec_id = $4
      and module_id = $5
    limit 1
    `,
    [
      input.organizationId,
      input.projectId,
      input.logicalNodeId,
      input.parameterSpecId,
      input.moduleId,
    ],
  );
  const row = result.rows[0];
  return row ? toBinding(row) : null;
}

export async function createOrReuseBinding(
  db: Queryable,
  input: {
    organizationId: string;
    key: ProjectPropertyBindingKey;
    id?: string;
  },
): Promise<ProjectParameterBinding> {
  const existing = await findBindingByKey(db, {
    organizationId: input.organizationId,
    ...input.key,
  });
  if (existing) return existing;

  const id = input.id ?? randomUUID();
  const result = await db.query<BindingRow>(
    `
    insert into project_parameter_bindings (
      id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id
    ) values ($1, $2, $3, $4, $5, $6)
    returning id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id, created_at
    `,
    [
      id,
      input.organizationId,
      input.key.projectId,
      input.key.logicalNodeId,
      input.key.parameterSpecId,
      input.key.moduleId,
    ],
  );
  return toBinding(result.rows[0]);
}

/**
 * Store effective values on the binding revision only.
 * schemaDefault / policyTarget / exampleValue must not be written here.
 */
export async function upsertBindingRevisionValues(
  db: Queryable,
  input: {
    bindingId: string;
    configRevisionId: string;
    parameterSpecVersionId: string;
    values: BindingRevisionValues;
    id?: string;
    tenant?: {
      organizationId: string;
      projectId: string;
      configRevisionId: string;
    };
  },
): Promise<ProjectParameterBindingRevision> {
  if (input.tenant) {
    const scope = await db.query<{ id: string }>(
      `
      select b.id
      from project_parameter_bindings b
      inner join dts_config_revisions cr on cr.id = $4
      inner join projects p on p.id = cr.project_id and p.organization_id = $1
      where b.id = $2
        and b.organization_id = $1
        and b.project_id = $3
        and cr.organization_id = $1
        and cr.project_id = $3
        and cr.id = $4
      limit 1
      `,
      [
        input.tenant.organizationId,
        input.bindingId,
        input.tenant.projectId,
        input.tenant.configRevisionId,
      ],
    );
    if (!scope.rows[0]) {
      throw new ApiError(
        "NOT_FOUND",
        "Project parameter binding revision could not be verified for this organization.",
        { bindingId: input.bindingId, configRevisionId: input.configRevisionId },
      );
    }
  }
  const id = input.id ?? randomUUID();
  const result = await db.query<BindingRevisionRow>(
    `
    insert into project_parameter_binding_revisions (
      id, binding_id, config_revision_id, parameter_spec_version_id,
      typed_value, canonical_value, raw_value, schema_state, policy_state
    ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
    on conflict (binding_id, config_revision_id) do update set
      parameter_spec_version_id = excluded.parameter_spec_version_id,
      typed_value = excluded.typed_value,
      canonical_value = excluded.canonical_value,
      raw_value = excluded.raw_value,
      schema_state = excluded.schema_state,
      policy_state = excluded.policy_state
    returning *
    `,
    [
      id,
      input.bindingId,
      input.configRevisionId,
      input.parameterSpecVersionId,
      JSON.stringify(input.values.typedValue),
      input.values.canonicalValue === undefined
        ? null
        : JSON.stringify(input.values.canonicalValue),
      input.values.rawValue ?? null,
      input.values.schemaState ?? null,
      input.values.policyState ?? null,
    ],
  );
  return toBindingRevision(result.rows[0]);
}

/**
 * Persist an open identity mapping task and flip the revision to needs_mapping.
 */
export async function persistAmbiguousIdentityMapping(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    previous: LogicalNodeSnapshot;
    continuity: ContinuityAmbiguous;
    reason?: string;
    reviewerUserId?: string;
    id?: string;
  },
): Promise<IdentityMappingTask> {
  const id = input.id ?? randomUUID();
  const evidence = {
    previousLogicalNodeId: input.previous.logicalNodeId,
    previousNodeLocator: input.previous.nodeLocator,
    evidence: input.continuity.evidence,
    candidates: input.continuity.candidates.map((candidate) => ({
      logicalNodeId: candidate.logicalNodeId,
      nodeLocator: candidate.nodeLocator,
      name: candidate.name,
      unitAddress: candidate.unitAddress,
    })),
  };

  const result = await db.query<IdentityMappingTaskRow>(
    `
    insert into identity_mapping_tasks (
      id, organization_id, project_id, config_revision_id,
      previous_logical_node_id, candidate_logical_node_ids, evidence,
      status, reviewer_user_id, reason
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
    returning *
    `,
    [
      id,
      input.organizationId,
      input.projectId,
      input.configRevisionId,
      input.previous.logicalNodeId,
      JSON.stringify(input.continuity.candidates.map((candidate) => candidate.logicalNodeId)),
      JSON.stringify(evidence),
      "open",
      input.reviewerUserId ?? null,
      input.reason ?? null,
    ],
  );

  const status: ConfigRevisionStatus = "needs_mapping";
  await updateConfigRevisionStatus(db, {
    id: input.configRevisionId,
    status,
  });

  return toMappingTask(result.rows[0]);
}

export async function getIdentityMappingTaskById(
  db: Queryable,
  input: { organizationId: string; taskId: string },
): Promise<IdentityMappingTask | null> {
  const result = await db.query<IdentityMappingTaskRow>(
    `
    select *
    from identity_mapping_tasks
    where id = $1 and organization_id = $2
    limit 1
    `,
    [input.taskId, input.organizationId],
  );
  const row = result.rows[0];
  return row ? toMappingTask(row) : null;
}

export async function listIdentityMappingTaskRows(
  db: Queryable,
  input: {
    organizationId: string;
    projectId?: string;
    status?: "open" | "resolved" | "dismissed" | "new_identity";
  },
): Promise<IdentityMappingTask[]> {
  const values: unknown[] = [input.organizationId];
  const conditions = ["organization_id = $1"];
  if (input.projectId) {
    values.push(input.projectId);
    conditions.push(`project_id = $${values.length}`);
  }
  if (input.status) {
    values.push(input.status);
    conditions.push(`status = $${values.length}`);
  }
  const result = await db.query<IdentityMappingTaskRow>(
    `
    select *
    from identity_mapping_tasks
    where ${conditions.join(" and ")}
    order by created_at asc
    `,
    values,
  );
  return result.rows.map(toMappingTask);
}

export async function lockOpenIdentityMappingTask(
  db: Queryable,
  input: { organizationId: string; taskId: string },
): Promise<IdentityMappingTask | null> {
  const result = await db.query<IdentityMappingTaskRow>(
    `
    select *
    from identity_mapping_tasks
    where id = $1 and organization_id = $2 and status = 'open'
    for update
    `,
    [input.taskId, input.organizationId],
  );
  const row = result.rows[0];
  return row ? toMappingTask(row) : null;
}

export async function countOpenIdentityMappingTasksForRevision(
  db: Queryable,
  input: { organizationId: string; configRevisionId: string },
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from identity_mapping_tasks
    where organization_id = $1
      and config_revision_id = $2
      and status = 'open'
    `,
    [input.organizationId, input.configRevisionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * A mapping task blocks semantic release while it is untriaged/rejected. This
 * includes persisted singleton-cardinality conflicts, which are represented by
 * the same blocking-task queue and cannot be cleared by selecting one instance.
 */
export async function countBlockingIdentityMappingTasksForRevision(
  db: Queryable,
  input: { organizationId: string; configRevisionId: string },
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from identity_mapping_tasks
    where organization_id = $1
      and config_revision_id = $2
      and status in ('open', 'dismissed')
    `,
    [input.organizationId, input.configRevisionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

type SingletonInstanceRow = {
  attribution_subject_id: string;
  display_name: string;
  logical_node_id: string;
  node_locator: string;
  name: string;
  unit_address: string | null;
  compatible: string | null;
};

/**
 * Reconcile persisted singleton-per-project conflicts for one revision. The
 * source instances are never collapsed: the task records all candidates and
 * release gates fail closed until the registration/topology is corrected.
 */
export async function syncSingletonCardinalityBlockingTasks(
  db: Queryable,
  input: { organizationId: string; projectId: string; configRevisionId: string },
): Promise<number> {
  const result = await db.query<SingletonInstanceRow>(
    `
    select
      pm.attribution_subject_id,
      subject.display_name,
      lnr.logical_node_id,
      lnr.node_locator,
      lnr.name,
      lnr.unit_address,
      lnr.compatible
    from dts_logical_node_revisions lnr
    inner join dts_config_revisions cr
      on cr.id = lnr.config_revision_id
     and cr.organization_id = $1
     and cr.project_id = $2
    inner join parameter_module_mappings mapping
      on mapping.organization_id = $1
     and mapping.match_kind = 'compatible'
     and lower(trim(both '"' from trim(both '''' from trim(mapping.match_value))))
       = lower(trim(both '"' from trim(both '''' from trim(coalesce(lnr.compatible, '')))))
    inner join parameter_modules pm
      on pm.id = mapping.parameter_module_id
     and pm.organization_id = $1
     and pm.attribution_subject_id is not null
    inner join attribution_subjects subject
      on subject.id = pm.attribution_subject_id
    inner join driver_registrations registration
      on registration.attribution_subject_id = subject.id
     and registration.instance_cardinality = 'singleton-per-project'
    where lnr.config_revision_id = $3
    order by pm.attribution_subject_id, lnr.node_locator, lnr.logical_node_id
    `,
    [input.organizationId, input.projectId, input.configRevisionId],
  );

  const bySubject = new Map<string, SingletonInstanceRow[]>();
  for (const row of result.rows) {
    const instances = bySubject.get(row.attribution_subject_id) ?? [];
    if (!instances.some((instance) => instance.logical_node_id === row.logical_node_id)) {
      instances.push(row);
    }
    bySubject.set(row.attribution_subject_id, instances);
  }
  const conflicts = [...bySubject.entries()].filter(([, instances]) => instances.length > 1);
  const conflictSubjectIds = conflicts.map(([subjectId]) => subjectId);

  await db.query(
    `
    update identity_mapping_tasks
    set status = 'resolved',
        reason = 'singleton cardinality conflict cleared',
        resolved_at = now()
    where organization_id = $1
      and project_id = $2
      and config_revision_id = $3
      and task_kind = 'singleton-cardinality'
      and status in ('open', 'dismissed')
      and (
        cardinality($4::text[]) = 0
        or coalesce(evidence->>'attributionSubjectId', '') <> all($4::text[])
      )
    `,
    [input.organizationId, input.projectId, input.configRevisionId, conflictSubjectIds],
  );

  for (const [subjectId, instances] of conflicts) {
    const evidence = {
      blockerKind: "singleton-cardinality",
      attributionSubjectId: subjectId,
      displayName: instances[0]?.display_name ?? subjectId,
      instanceCardinality: "singleton-per-project",
      instanceCount: instances.length,
      candidates: instances.map((instance) => ({
        logicalNodeId: instance.logical_node_id,
        nodeLocator: instance.node_locator,
        name: instance.name,
        unitAddress: instance.unit_address,
        compatible: instance.compatible,
      })),
    };
    const existing = await db.query<{ id: string }>(
      `
      select id
      from identity_mapping_tasks
      where organization_id = $1
        and config_revision_id = $2
        and task_kind = 'singleton-cardinality'
        and evidence->>'attributionSubjectId' = $3
      limit 1
      `,
      [input.organizationId, input.configRevisionId, subjectId],
    );
    if (existing.rows[0]) {
      await db.query(
        `
        update identity_mapping_tasks
        set candidate_logical_node_ids = $2::jsonb,
            evidence = $3::jsonb,
            status = 'open',
            reviewer_user_id = null,
            reason = 'singleton-per-project registration has multiple instances',
            resolved_at = null
        where id = $1
        `,
        [
          existing.rows[0].id,
          JSON.stringify(instances.map((instance) => instance.logical_node_id)),
          JSON.stringify(evidence),
        ],
      );
    } else {
      await db.query(
        `
        insert into identity_mapping_tasks (
          id, organization_id, project_id, config_revision_id,
          previous_logical_node_id, candidate_logical_node_ids, evidence,
          task_kind, status, reason
        ) values ($1, $2, $3, $4, null, $5::jsonb, $6::jsonb,
          'singleton-cardinality', 'open',
          'singleton-per-project registration has multiple instances')
        `,
        [
          randomUUID(),
          input.organizationId,
          input.projectId,
          input.configRevisionId,
          JSON.stringify(instances.map((instance) => instance.logical_node_id)),
          JSON.stringify(evidence),
        ],
      );
    }
  }

  return conflicts.length;
}

/**
 * True when the selected candidate logical node belongs to the same org/project/revision.
 */
export async function selectedCandidateBelongsToRevision(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    selectedLogicalNodeId: string;
  },
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `
    select lnr.id
    from dts_logical_node_revisions lnr
    inner join dts_logical_nodes ln on ln.id = lnr.logical_node_id
    inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
    where lnr.logical_node_id = $1
      and lnr.config_revision_id = $2
      and ln.organization_id = $3
      and ln.project_id = $4
      and cr.organization_id = $3
      and cr.project_id = $4
    limit 1
    `,
    [
      input.selectedLogicalNodeId,
      input.configRevisionId,
      input.organizationId,
      input.projectId,
    ],
  );
  return Boolean(result.rows[0]);
}

/**
 * Apply a reviewed continuity choice: remap the selected candidate onto the previous
 * stable logical identity, then reuse/create bindings and recompute binding revisions
 * for affected properties on this config revision.
 */
export async function applyReviewedIdentityMapping(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    previousLogicalNodeId: string | null;
    selectedLogicalNodeId: string;
  },
): Promise<void> {
  const stableLogicalNodeId = input.previousLogicalNodeId ?? input.selectedLogicalNodeId;

  const provisionalRevisions = await db.query<{
    id: string;
    binding_id: string;
    parameter_spec_id: string;
    module_id: string;
    parameter_spec_version_id: string;
    typed_value: unknown;
    canonical_value: unknown;
    raw_value: string | null;
    schema_state: string | null;
    policy_state: string | null;
  }>(
    `
    select
      br.id,
      br.binding_id,
      b.parameter_spec_id,
      b.module_id,
      br.parameter_spec_version_id,
      br.typed_value,
      br.canonical_value,
      br.raw_value,
      br.schema_state,
      br.policy_state
    from project_parameter_binding_revisions br
    inner join project_parameter_bindings b on b.id = br.binding_id
    where br.config_revision_id = $1
      and b.project_id = $2
      and b.logical_node_id = $3
    `,
    [input.configRevisionId, input.projectId, input.selectedLogicalNodeId],
  );

  if (stableLogicalNodeId !== input.selectedLogicalNodeId) {
    await db.query(
      `
      update dts_logical_node_revisions
      set parent_logical_node_id = $3
      where config_revision_id = $1
        and parent_logical_node_id = $2
      `,
      [input.configRevisionId, input.selectedLogicalNodeId, stableLogicalNodeId],
    );

    await db.query(
      `
      update dts_logical_node_revisions
      set logical_node_id = $3
      where config_revision_id = $1
        and logical_node_id = $2
      `,
      [input.configRevisionId, input.selectedLogicalNodeId, stableLogicalNodeId],
    );
  }

  for (const row of provisionalRevisions.rows) {
    // Identity remap only — reuse the provisional binding's own module, never reclassify it here.
    const binding = await createOrReuseBinding(db, {
      organizationId: input.organizationId,
      key: {
        projectId: input.projectId,
        logicalNodeId: stableLogicalNodeId,
        parameterSpecId: row.parameter_spec_id,
        moduleId: row.module_id,
      },
    });

    await upsertBindingRevisionValues(db, {
      bindingId: binding.id,
      configRevisionId: input.configRevisionId,
      parameterSpecVersionId: row.parameter_spec_version_id,
      values: {
        typedValue: row.typed_value,
        canonicalValue: row.canonical_value ?? undefined,
        rawValue: row.raw_value ?? undefined,
        schemaState: row.schema_state ?? undefined,
        policyState: row.policy_state ?? undefined,
      },
    });

    if (binding.id !== row.binding_id) {
      await db.query(`delete from project_parameter_binding_revisions where id = $1`, [row.id]);
    }
  }
}

export async function reResolveReviewedIdentityMapping(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    previousLogicalNodeId: string;
    priorSelectedLogicalNodeId: string;
    nextSelectedLogicalNodeId: string;
  },
): Promise<void> {
  await applyReviewedIdentityMapping(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    configRevisionId: input.configRevisionId,
    previousLogicalNodeId: input.priorSelectedLogicalNodeId,
    selectedLogicalNodeId: input.previousLogicalNodeId,
  });
  await applyReviewedIdentityMapping(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    configRevisionId: input.configRevisionId,
    previousLogicalNodeId: input.previousLogicalNodeId,
    selectedLogicalNodeId: input.nextSelectedLogicalNodeId,
  });
}

export type IdentityMappingDownstreamUsage = {
  drafts: number;
  submissions: number;
  operations: number;
};

export async function countIdentityMappingDownstreamUsage(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    logicalNodeIds: string[];
  },
): Promise<IdentityMappingDownstreamUsage> {
  const result = await db.query<{
    drafts: string;
    submissions: string;
    operations: string;
  }>(
    `
    with affected_bindings as (
      select id
      from project_parameter_bindings
      where organization_id = $1
        and project_id = $2
        and logical_node_id = any($3::text[])
    )
    select
      (
        select count(*)::text
        from parameter_drafts
        where project_parameter_binding_id in (select id from affected_bindings)
      ) as drafts,
      (
        select count(*)::text
        from parameter_submission_items
        where project_parameter_binding_id in (select id from affected_bindings)
      ) as submissions,
      (
        select count(*)::text
        from node_operations
        where project_parameter_binding_id in (select id from affected_bindings)
      ) as operations
    `,
    [input.organizationId, input.projectId, input.logicalNodeIds],
  );
  return {
    drafts: Number(result.rows[0]?.drafts ?? 0),
    submissions: Number(result.rows[0]?.submissions ?? 0),
    operations: Number(result.rows[0]?.operations ?? 0),
  };
}

/** Fingerprint of a human-selected candidate for reuse on later revisons. */
export type ContinuityReuseEvidence = {
  selectedLogicalNodeId: string;
  selectedNodeLocator?: string;
  selectedName?: string;
  selectedUnitAddress?: string;
};

export function continuityReuseFromTaskEvidence(
  evidence: Record<string, unknown>,
  selectedLogicalNodeId: string,
): ContinuityReuseEvidence {
  const candidates = Array.isArray(evidence.candidates) ? evidence.candidates : [];
  const selected = candidates.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as { logicalNodeId?: unknown }).logicalNodeId === selectedLogicalNodeId,
  ) as
    | { logicalNodeId?: string; nodeLocator?: string; name?: string; unitAddress?: string }
    | undefined;

  return {
    selectedLogicalNodeId,
    selectedNodeLocator:
      typeof selected?.nodeLocator === "string" ? selected.nodeLocator : undefined,
    selectedName: typeof selected?.name === "string" ? selected.name : undefined,
    selectedUnitAddress:
      typeof selected?.unitAddress === "string" ? selected.unitAddress : undefined,
  };
}

export type ReviewedContinuityDecision = {
  previousLogicalNodeId: string;
  selectedNodeLocator?: string;
  selectedName?: string;
  selectedUnitAddress?: string;
};

/**
 * Load resolved human continuity decisions for reuse on subsequent revisons.
 * Only decisions whose source revision is a stable continuity baseline are returned.
 */
export async function listReviewedContinuityDecisions(
  db: Queryable,
  input: { configSetId: string; previousLogicalNodeIds: string[] },
): Promise<ReviewedContinuityDecision[]> {
  if (input.previousLogicalNodeIds.length === 0) return [];

  const result = await db.query<{
    previous_logical_node_id: string;
    evidence: unknown;
  }>(
    `
    select t.previous_logical_node_id, t.evidence
    from identity_mapping_tasks t
    inner join dts_config_revisions cr on cr.id = t.config_revision_id
    where cr.config_set_id = $1
      and t.status = 'resolved'
      and t.previous_logical_node_id = any($2::text[])
      and cr.status = any($3::text[])
    order by t.resolved_at desc nulls last, t.created_at desc
    `,
    [
      input.configSetId,
      input.previousLogicalNodeIds,
      ["resolved", "validated", "compiled", "pending_approval"],
    ],
  );

  const seen = new Set<string>();
  const decisions: ReviewedContinuityDecision[] = [];
  for (const row of result.rows) {
    const previousId = row.previous_logical_node_id;
    if (!previousId || seen.has(previousId)) continue;
    seen.add(previousId);
    const evidence =
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : typeof row.evidence === "string"
          ? (JSON.parse(row.evidence) as Record<string, unknown>)
          : {};
    const selectedLogicalNodeId =
      typeof evidence.selectedLogicalNodeId === "string" ? evidence.selectedLogicalNodeId : null;
    if (!selectedLogicalNodeId) continue;
    const reuse = continuityReuseFromTaskEvidence(evidence, selectedLogicalNodeId);
    decisions.push({
      previousLogicalNodeId: previousId,
      selectedNodeLocator: reuse.selectedNodeLocator,
      selectedName: reuse.selectedName,
      selectedUnitAddress: reuse.selectedUnitAddress,
    });
  }
  return decisions;
}

/**
 * Attach reviewedMappingTo onto previous snapshots by matching candidate fingerprints
 * from prior human continuity decisions.
 */
export function applyReviewedContinuityToSnapshots(
  previous: LogicalNodeSnapshot[],
  candidates: LogicalNodeCandidate[],
  decisions: ReviewedContinuityDecision[],
): LogicalNodeSnapshot[] {
  if (decisions.length === 0) return previous;
  const byPrevious = new Map(decisions.map((d) => [d.previousLogicalNodeId, d]));

  return previous.map((snapshot) => {
    const decision = byPrevious.get(snapshot.logicalNodeId);
    if (!decision) return snapshot;

    const match =
      candidates.find(
        (candidate) =>
          decision.selectedNodeLocator &&
          candidate.nodeLocator === decision.selectedNodeLocator,
      ) ??
      candidates.find(
        (candidate) =>
          decision.selectedName &&
          candidate.name === decision.selectedName &&
          (decision.selectedUnitAddress === undefined ||
            candidate.unitAddress === decision.selectedUnitAddress),
      );

    if (!match) return snapshot;
    return { ...snapshot, reviewedMappingTo: match.logicalNodeId };
  });
}

export async function resolveIdentityMappingTaskRow(
  db: Queryable,
  input: {
    taskId: string;
    organizationId: string;
    status: "resolved" | "dismissed" | "new_identity";
    selectedLogicalNodeId?: string | null;
    reviewerUserId: string;
    reason: string;
    continuityReuse?: ContinuityReuseEvidence | null;
  },
): Promise<IdentityMappingTask | null> {
  const evidencePatch =
    input.continuityReuse != null
      ? JSON.stringify({
          selectedLogicalNodeId: input.continuityReuse.selectedLogicalNodeId,
          selectedNodeLocator: input.continuityReuse.selectedNodeLocator ?? null,
          selectedName: input.continuityReuse.selectedName ?? null,
          selectedUnitAddress: input.continuityReuse.selectedUnitAddress ?? null,
          continuityReusable: true,
        })
      : input.selectedLogicalNodeId != null
        ? JSON.stringify({ selectedLogicalNodeId: input.selectedLogicalNodeId })
        : null;

  const result = await db.query<IdentityMappingTaskRow>(
    `
    update identity_mapping_tasks
    set status = $3,
        reviewer_user_id = $4,
        reason = $5,
        resolved_at = now(),
        evidence = case
          when $6::jsonb is null then evidence
          else coalesce(evidence, '{}'::jsonb) || $6::jsonb
        end
    where id = $1 and organization_id = $2 and status = 'open'
    returning *
    `,
    [
      input.taskId,
      input.organizationId,
      input.status,
      input.reviewerUserId,
      input.reason,
      evidencePatch,
    ],
  );
  const row = result.rows[0];
  return row ? toMappingTask(row) : null;
}

export async function updateResolvedIdentityMappingTaskRow(
  db: Queryable,
  input: {
    taskId: string;
    organizationId: string;
    selectedLogicalNodeId: string;
    reviewerUserId: string;
    reason: string;
    continuityReuse: ContinuityReuseEvidence;
  },
): Promise<IdentityMappingTask | null> {
  const evidencePatch = JSON.stringify({
    selectedLogicalNodeId: input.continuityReuse.selectedLogicalNodeId,
    selectedNodeLocator: input.continuityReuse.selectedNodeLocator ?? null,
    selectedName: input.continuityReuse.selectedName ?? null,
    selectedUnitAddress: input.continuityReuse.selectedUnitAddress ?? null,
    continuityReusable: true,
  });
  const result = await db.query<IdentityMappingTaskRow>(
    `
    update identity_mapping_tasks
    set reviewer_user_id = $3,
        reason = $4,
        resolved_at = now(),
        evidence = coalesce(evidence, '{}'::jsonb) || $5::jsonb
    where id = $1
      and organization_id = $2
      and task_kind = 'identity-ambiguity'
      and status = 'resolved'
    returning *
    `,
    [
      input.taskId,
      input.organizationId,
      input.reviewerUserId,
      input.reason,
      evidencePatch,
    ],
  );
  const row = result.rows[0];
  return row ? toMappingTask(row) : null;
}

export async function reopenIdentityMappingTaskRow(
  db: Queryable,
  input: { taskId: string; organizationId: string; reason: string },
): Promise<IdentityMappingTask | null> {
  const result = await db.query<IdentityMappingTaskRow>(
    `
    update identity_mapping_tasks
    set status = 'open',
        reviewer_user_id = null,
        reason = $3,
        resolved_at = null,
        evidence = coalesce(evidence, '{}'::jsonb)
          - 'selectedLogicalNodeId'
          - 'selectedNodeLocator'
          - 'selectedName'
          - 'selectedUnitAddress'
          - 'continuityReusable'
    where id = $1
      and organization_id = $2
      and task_kind = 'identity-ambiguity'
      and status in ('dismissed', 'new_identity')
    returning *
    `,
    [input.taskId, input.organizationId, input.reason],
  );
  const row = result.rows[0];
  return row ? toMappingTask(row) : null;
}

/** One binding revision row for per-binding history (phase 2, Task 6). */
export type BindingRevisionHistoryRow = {
  id: string;
  configRevisionId: string;
  revisionNumber: number;
  rawValue: string | null;
  createdAt: string;
};

/**
 * Org/project-scoped existence check for a single binding. Returns null when the
 * binding does not belong to the caller's organization and project.
 */
export async function getBindingForProject(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<{ id: string } | null> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from project_parameter_bindings
    where id = $1 and organization_id = $2 and project_id = $3
    limit 1
    `,
    [input.bindingId, input.organizationId, input.projectId],
  );
  const row = result.rows[0];
  return row ? { id: row.id } : null;
}

/**
 * Load every binding revision for one binding, oldest-first, so callers can map
 * adjacent raw values into from→to change entries. History = binding revisions only.
 */
export async function listBindingRevisionRows(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<BindingRevisionHistoryRow[]> {
  const result = await db.query<{
    id: string;
    config_revision_id: string;
    revision_number: number;
    raw_value: string | null;
    created_at: string | Date;
  }>(
    `
    select
      br.id,
      br.config_revision_id,
      cr.revision_number,
      br.raw_value,
      br.created_at
    from project_parameter_binding_revisions br
    inner join project_parameter_bindings b on b.id = br.binding_id
    inner join dts_config_revisions cr on cr.id = br.config_revision_id
    where br.binding_id = $1
      and b.organization_id = $2
      and b.project_id = $3
    order by cr.revision_number asc, br.created_at asc
    `,
    [input.bindingId, input.organizationId, input.projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    configRevisionId: row.config_revision_id,
    revisionNumber: row.revision_number,
    rawValue: row.raw_value,
    createdAt: dateTimeToIso(row.created_at),
  }));
}

/** One peer binding for cross-project compare (phase 2, Task 7). */
export type BindingCompareRow = {
  projectId: string;
  projectName: string;
  rawValue: string;
  moduleName: string | null;
  driverModule: string | null;
};

/**
 * Cross-project compare within the source binding's organization: peers are other
 * projects whose binding shares the same `parameter_spec_id` AND `module_id`
 * (design lock — never name-only). The source project is excluded; the latest
 * revision raw value and module/driver display context are returned per peer.
 */
export async function listBindingCompareRows(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<BindingCompareRow[]> {
  const result = await db.query<{
    project_id: string;
    project_name: string;
    raw_value: string | null;
    module_name: string | null;
    driver_module: string | null;
  }>(
    `
    with source as (
      select parameter_spec_id, module_id
      from project_parameter_bindings
      where id = $1 and organization_id = $2 and project_id = $3
      limit 1
    )
    select
      b.project_id,
      p.name as project_name,
      latest.raw_value,
      pm.name as module_name,
      coalesce(asub.display_name, pm.name) as driver_module
    from project_parameter_bindings b
    inner join source s
      on s.parameter_spec_id = b.parameter_spec_id
     and s.module_id = b.module_id
    inner join projects p on p.id = b.project_id
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join parameter_modules pm on pm.id = b.module_id
    left join lateral (
      select raw_value
      from project_parameter_binding_revisions
      where binding_id = b.id
      order by created_at desc
      limit 1
    ) latest on true
    where b.organization_id = $2
      and b.project_id <> $3
    order by p.name asc, b.project_id asc
    `,
    [input.bindingId, input.organizationId, input.projectId],
  );
  return result.rows.map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    rawValue: row.raw_value ?? "",
    moduleName: row.module_name,
    driverModule: row.driver_module,
  }));
}

type BindingListRow = {
  id: string;
  parameter_spec_id: string;
  parameter_spec_version_id: string;
  property_key: string | null;
  driver_module: string | null;
  logical_node_id: string | null;
  instance_name: string | null;
  locator: string | null;
  typed_value: unknown;
  raw_value: string | null;
  schema_state: string | null;
  policy_state: string | null;
  module_id: string;
};

export type ProjectBindingListItem = {
  id: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  driverModule: string | null;
  logicalNodeId: string | null;
  instanceName: string | null;
  locator: string | null;
  typedValue: unknown;
  rawValue: string;
  schemaState: string | null;
  policyState: string | null;
  /** Durable v1 business module (phase 2, §5.1 read path) — browse source of truth. */
  moduleId: string;
};

export async function listProjectBindingRows(
  db: Queryable,
  input: { organizationId: string; projectId: string; revisionId?: string },
): Promise<ProjectBindingListItem[]> {
  const values: unknown[] = [input.organizationId, input.projectId];
  let revisionJoin = `
    left join lateral (
      select *
      from project_parameter_binding_revisions
      where binding_id = b.id
      order by created_at desc
      limit 1
    ) br on true
  `;
  if (input.revisionId) {
    values.push(input.revisionId);
    revisionJoin = `
      inner join project_parameter_binding_revisions br
        on br.binding_id = b.id and br.config_revision_id = $${values.length}
    `;
  }

  const result = await db.query<BindingListRow>(
    `
    select
      b.id,
      b.parameter_spec_id,
      br.parameter_spec_version_id,
      coalesce(
        dps.property_key,
        nullif(
          (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
          ''
        ),
        ''
      ) as property_key,
      coalesce(asub.display_name, pm.name) as driver_module,
      b.logical_node_id,
      case
        when lnr.unit_address is not null then lnr.name || '@' || lnr.unit_address
        else lnr.name
      end as instance_name,
      lnr.node_locator as locator,
      br.typed_value,
      br.raw_value,
      br.schema_state,
      br.policy_state,
      b.module_id
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join parameter_modules pm on pm.id = b.module_id
    left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
    ${revisionJoin}
    left join lateral (
      select node_locator, name, unit_address
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
        and ($3::text is null or config_revision_id = $3)
      order by case when $3::text is null then 0 else 1 end desc, config_revision_id desc
      limit 1
    ) lnr on true
    where b.organization_id = $1 and b.project_id = $2
      and br.parameter_spec_version_id is not null
    order by coalesce(lnr.node_locator, ''), coalesce(dps.property_key, ps.specification_key)
    `,
    input.revisionId ? values : [...values, null],
  );

  return result.rows.map((row) => ({
    id: row.id,
    parameterSpecId: row.parameter_spec_id,
    parameterSpecVersionId: row.parameter_spec_version_id,
    propertyKey: row.property_key ?? "",
    driverModule: row.driver_module,
    logicalNodeId: row.logical_node_id,
    instanceName: row.instance_name,
    locator: row.locator,
    typedValue: row.typed_value,
    rawValue: row.raw_value ?? "",
    schemaState: row.schema_state,
    policyState: row.policy_state,
    moduleId: row.module_id,
  }));
}
