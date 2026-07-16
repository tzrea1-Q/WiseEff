import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import { countOpenIdentityMappingTasksForRevision } from "../parameter-topology/bindingService";
import {
  applyDismissedSpecReview,
  applyResolvedSpecReview,
  parseSpecReviewEvidence,
  refreshConfigRevisionAfterSpecReview,
  requireOrgOrGlobalSpec,
} from "./reviewApply";
import {
  countOpenSpecReviewTasksForRevision,
  getParameterSpecRow,
  getSpecReviewTaskById,
  listParameterSpecRows,
  listSpecReviewTaskRows,
  lockOpenSpecReviewTask,
  resolveSpecReviewTaskRow,
  type PersistedSpecReviewTask,
  type SpecReviewTaskListCursor,
} from "./repository";
import type {
  ListParameterSpecsQuery,
  ListSpecReviewTasksQuery,
  ParameterSpecDetailDto,
  ParameterSpecReviewTaskDto,
  ParameterSpecSummaryDto,
  ResolveSpecReviewTaskBody,
} from "./schemas";

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Prefer parameterSpecId; map legacy propspec version ids to pspec ids. */
export function resolveCandidateSpecId(candidate: Record<string, unknown>): string | null {
  const parameterSpecId = asString(candidate.parameterSpecId);
  if (parameterSpecId) return parameterSpecId;
  const id = asString(candidate.id);
  if (!id) return null;
  if (id.startsWith("pspec:")) return id;
  if (id.startsWith("propspec:")) {
    return id.replace(/^propspec:/, "pspec:").replace(/:v\d+$/, "");
  }
  return id;
}

function candidateLabel(candidate: Record<string, unknown>, id: string): string {
  const schemaNamespace = asString(candidate.schemaNamespace);
  const propertyKey = asString(candidate.propertyKey);
  const compatible = asString(candidate.compatible);
  if (schemaNamespace && propertyKey) return `${schemaNamespace} / ${propertyKey}`;
  if (compatible && schemaNamespace) return `${compatible} (${schemaNamespace})`;
  if (schemaNamespace) return schemaNamespace;
  return id;
}

export function toReviewTaskDto(task: PersistedSpecReviewTask): ParameterSpecReviewTaskDto {
  const evidenceRecord = asRecord(task.sourceEvidence);
  const evidence = asStringArray(evidenceRecord.evidence);
  const propertyKey = asString(evidenceRecord.propertyKey);
  const candidates = task.candidateSchemas
    .map((raw) => {
      const candidate = asRecord(raw);
      const id = resolveCandidateSpecId(candidate);
      if (!id) return null;
      return { id, label: candidateLabel(candidate, id) };
    })
    .filter((item): item is { id: string; label: string } => item != null);

  const firstCandidate = asRecord(task.candidateSchemas[0] ?? {});
  const driverModule = asString(firstCandidate.schemaNamespace);

  return {
    id: task.id,
    status: task.status,
    parameterSpecId: task.parameterSpecId ?? null,
    propertyKey,
    driverModule,
    evidence,
    candidates,
    ambiguous: candidates.length > 1,
    projectCount: task.projectCount,
    createdAt: task.createdAt,
    resolvedAt: task.resolvedAt ?? null,
    reason: task.reason ?? null,
  };
}

function decodeReviewCursor(cursor: string | undefined): SpecReviewTaskListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor shape");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Invalid review task cursor.", 400, { cursor });
  }
}

function encodeReviewCursor(cursor: SpecReviewTaskListCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function listParameterSpecs(
  db: Database,
  auth: AuthContext,
  query: ListParameterSpecsQuery = {},
): Promise<{ items: ParameterSpecSummaryDto[] }> {
  requireCanView(auth);
  const rows = await listParameterSpecRows(db, {
    organizationId: auth.organization.id,
    ...query,
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      sourceKind: row.sourceKind,
      specificationKey: row.specificationKey,
      propertyKey: row.propertyKey,
      driverModule: row.driverModule,
      lifecycle: row.lifecycle,
      currentVersionId: row.currentVersionId,
      currentVersion: row.currentVersion,
    })),
  };
}

export async function getParameterSpec(
  db: Database,
  auth: AuthContext,
  specId: string,
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanView(auth);
  const row = await getParameterSpecRow(db, {
    organizationId: auth.organization.id,
    specId,
  });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId });
  }
  return {
    item: {
      id: row.id,
      sourceKind: row.sourceKind,
      specificationKey: row.specificationKey,
      propertyKey: row.propertyKey,
      driverModule: row.driverModule,
      lifecycle: row.lifecycle,
      currentVersionId: row.currentVersionId,
      currentVersion: row.currentVersion,
      displayName: row.displayName,
      description: row.description,
      valueShape: row.valueShape,
      schemaDefault: row.schemaDefault,
      exampleValue: row.exampleValue,
      schemaNamespace: row.schemaNamespace,
      units: row.units,
      constraints: row.constraints,
      documentation: row.documentation,
      compatiblePatterns: row.compatiblePatterns,
      policyTarget: row.policyTarget,
    },
  };
}

export async function listSpecReviewTasks(
  db: Database,
  auth: AuthContext,
  query: ListSpecReviewTasksQuery = {},
): Promise<{ items: ParameterSpecReviewTaskDto[]; nextCursor: string | null }> {
  requireCanAdmin(auth);
  const limit = query.limit ?? 50;
  const cursor = decodeReviewCursor(query.cursor);
  const result = await listSpecReviewTaskRows(db, {
    organizationId: auth.organization.id,
    status: query.status,
    limit,
    cursor,
  });
  return {
    items: result.items.map(toReviewTaskDto),
    nextCursor: encodeReviewCursor(result.nextCursor),
  };
}

