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
