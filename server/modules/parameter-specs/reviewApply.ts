import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createOrReuseBinding,
  upsertBindingRevisionValues,
} from "../parameter-topology/bindingService";
import { updateConfigRevisionStatus } from "../parameter-topology/repository";
import {
  compatibleFingerprint,
  getParameterSpecRow,
  upsertOccurrenceSpecDecision,
  upsertMatcherOverride,
  type PersistedSpecReviewTask,
  type ParameterSpecDetailRow,
} from "./repository";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export type SpecReviewEvidence = {
  organizationId: string | null;
  projectId: string | null;
  configRevisionId: string | null;
  propertyOccurrenceId: string | null;
  logicalNodeId: string | null;
  propertyKey: string | null;
  nodeLocator: string | null;
  compatible: string[];
  matcherCandidates: string[];
};

/** Parse precise locate fields from review-task source_evidence. */
export function parseSpecReviewEvidence(task: PersistedSpecReviewTask): SpecReviewEvidence {
  const evidence = asRecord(task.sourceEvidence);
  const candidates = Array.isArray(task.candidateSchemas)
    ? task.candidateSchemas
        .map((raw) => {
          const candidate = asRecord(raw);
          return (
            asString(candidate.parameterSpecId) ??
            asString(candidate.id)
          );
        })
        .filter((id): id is string => id != null)
    : [];

  return {
    organizationId: asString(evidence.organizationId) ?? task.organizationId,
    projectId: asString(evidence.projectId),
    configRevisionId: asString(evidence.configRevisionId),
    propertyOccurrenceId: asString(evidence.propertyOccurrenceId),
    logicalNodeId: asString(evidence.logicalNodeId),
    propertyKey: asString(evidence.propertyKey),
    nodeLocator: asString(evidence.nodeLocator),
    compatible: asStringArray(evidence.compatible),
    matcherCandidates: candidates,
  };
}

export function requireLocateEvidence(evidence: SpecReviewEvidence, taskId: string): {
  projectId: string;
  configRevisionId: string;
  propertyOccurrenceId: string;
  logicalNodeId: string;
  propertyKey: string;
} {
  const missing: string[] = [];
  if (!evidence.projectId) missing.push("projectId");
  if (!evidence.configRevisionId) missing.push("configRevisionId");
  if (!evidence.propertyOccurrenceId) missing.push("propertyOccurrenceId");
  if (!evidence.logicalNodeId) missing.push("logicalNodeId");
  if (!evidence.propertyKey) missing.push("propertyKey");
  if (missing.length > 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Spec review task evidence cannot precisely locate the property occurrence.",
      400,
      { taskId, missing },
    );
  }
  return {
    projectId: evidence.projectId!,
    configRevisionId: evidence.configRevisionId!,
    propertyOccurrenceId: evidence.propertyOccurrenceId!,
    logicalNodeId: evidence.logicalNodeId!,
    propertyKey: evidence.propertyKey!,
  };
}

async function loadPropertyValueForBinding(
  db: Queryable,
  input: { propertyOccurrenceId: string; configRevisionId: string },
): Promise<{ typedValue: unknown; canonicalValue: unknown; rawValue: string | null }> {
  const result = await db.query<{
    raw_text: string;
    ast_json: unknown;
  }>(
    `
    select raw_text, ast_json
    from dts_property_occurrences
    where id = $1 and config_revision_id = $2
    limit 1
    `,
    [input.propertyOccurrenceId, input.configRevisionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "Property occurrence was not found for this review task.", 404, {
      propertyOccurrenceId: input.propertyOccurrenceId,
      configRevisionId: input.configRevisionId,
    });
  }
  const typedValue =
    row.ast_json && typeof row.ast_json === "object"
      ? row.ast_json
      : { kind: "raw", rawText: row.raw_text };
  return {
    typedValue,
    canonicalValue: typedValue,
    rawValue: row.raw_text,
  };
}

/**
 * Apply a resolved review: occurrence→spec decision, binding, binding revision, matcher override.
 * Callers must already hold a locked open task and validated org/global spec.
 */