function sameResolvedChoice(
  task: PersistedSpecReviewTask,
  input: ResolveSpecReviewTaskBody & { taskId: string },
): boolean {
  if (task.status !== input.decision) return false;
  if (input.decision === "dismissed") return true;
  return task.parameterSpecId === input.parameterSpecId;
}

/**
 * Apply review decision (occurrence→spec→binding + matcher override) in one transaction.
 * Dismiss is fail-closed: no binding is created; release/validate still blocks.
 */
export async function resolveSpecReviewTask(
  db: Database,
  auth: AuthContext,
  input: ResolveSpecReviewTaskBody & { taskId: string },
  context: AuditCorrelationContext = {},
): Promise<{ id: string; status: "resolved" | "dismissed"; parameterSpecId?: string; reason?: string }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const locked = await lockOpenSpecReviewTask(tx, {
      organizationId: auth.organization.id,
      taskId: input.taskId,
    });

    if (!locked) {
      const known = await getSpecReviewTaskById(tx, {
        organizationId: auth.organization.id,
        taskId: input.taskId,
      });
      if (!known) {
        throw new ApiError("NOT_FOUND", "Parameter spec review task was not found.", 404, {
          taskId: input.taskId,
        });
      }
      if (sameResolvedChoice(known, input)) {
        return {
          id: known.id,
          status: known.status === "open" ? input.decision : known.status,
          parameterSpecId: known.parameterSpecId,
          reason: known.reason,
        };
      }
      throw new ApiError("CONFLICT", "Parameter spec review task already resolved with a different choice.", 409, {
        taskId: input.taskId,
        status: known.status,
        parameterSpecId: known.parameterSpecId ?? null,
      });
    }

    let applied: { projectId: string; configRevisionId: string; bindingId?: string };
    let parameterSpecId = input.parameterSpecId;

    if (input.decision === "resolved") {
      if (!parameterSpecId) {
        throw new ApiError("VALIDATION_FAILED", "parameterSpecId is required when resolving a review task.", 400);
      }
      const allowedSpec = await requireOrgOrGlobalSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId,
      });
      const result = await applyResolvedSpecReview(tx, {
        task: locked,
        organizationId: auth.organization.id,
        parameterSpecId,
        parameterSpecVersionId: allowedSpec.currentVersionId!,
        reviewerUserId: auth.user.id,
        reason: input.reason,
      });
      applied = result;
    } else {
      // Fail-closed dismiss: persist decision/override, never create a matched binding.
      applied = await applyDismissedSpecReview(tx, {
        task: locked,
        organizationId: auth.organization.id,
        reviewerUserId: auth.user.id,
        reason: input.reason,
      });
      parameterSpecId = undefined;
    }

    await writeGovernanceAudit(
      tx,
      auth,
      {
        action: input.decision === "resolved" ? "spec-review-resolved" : "spec-review-dismissed",
        projectId: applied.projectId,
        targetType: "parameter-spec-review-task",
        targetId: locked.id,
        metadata: {
          taskId: locked.id,
          parameterSpecId: parameterSpecId ?? null,
          decision: input.decision,
          reasonHash: hashReason(input.reason),
          projectCount: locked.projectCount,
          propertyKey: asString(asRecord(locked.sourceEvidence).propertyKey),
          previousStatus: locked.status,
          configRevisionId: applied.configRevisionId,
          propertyOccurrenceId: parseSpecReviewEvidence(locked).propertyOccurrenceId,
          logicalNodeId: parseSpecReviewEvidence(locked).logicalNodeId,
          bindingId: applied.bindingId ?? null,
          failClosedDismiss: input.decision === "dismissed",
        },
      },
      context,
    );

    // Close task last so any prior failure rolls back without marking resolved.
    const resolved = await resolveSpecReviewTaskRow(tx, {
      taskId: input.taskId,
      organizationId: auth.organization.id,
      status: input.decision,
      parameterSpecId: parameterSpecId ?? null,
      reviewerUserId: auth.user.id,
      reason: input.reason,
    });
    if (!resolved) {
      throw new ApiError("CONFLICT", "Parameter spec review task is not open.", 409, { taskId: input.taskId });
    }

    const openReviewsRemaining = await countOpenSpecReviewTasksForRevision(tx, {
      organizationId: auth.organization.id,
      configRevisionId: applied.configRevisionId,
    });
    const openMappingsRemaining = await countOpenIdentityMappingTasksForRevision(tx, {
      organizationId: auth.organization.id,
      configRevisionId: applied.configRevisionId,
    });
    await refreshConfigRevisionAfterSpecReview(tx, {
      organizationId: auth.organization.id,
      configRevisionId: applied.configRevisionId,
      decision: input.decision,
      openReviewsRemaining,
      openMappingsRemaining,
    });

    return {
      id: resolved.id,
      status: resolved.status === "open" ? input.decision : resolved.status,
      parameterSpecId: resolved.parameterSpecId,
      reason: resolved.reason,
    };
  });
}

function hashReason(reason: string) {
  let hash = 0;
  for (let i = 0; i < reason.length; i += 1) {
    hash = (hash * 31 + reason.charCodeAt(i)) >>> 0;
  }
  return `r${hash.toString(16)}`;
}
