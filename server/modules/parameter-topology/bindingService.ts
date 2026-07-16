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
import { updateConfigRevisionStatus } from "./repository";
import type { ConfigRevisionStatus } from "./types";

export type ProjectPropertyBindingKey = {
  projectId: string;
  logicalNodeId: string | null;
  parameterSpecId: string;
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
  status: "open" | "resolved" | "dismissed";
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
  return `${key.projectId}\0${key.logicalNodeId ?? ""}\0${key.parameterSpecId}`;
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
  status: "open" | "resolved" | "dismissed";
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
    status: row.status,
    reviewerUserId: row.reviewer_user_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    resolvedAt: row.resolved_at ? dateTimeToIso(row.resolved_at) : undefined,
  };
}

export async function findBindingByKey(
  db: Queryable,
  key: ProjectPropertyBindingKey,
): Promise<ProjectParameterBinding | null> {
  const result = await db.query<BindingRow>(
    `
    select id, organization_id, project_id, logical_node_id, parameter_spec_id, created_at
    from project_parameter_bindings
    where project_id = $1
      and logical_node_id is not distinct from $2
      and parameter_spec_id = $3
    limit 1
    `,
    [key.projectId, key.logicalNodeId, key.parameterSpecId],
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
  const existing = await findBindingByKey(db, input.key);
  if (existing) return existing;

  const id = input.id ?? randomUUID();
  const result = await db.query<BindingRow>(
    `
    insert into project_parameter_bindings (
      id, organization_id, project_id, logical_node_id, parameter_spec_id
    ) values ($1, $2, $3, $4, $5)
    returning id, organization_id, project_id, logical_node_id, parameter_spec_id, created_at
    `,
    [
      id,
      input.organizationId,
      input.key.projectId,
      input.key.logicalNodeId,
      input.key.parameterSpecId,
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
  },
): Promise<ProjectParameterBindingRevision> {
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
    status?: "open" | "resolved" | "dismissed";
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
    const binding = await createOrReuseBinding(db, {
      organizationId: input.organizationId,
      key: {
        projectId: input.projectId,
        logicalNodeId: stableLogicalNodeId,
        parameterSpecId: row.parameter_spec_id,
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
      ["resolved", "validated", "compiled", "pending_approval", "published"],
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
    status: "resolved" | "dismissed";
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
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      ) as driver_module,
      b.logical_node_id,
      case
        when lnr.unit_address is not null then lnr.name || '@' || lnr.unit_address
        else lnr.name
      end as instance_name,
      lnr.node_locator as locator,
      br.typed_value,
      br.raw_value,
      br.schema_state,
      br.policy_state
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
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
  }));
}