export async function applyResolvedSpecReview(
  db: Queryable,
  input: {
    task: PersistedSpecReviewTask;
    organizationId: string;
    parameterSpecId: string;
    parameterSpecVersionId: string;
    reviewerUserId: string;
    reason: string;
  },
): Promise<{ bindingId: string; projectId: string; configRevisionId: string }> {
  const evidence = parseSpecReviewEvidence(input.task);
  const locate = requireLocateEvidence(evidence, input.task.id);

  const values = await loadPropertyValueForBinding(db, {
    propertyOccurrenceId: locate.propertyOccurrenceId,
    configRevisionId: locate.configRevisionId,
  });

  const binding = await createOrReuseBinding(db, {
    organizationId: input.organizationId,
    key: {
      projectId: locate.projectId,
      logicalNodeId: locate.logicalNodeId,
      parameterSpecId: input.parameterSpecId,
    },
  });

  await upsertBindingRevisionValues(db, {
    bindingId: binding.id,
    configRevisionId: locate.configRevisionId,
    parameterSpecVersionId: input.parameterSpecVersionId,
    values: {
      typedValue: values.typedValue,
      canonicalValue: values.canonicalValue,
      rawValue: values.rawValue ?? undefined,
      schemaState: "reviewed",
    },
  });

  await upsertOccurrenceSpecDecision(db, {
    organizationId: input.organizationId,
    projectId: locate.projectId,
    configRevisionId: locate.configRevisionId,
    propertyOccurrenceId: locate.propertyOccurrenceId,
    logicalNodeId: locate.logicalNodeId,
    propertyKey: locate.propertyKey,
    decision: "resolved",
    parameterSpecId: input.parameterSpecId,
    bindingId: binding.id,
    reviewTaskId: input.task.id,
  });

  await upsertMatcherOverride(db, {
    organizationId: input.organizationId,
    projectId: locate.projectId,
    compatibleFingerprint: compatibleFingerprint(evidence.compatible),
    nodeLocator: evidence.nodeLocator,
    propertyKey: locate.propertyKey,
    decision: "resolved",
    parameterSpecId: input.parameterSpecId,
    sourceReviewTaskId: input.task.id,
    reason: input.reason,
    createdByUserId: input.reviewerUserId,
  });

  return {
    bindingId: binding.id,
    projectId: locate.projectId,
    configRevisionId: locate.configRevisionId,
  };
}

/**
 * Dismiss fail-closed: persist occurrence decision + matcher override without creating a binding.
 * Release/validate must still treat dismissed properties as blockers.
 */
export async function applyDismissedSpecReview(
  db: Queryable,
  input: {
    task: PersistedSpecReviewTask;
    organizationId: string;
    reviewerUserId: string;
    reason: string;
  },
): Promise<{ projectId: string; configRevisionId: string }> {
  const evidence = parseSpecReviewEvidence(input.task);
  const locate = requireLocateEvidence(evidence, input.task.id);

  await upsertOccurrenceSpecDecision(db, {
    organizationId: input.organizationId,
    projectId: locate.projectId,
    configRevisionId: locate.configRevisionId,
    propertyOccurrenceId: locate.propertyOccurrenceId,
    logicalNodeId: locate.logicalNodeId,
    propertyKey: locate.propertyKey,
    decision: "dismissed",
    parameterSpecId: null,
    bindingId: null,
    reviewTaskId: input.task.id,
  });

  await upsertMatcherOverride(db, {
    organizationId: input.organizationId,
    projectId: locate.projectId,
    compatibleFingerprint: compatibleFingerprint(evidence.compatible),
    nodeLocator: evidence.nodeLocator,
    propertyKey: locate.propertyKey,
    decision: "dismissed",
    parameterSpecId: null,
    sourceReviewTaskId: input.task.id,
    reason: input.reason,
    createdByUserId: input.reviewerUserId,
  });

  return {
    projectId: locate.projectId,
    configRevisionId: locate.configRevisionId,
  };
}

export async function refreshConfigRevisionAfterSpecReview(
  db: Queryable,
  input: {
    organizationId: string;
    configRevisionId: string;
    decision: "resolved" | "dismissed";
    openReviewsRemaining: number;
    openMappingsRemaining: number;
  },
): Promise<string> {
  // Dismiss never pretends the property matched: keep revision non-releasable when
  // mappings remain open, or leave status unchanged for dismiss-only (validate still
  // fail-closes on dismissed occurrence decisions).
  if (input.openMappingsRemaining > 0) {
    await updateConfigRevisionStatus(db, {
      id: input.configRevisionId,
      status: "needs_mapping",
    });
    return "needs_mapping";
  }

  if (input.decision === "resolved" && input.openReviewsRemaining === 0) {
    await updateConfigRevisionStatus(db, {
      id: input.configRevisionId,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
    return "resolved";
  }

  // Dismissed or remaining open reviews: do not promote; status stays / becomes resolved
  // only when identity is clear — validate still blocks dismissed-property and open reviews.
  const current = await db.query<{ status: string }>(
    `select status from dts_config_revisions where id = $1`,
    [input.configRevisionId],
  );
  const status = current.rows[0]?.status ?? "resolved";
  if (status === "needs_mapping" || status === "invalid" || status === "resolving") {
    return status;
  }
  await updateConfigRevisionStatus(db, {
    id: input.configRevisionId,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  });
  return "resolved";
}

export async function requireOrgOrGlobalSpec(
  db: Queryable,
  input: { organizationId: string; parameterSpecId: string },
) {
  const allowedSpec = await getParameterSpecRow(db, {
    organizationId: input.organizationId,
    specId: input.parameterSpecId,
  });
  if (!allowedSpec) {
    throw new ApiError("NOT_FOUND", "Parameter spec was not found for this organization.", 404, {
      parameterSpecId: input.parameterSpecId,
    });
  }
  if (!allowedSpec.currentVersionId) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter spec has no current version to bind.",
      400,
      { parameterSpecId: input.parameterSpecId },
    );
  }
  return allowedSpec;
}

/** Fail closed when task property key differs from selected spec unless explicitly confirmed. */
export function assertPropertyKeyMatchOrConfirmed(
  task: PersistedSpecReviewTask,
  spec: Pick<ParameterSpecDetailRow, "propertyKey">,
  confirmPropertyMismatch?: boolean,
): { mismatchConfirmed: boolean; taskPropertyKey: string | null; specPropertyKey: string | null } {
  const taskPropertyKey = parseSpecReviewEvidence(task).propertyKey;
  const specPropertyKey = spec.propertyKey;
  if (taskPropertyKey && specPropertyKey && taskPropertyKey !== specPropertyKey) {
    if (!confirmPropertyMismatch) {
      throw new ApiError(
        "CONFLICT",
        "Selected parameter spec property key does not match the review task.",
        409,
        {
          taskPropertyKey,
          specPropertyKey,
          confirmRequired: true,
        },
      );
    }
    return { mismatchConfirmed: true, taskPropertyKey, specPropertyKey };
  }
  return { mismatchConfirmed: false, taskPropertyKey, specPropertyKey };
}

/**
 * Create an org-owned manual parameter spec for unmatched review resolution.
 * Reuses an existing org spec when the stable id already exists.
 */
export async function createOrgManualParameterSpec(
  db: Queryable,
  input: {
    organizationId: string;
    propertyKey: string;
    driverModule: string | null;
  },
): Promise<{ parameterSpecId: string; parameterSpecVersionId: string; created: boolean }> {
  const schemaNamespace = input.driverModule ?? "manual";
  const specificationKey = `${schemaNamespace}/${input.propertyKey}`;
  const parameterSpecId = `pspec:${input.organizationId}:${schemaNamespace}:${input.propertyKey}`;
  const parameterSpecVersionId = `${parameterSpecId}:v1`;
  const dtsPropertySpecId = `dps:${parameterSpecId}`;

  const existing = await getParameterSpecRow(db, {
    organizationId: input.organizationId,
    specId: parameterSpecId,
  });
  if (existing?.currentVersionId) {
    return {
      parameterSpecId,
      parameterSpecVersionId: existing.currentVersionId,
      created: false,
    };
  }

  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', $3)
    on conflict (id) do nothing
    `,
    [parameterSpecId, input.organizationId, specificationKey],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, $3, $4, $5::jsonb, null, null, 'active')
    on conflict (id) do nothing
    `,
    [
      parameterSpecVersionId,
      parameterSpecId,
      input.propertyKey,
      `Manual spec created from review for ${input.propertyKey}`,
      JSON.stringify({ kind: "unknown" }),
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, null, $3, $4, null, '{}'::jsonb, $5)
    on conflict (id) do nothing
    `,
    [
      dtsPropertySpecId,
      parameterSpecId,
      input.propertyKey,
      schemaNamespace,
      `Created from unmatched spec review for ${input.propertyKey}`,
    ],
  );

  return { parameterSpecId, parameterSpecVersionId, created: true };
}
