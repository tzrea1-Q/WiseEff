import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import {
  canAdminParameters,
  canViewParameters,
} from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { countBlockingIdentityMappingTasksForRevision } from "../parameter-topology/bindingService";
import { stableSemanticId } from "../parameter-topology/migration";
import { ensureAttributionSubjectForCompatible } from "../parameter-modules/resolveAttributionSubject";
import { randomUUID } from "node:crypto";
import {
  applyDismissedSpecReview,
  applyResolvedSpecReview,
  assertPropertyKeyMatchOrConfirmed,
  createOrgManualParameterSpec,
  parseSpecReviewEvidence,
  refreshConfigRevisionAfterSpecReview,
  requireOrgOrGlobalSpec,
  requireOrgOwnedSpec,
  requireLocateEvidence,
} from "./reviewApply";
import {
  assertSpecActivatable,
  assertSpecResolvable,
} from "./specCompleteness";
import {
  ensureExplicitOverlayCoverageClaim,
  findExistingCoverageClaim,
} from "./coverageClaim";
import {
  countOpenSpecReviewTasksForRevision,
  findParameterSpecByIdentity,
  getParameterSpecRow,
  getSpecReviewTaskById,
  listParameterSpecRows,
  listSpecReviewTaskRows,
  loadReferenceCountsBySpecIds,
  lockOpenSpecReviewTask,
  resolveSpecReviewTaskRow,
  type ParameterSpecDetailRow,
  type PersistedSpecReviewTask,
  type SpecReviewTaskListCursor,
  validateSpecReviewTenantEvidence,
} from "./repository";
import { canonicalIdentityPart } from "./specIdentity";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import { assertNonStructuralPropertyKey } from "./structuralPropertyGuard";
import { guardSemanticFieldPatch } from "../../../src/domain/parameter-topology/specLifecycleGuard";
import type {
  ActivateParameterSpecBody,
  CreateParameterSpecBody,
  DeprecateParameterSpecBody,
  ListParameterSpecsQuery,
  ListSpecReviewTasksQuery,
  ParameterSpecDetailDto,
  ParameterSpecDetailQuery,
  ParameterSpecCutoverSummaryDto,
  ParameterSpecReviewTaskDto,
  ParameterSpecSummaryDto,
  ResolveSpecReviewTaskBody,
  RestoreParameterSpecBody,
  ReattributeParameterSpecBody,
  RenameParameterSpecPropertyKeyBody,
  PrepareParameterSpecCutoverBody,
  FinalizeParameterSpecCutoverBody,
  UpdateParameterSpecBody,
} from "./schemas";

function isPlatformSuperAdmin(auth: AuthContext) {
  return auth.roles.some((binding) => binding.roleId === "platform-admin");
}
function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

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
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/** Prefer parameterSpecId; map legacy propspec version ids to pspec ids. */
export function resolveCandidateSpecId(
  candidate: Record<string, unknown>,
): string | null {
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

function candidateLabel(
  candidate: Record<string, unknown>,
  id: string,
): string {
  const schemaNamespace = asString(candidate.schemaNamespace);
  const propertyKey = asString(candidate.propertyKey);
  const compatible = asString(candidate.compatible);
  if (schemaNamespace && propertyKey)
    return `${schemaNamespace} / ${propertyKey}`;
  if (compatible && schemaNamespace)
    return `${compatible} (${schemaNamespace})`;
  if (schemaNamespace) return schemaNamespace;
  return id;
}

export function toReviewTaskDto(
  task: PersistedSpecReviewTask,
): ParameterSpecReviewTaskDto {
  const evidenceRecord = asRecord(task.sourceEvidence);
  const evidence = asStringArray(evidenceRecord.evidence);
  const propertyKey = asString(evidenceRecord.propertyKey);
  const candidates = task.candidateSchemas
    .map((raw) => {
      const candidate = asRecord(raw);
      const id = resolveCandidateSpecId(candidate);
      if (!id) return null;
      return {
        id,
        label: candidateLabel(candidate, id),
        propertyKey: asString(candidate.propertyKey),
        driverModule: asString(candidate.schemaNamespace),
      };
    })
    .filter(
      (
        item,
      ): item is {
        id: string;
        label: string;
        propertyKey: string | null;
        driverModule: string | null;
      } => item != null,
    );

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

function decodeReviewCursor(
  cursor: string | undefined,
): SpecReviewTaskListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor shape");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Invalid review task cursor.", {
      cursor,
    });
  }
}

function encodeReviewCursor(
  cursor: SpecReviewTaskListCursor | null,
): string | null {
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
      organizationId: row.organizationId,
      sourceKind: row.sourceKind,
      specificationKey: row.specificationKey,
      propertyKey: row.propertyKey,
      driverModule: row.driverModule,
      lifecycle: row.lifecycle,
      currentVersionId: row.currentVersionId,
      currentVersion: row.currentVersion,
      valueShape: row.valueShape,
      compatiblePatterns: row.compatiblePatterns,
      attributionModules: row.attributionModules,
      attributionSubjectId: row.attributionSubjectId,
      referenceCount: row.referenceCount,
      effectiveScope: row.effectiveScope,
      overrideOfSpecId: row.overrideOfSpecId ?? null,
      declaredPlacement: row.declaredPlacement ?? null,
      observationState: row.observationState,
    })),
  };
}

export async function getParameterSpec(
  db: Database,
  auth: AuthContext,
  specId: string,
  options: ParameterSpecDetailQuery = { view: "governance" },
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanView(auth);
  const view = options.view ?? "governance";
  // Raw-by-id remains available to internal governance callers, while the HTTP
  // detail route opts into the effective projection by default. This keeps a
  // stale/shadowed platform row from masquerading as the current definition.
  const effectiveRow =
    view === "effective"
      ? (
          await listParameterSpecRows(db, {
            organizationId: auth.organization.id,
            view: "effective",
          })
        ).find((candidate) => candidate.id === specId)
      : null;
  if (view === "effective" && !effectiveRow) {
    throw new ApiError(
      "NOT_FOUND",
      "Parameter spec was not found in the effective catalog.",
      {
        specId,
      },
    );
  }
  const row = await getParameterSpecRow(db, {
    organizationId: auth.organization.id,
    specId,
  });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
      specId,
    });
  }
  const detailRow: ParameterSpecDetailRow = effectiveRow
    ? {
        ...row,
        attributionModules: effectiveRow.attributionModules,
        attributionSubjectId: effectiveRow.attributionSubjectId,
        driverModule: effectiveRow.driverModule,
        effectiveScope: effectiveRow.effectiveScope,
        overrideOfSpecId: effectiveRow.overrideOfSpecId,
        declaredPlacement: effectiveRow.declaredPlacement,
        observationState: effectiveRow.observationState,
        referenceCount: effectiveRow.referenceCount,
      }
    : row;
  const cutover = await loadOpenCutoverSummaryForSpec(
    db,
    auth.organization.id,
    specId,
  );
  return { item: toParameterSpecDetailDto(detailRow, cutover) };
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
    projectId: query.projectId,
    configRevisionId: query.configRevisionId,
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
  if (input.createSpec) {
    return task.status === "open";
  }
  if (task.status !== input.decision) return false;
  if (input.decision === "dismissed") return true;
  return task.parameterSpecId === input.parameterSpecId;
}

const DRAFT_CREATED_MESSAGE =
  "Draft spec created; complete value shape/constraints and activate before resolve.";

async function loadOccurrenceForDraft(
  db: Queryable,
  input: { propertyOccurrenceId: string; configRevisionId: string },
): Promise<{ astJson: unknown; rawText: string | null }> {
  const result = await db.query<{ ast_json: unknown; raw_text: string }>(
    `
    select ast_json, raw_text
    from dts_property_occurrences
    where id = $1 and config_revision_id = $2
    limit 1
    `,
    [input.propertyOccurrenceId, input.configRevisionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "NOT_FOUND",
      "Property occurrence was not found for draft spec creation.",
      input,
    );
  }
  return { astJson: row.ast_json, rawText: row.raw_text ?? null };
}

export type ResolveSpecReviewTaskResult = {
  id: string;
  status: "open" | "resolved" | "dismissed";
  parameterSpecId?: string | null;
  reason?: string | null;
  draftCreated?: boolean;
  message?: string;
};

/**
 * Apply review decision (occurrence→spec→binding + matcher override) in one transaction.
 * createSpec only creates a draft spec and leaves the task open.
 * Dismiss is fail-closed: no binding is created; release/validate still blocks.
 */
export async function resolveSpecReviewTask(
  db: Database,
  auth: AuthContext,
  input: ResolveSpecReviewTaskBody & { taskId: string },
  context: AuditCorrelationContext = {},
): Promise<ResolveSpecReviewTaskResult> {
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
        throw new ApiError(
          "NOT_FOUND",
          "Parameter spec review task was not found.",
          {
            taskId: input.taskId,
          },
        );
      }
      if (sameResolvedChoice(known, input)) {
        if (input.createSpec) {
          return {
            id: known.id,
            status: "open",
            parameterSpecId: known.parameterSpecId,
            draftCreated: true,
            message: DRAFT_CREATED_MESSAGE,
          };
        }
        return {
          id: known.id,
          status: known.status === "open" ? input.decision : known.status,
          parameterSpecId: known.parameterSpecId,
          reason: known.reason,
        };
      }
      throw new ApiError(
        "CONFLICT",
        "Parameter spec review task already resolved with a different choice.",
        {
          taskId: input.taskId,
          status: known.status,
          parameterSpecId: known.parameterSpecId ?? null,
        },
      );
    }

    const evidence = parseSpecReviewEvidence(locked);
    const locate = requireLocateEvidence(evidence, locked.id);
    await validateSpecReviewTenantEvidence(tx, {
      organizationId: auth.organization.id,
      taskId: locked.id,
      locate,
    });

    let applied: {
      projectId: string;
      configRevisionId: string;
      bindingId?: string;
    };
    let parameterSpecId = input.parameterSpecId;
    let createdSpec = false;
    let propertyKeyMismatchConfirmed = false;
    let mismatchKeys: {
      taskPropertyKey: string | null;
      specPropertyKey: string | null;
    } = {
      taskPropertyKey: null,
      specPropertyKey: null,
    };

    if (input.decision === "resolved" && input.createSpec) {
      if (locked.candidateSchemas.length > 0) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Cannot create a new spec when review task candidates exist; select from the library.",
          { taskId: input.taskId },
        );
      }
      const taskPropertyKey = evidence.propertyKey;
      if (!taskPropertyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Review task evidence is missing propertyKey required to create a spec.",
          { taskId: input.taskId },
        );
      }
      const compatible =
        asString(asRecord(locked.sourceEvidence).compatible) ??
        (Array.isArray(asRecord(locked.sourceEvidence).compatible)
          ? asString(
              (asRecord(locked.sourceEvidence).compatible as unknown[])[0],
            )
          : null);
      const compatibleList = asStringArray(
        asRecord(locked.sourceEvidence).compatible,
      );
      const resolveCompatible = compatible ?? compatibleList[0] ?? null;
      let attributionSubjectId: string | null = null;
      if (resolveCompatible) {
        attributionSubjectId = await ensureAttributionSubjectForCompatible(tx, {
          organizationId: auth.organization.id,
          compatible: resolveCompatible,
        });
      } else {
        throw new ApiError(
          "CONFLICT",
          "Cannot create a manual spec without resolvable attribution subject evidence (compatible).",
          { taskId: input.taskId },
        );
      }
      const occurrence = await loadOccurrenceForDraft(tx, {
        propertyOccurrenceId: locate.propertyOccurrenceId,
        configRevisionId: locate.configRevisionId,
      });
      const created = await createOrgManualParameterSpec(tx, {
        organizationId: auth.organization.id,
        propertyKey: taskPropertyKey,
        attributionSubjectId,
        sourceReviewTaskId: locked.id,
        propertyOccurrenceId: locate.propertyOccurrenceId,
        configRevisionId: locate.configRevisionId,
        reviewerUserId: auth.user.id,
        occurrenceAstJson: occurrence.astJson,
        occurrenceRawText: occurrence.rawText,
      });

      await writeGovernanceAudit(
        asAuditTx(tx),
        auth,
        {
          action: "spec-draft-created",
          projectId: locate.projectId,
          targetType: "parameter-spec",
          targetId: created.parameterSpecId,
          metadata: {
            taskId: locked.id,
            parameterSpecId: created.parameterSpecId,
            parameterSpecVersionId: created.parameterSpecVersionId,
            created: created.created,
            valueShapeKind: created.valueShape.kind ?? null,
            propertyKey: taskPropertyKey,
            configRevisionId: locate.configRevisionId,
            propertyOccurrenceId: locate.propertyOccurrenceId,
            reviewerUserId: auth.user.id,
            reasonHash: hashReason(input.reason),
          },
        },
        context,
      );

      return {
        id: locked.id,
        status: "open",
        parameterSpecId: created.parameterSpecId,
        draftCreated: true,
        message: DRAFT_CREATED_MESSAGE,
      };
    }

    if (input.decision === "resolved") {
      if (!parameterSpecId) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "parameterSpecId is required when resolving a review task.",
        );
      }
      const allowedSpec = await requireOrgOrGlobalSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId,
      });
      assertSpecResolvable(allowedSpec);
      const mismatch = assertPropertyKeyMatchOrConfirmed(
        locked,
        allowedSpec,
        input.confirmPropertyMismatch,
      );
      propertyKeyMismatchConfirmed = mismatch.mismatchConfirmed;
      mismatchKeys = {
        taskPropertyKey: mismatch.taskPropertyKey,
        specPropertyKey: mismatch.specPropertyKey,
      };
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
      asAuditTx(tx),
      auth,
      {
        action:
          input.decision === "resolved"
            ? "spec-review-resolved"
            : "spec-review-dismissed",
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
          propertyOccurrenceId:
            parseSpecReviewEvidence(locked).propertyOccurrenceId,
          logicalNodeId: parseSpecReviewEvidence(locked).logicalNodeId,
          bindingId: applied.bindingId ?? null,
          failClosedDismiss: input.decision === "dismissed",
          createdSpec,
          propertyKeyMismatchConfirmed,
          taskPropertyKey: mismatchKeys.taskPropertyKey,
          specPropertyKey: mismatchKeys.specPropertyKey,
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
      throw new ApiError(
        "CONFLICT",
        "Parameter spec review task is not open.",
        { taskId: input.taskId },
      );
    }

    const openReviewsRemaining = await countOpenSpecReviewTasksForRevision(tx, {
      organizationId: auth.organization.id,
      projectId: applied.projectId,
      configRevisionId: applied.configRevisionId,
    });
    const openMappingsRemaining =
      await countBlockingIdentityMappingTasksForRevision(tx, {
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

function toParameterSpecDetailDto(
  refreshed: ParameterSpecDetailRow,
  cutover?: ParameterSpecCutoverSummaryDto | null,
): ParameterSpecDetailDto {
  return {
    id: refreshed.id,
    organizationId: refreshed.organizationId,
    sourceKind: refreshed.sourceKind,
    specificationKey: refreshed.specificationKey,
    propertyKey: refreshed.propertyKey,
    driverModule: refreshed.driverModule,
    lifecycle: refreshed.lifecycle,
    currentVersionId: refreshed.currentVersionId,
    currentVersion: refreshed.currentVersion,
    displayName: refreshed.displayName,
    description: refreshed.description,
    valueShape: refreshed.valueShape,
    schemaDefault: refreshed.schemaDefault,
    exampleValue: refreshed.exampleValue,
    schemaNamespace: refreshed.schemaNamespace,
    units: refreshed.units,
    constraints: refreshed.constraints,
    documentation: refreshed.documentation,
    compatiblePatterns: refreshed.compatiblePatterns,
    policyTarget: refreshed.policyTarget,
    attributionModules: refreshed.attributionModules,
    attributionSubjectId: refreshed.attributionSubjectId,
    referenceCount: refreshed.referenceCount ?? 0,
    effectiveScope: refreshed.effectiveScope,
    overrideOfSpecId: refreshed.overrideOfSpecId ?? null,
    declaredPlacement: refreshed.declaredPlacement ?? null,
    observationState: refreshed.observationState,
    ...(cutover ? { cutover } : {}),
  };
}

type CutoverImpactCounts = ParameterSpecCutoverSummaryDto["impact"];

function emptyCutoverImpact(): CutoverImpactCounts {
  return { pending: 0, ready: 0, incompatible: 0, skipped: 0, total: 0 };
}

async function loadCutoverImpactCounts(
  tx: Queryable,
  runId: string,
): Promise<CutoverImpactCounts> {
  const counts = await tx.query<{ status: string; count: string }>(
    `
    select status, count(*)::text as count
    from parameter_spec_version_cutover_items
    where run_id = $1
    group by status
    `,
    [runId],
  );
  const impact = emptyCutoverImpact();
  for (const row of counts.rows) {
    const count = Number(row.count ?? 0);
    impact.total += count;
    if (row.status === "pending") impact.pending = count;
    else if (row.status === "ready") impact.ready = count;
    else if (row.status === "incompatible") impact.incompatible = count;
    else if (row.status === "skipped") impact.skipped = count;
  }
  return impact;
}

async function loadOpenCutoverSummaryForSpec(
  tx: Queryable,
  organizationId: string,
  specId: string,
): Promise<ParameterSpecCutoverSummaryDto | null> {
  const run = await tx.query<{
    id: string;
    status: string;
    from_version_id: string;
    to_version_id: string;
    from_version: number;
    to_version: number;
  }>(
    `
    select
      r.id,
      r.status,
      r.from_version_id,
      r.to_version_id,
      fv.version as from_version,
      tv.version as to_version
    from parameter_spec_version_cutover_runs r
    inner join parameter_spec_versions fv on fv.id = r.from_version_id
    inner join parameter_spec_versions tv on tv.id = r.to_version_id
    where r.organization_id = $1
      and r.parameter_spec_id = $2
      and r.status in ('preparing', 'ready')
    limit 1
    `,
    [organizationId, specId],
  );
  const hit = run.rows[0];
  if (!hit) return null;
  const impact = await loadCutoverImpactCounts(tx, hit.id);
  return {
    runId: hit.id,
    status: hit.status as "preparing" | "ready",
    fromVersionId: hit.from_version_id,
    toVersionId: hit.to_version_id,
    fromVersion: hit.from_version,
    toVersion: hit.to_version,
    impact,
  };
}

async function resolveOpenCutoverRunId(
  tx: Queryable,
  organizationId: string,
  specId: string,
): Promise<string | null> {
  const run = await tx.query<{ id: string }>(
    `
    select id
    from parameter_spec_version_cutover_runs
    where organization_id = $1
      and parameter_spec_id = $2
      and status in ('preparing', 'ready')
    limit 1
    for update
    `,
    [organizationId, specId],
  );
  return run.rows[0]?.id ?? null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** `display_name` / `description` are NOT NULL; persist empty string instead of SQL NULL. */
function persistOptionalText(value: string | null): string {
  return value?.trim() ?? "";
}

function activationContentChanged(
  spec: ParameterSpecDetailRow,
  input: ActivateParameterSpecBody,
  nextConstraints: Record<string, unknown>,
): boolean {
  if (stableJson(spec.valueShape) !== stableJson(input.valueShape)) return true;
  if (stableJson(spec.constraints ?? {}) !== stableJson(nextConstraints))
    return true;
  if ((spec.documentation ?? "").trim() !== input.documentation.trim())
    return true;
  if (
    input.displayName !== undefined &&
    input.displayName !== (spec.displayName ?? null)
  )
    return true;
  if (
    input.description !== undefined &&
    input.description !== (spec.description ?? null)
  )
    return true;
  if (input.units !== undefined && input.units !== (spec.units ?? null))
    return true;
  if (
    input.exampleValue !== undefined &&
    stableJson(input.exampleValue) !== stableJson(spec.exampleValue ?? null)
  ) {
    return true;
  }
  return false;
}

function nextSpecVersionId(parameterSpecId: string, version: number): string {
  return stableSemanticId("parameter_spec_version", [
    canonicalIdentityPart("parameterSpecId", parameterSpecId),
    canonicalIdentityPart("version", String(version)),
  ]);
}

export async function createParameterSpec(
  db: Database,
  auth: AuthContext,
  input: CreateParameterSpecBody,
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  const propertyKey = input.propertyKey.trim();
  if (!propertyKey) {
    throw new ApiError("VALIDATION_FAILED", "propertyKey is required.");
  }
  assertNonStructuralPropertyKey(propertyKey);

  if (
    typeof input.attributionSubjectId !== "string" ||
    !input.attributionSubjectId.trim()
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "attributionSubjectId is required.",
    );
  }
  const attributionSubjectId = input.attributionSubjectId.trim();

  return db.transaction(async (tx) => {
    const subject = await tx.query<{
      id: string;
      organization_id: string | null;
      subject_kind: string;
    }>(
      `
      select id, organization_id, subject_kind
      from attribution_subjects
      where id = $1
        and (organization_id = $2 or organization_id is null)
      limit 1
      `,
      [attributionSubjectId, auth.organization.id],
    );
    const subjectRow = subject.rows[0];
    if (!subjectRow) {
      throw new ApiError("NOT_FOUND", "Attribution subject was not found.", {
        attributionSubjectId,
      });
    }
    if (
      subjectRow.subject_kind !== "driver-registration" &&
      subjectRow.subject_kind !== "node-type-definition"
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Parameter definitions must bind to a driver registration or node-type definition.",
        { subjectKind: subjectRow.subject_kind },
      );
    }

    const duplicate = await tx.query<{ id: string }>(
      `
      select ps.id
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      where ps.organization_id = $1
        and ps.attribution_subject_id = $2
        and dps.property_key = $3
      limit 1
      `,
      [auth.organization.id, attributionSubjectId, propertyKey],
    );
    if (duplicate.rows[0]) {
      throw new ApiError(
        "CONFLICT",
        "A parameter definition already exists for this subject and property key.",
        {
          parameterSpecId: duplicate.rows[0].id,
          attributionSubjectId,
          propertyKey,
        },
      );
    }

    const platformTwin = await tx.query<{ id: string }>(
      `
      select ps.id
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      where ps.organization_id is null
        and ps.attribution_subject_id = $1
        and dps.property_key = $2
      limit 1
      `,
      [attributionSubjectId, propertyKey],
    );
    if (platformTwin.rows[0] && !input.overridePlatform) {
      throw new ApiError(
        "CONFLICT",
        "An organization definition would override a platform definition; set overridePlatform to confirm.",
        {
          platformParameterSpecId: platformTwin.rows[0].id,
          attributionSubjectId,
          propertyKey,
          confirmRequired: true,
        },
      );
    }

    const ids = buildSubjectScopedManualSpecIds({
      organizationId: auth.organization.id,
      attributionSubjectId,
      propertyKey,
    });
    const displayName = input.displayName?.trim() || propertyKey;
    const description = input.description?.trim() || displayName;
    const documentation = input.documentation ?? "";
    const valueShape = input.valueShape ?? { kind: "unknown" };
    const constraints = input.constraints ?? {};

    await tx.query(
      `
      insert into parameter_specs (
        id, organization_id, source_kind, specification_key,
        definition_lifecycle, attribution_subject_id, property_key
      ) values ($1, $2, 'manual', $3, 'draft', $4, $5)
      `,
      [
        ids.parameterSpecId,
        auth.organization.id,
        ids.specificationKey,
        attributionSubjectId,
        propertyKey,
      ],
    );
    await tx.query(
      `
      insert into parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        schema_default, example_value, lifecycle, version_status,
        units, constraints, documentation
      ) values (
        $1, $2, 1, $3, $4, $5::jsonb,
        null, $6::jsonb, 'draft', 'draft',
        $7, $8::jsonb, $9
      )
      `,
      [
        ids.parameterSpecVersionId,
        ids.parameterSpecId,
        displayName,
        description,
        JSON.stringify(valueShape),
        input.exampleValue === undefined
          ? null
          : JSON.stringify(input.exampleValue),
        input.units ?? null,
        JSON.stringify(constraints),
        documentation || null,
      ],
    );
    await tx.query(
      `
      insert into dts_property_specs (
        id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
        units, constraints, documentation
      ) values ($1, $2, null, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        ids.dtsPropertySpecId,
        ids.parameterSpecId,
        propertyKey,
        ids.schemaNamespace,
        input.units ?? null,
        JSON.stringify(constraints),
        documentation || null,
      ],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-draft-created",
        targetType: "parameter-spec",
        targetId: ids.parameterSpecId,
        metadata: {
          parameterSpecId: ids.parameterSpecId,
          attributionSubjectId,
          propertyKey,
          overridePlatform: Boolean(input.overridePlatform),
          platformParameterSpecId: platformTwin.rows[0]?.id ?? null,
          reasonHash: hashReason(input.reason),
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: ids.parameterSpecId,
    });
    if (!refreshed) {
      throw new ApiError(
        "NOT_FOUND",
        "Parameter spec was not found after create.",
        {
          specId: ids.parameterSpecId,
        },
      );
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

export async function activateParameterSpec(
  db: Database,
  auth: AuthContext,
  input: ActivateParameterSpecBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const spec = await requireOrgOwnedSpec(tx, {
      organizationId: auth.organization.id,
      parameterSpecId: input.specId,
    });
    if (spec.lifecycle === "deprecated") {
      throw new ApiError(
        "CONFLICT",
        "Deprecated parameter specs cannot be activated.",
        {
          parameterSpecId: input.specId,
          lifecycle: spec.lifecycle,
        },
      );
    }
    if (spec.lifecycle !== "draft" && spec.lifecycle !== "active") {
      throw new ApiError(
        "CONFLICT",
        "Only draft or active parameter specs can be activated.",
        {
          parameterSpecId: input.specId,
          lifecycle: spec.lifecycle,
        },
      );
    }
    if (!spec.currentVersionId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Parameter spec has no version to activate.",
        {
          parameterSpecId: input.specId,
        },
      );
    }

    const nextConstraints = input.constraints;
    assertSpecActivatable({
      parameterSpecId: input.specId,
      valueShape: input.valueShape,
      constraints: nextConstraints,
      documentation: input.documentation,
      storedValueShape:
        spec.lifecycle === "draft" ? spec.valueShape : undefined,
    });

    // Mature create path (subject-bound definitions) requires an explicit coverage claim.
    if (spec.attributionSubjectId && spec.lifecycle === "draft") {
      const propertyKey = (spec.propertyKey ?? "").trim();
      if (!propertyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Subject-bound definitions require a property key before activation.",
          { parameterSpecId: input.specId },
        );
      }
      const existingClaim = await findExistingCoverageClaim(tx, {
        organizationId: auth.organization.id,
        parameterSpecId: input.specId,
        propertyKey,
      });
      if (!existingClaim && !input.coverageClaim) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Activation requires an explicit coverage claim linking this definition to schema/overlay coverage.",
          {
            parameterSpecId: input.specId,
            attributionSubjectId: spec.attributionSubjectId,
          },
        );
      }
      if (input.coverageClaim) {
        await ensureExplicitOverlayCoverageClaim(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
          propertyKey,
          claim: input.coverageClaim,
          createdByUserId: auth.user.id,
        });
      }
    }

    const displayName =
      input.displayName === undefined
        ? (spec.displayName ?? spec.propertyKey ?? input.specId)
        : persistOptionalText(input.displayName);
    const description =
      input.description === undefined
        ? (spec.description ?? displayName)
        : input.description?.trim() || displayName;
    const nextUnits =
      input.units === undefined ? (spec.units ?? null) : input.units;
    const nextExampleValue =
      input.exampleValue === undefined
        ? (spec.exampleValue ?? null)
        : input.exampleValue;
    const contentChanged = activationContentChanged(
      spec,
      input,
      nextConstraints,
    );
    const createSuccessor = spec.lifecycle === "active" && contentChanged;
    let activatedVersionId = spec.currentVersionId;
    let activatedVersion = spec.currentVersion ?? 1;

    if (createSuccessor) {
      const nextVersion = (spec.currentVersion ?? 1) + 1;
      const nextVersionId = nextSpecVersionId(input.specId, nextVersion);

      // Insert draft successor; v1 stays active until cutover finalize (ADR-0014).
      await tx.query(
        `
        insert into parameter_spec_versions (
          id, parameter_spec_id, version, display_name, description, value_shape,
          schema_default, example_value, lifecycle, version_status, activated_at,
          units, constraints, documentation, reference_rules
        ) values (
          $1, $2, $3, $4, $5, $6::jsonb,
          $7::jsonb, $8::jsonb, 'draft', 'draft', null,
          $9, $10::jsonb, $11, coalesce($12::jsonb, '{}'::jsonb)
        )
        `,
        [
          nextVersionId,
          input.specId,
          nextVersion,
          displayName,
          description,
          JSON.stringify(input.valueShape),
          spec.schemaDefault === undefined || spec.schemaDefault === null
            ? null
            : JSON.stringify(spec.schemaDefault),
          nextExampleValue === undefined || nextExampleValue === null
            ? null
            : JSON.stringify(nextExampleValue),
          nextUnits,
          JSON.stringify(nextConstraints),
          input.documentation,
          null,
        ],
      );

      const tipBindings = await tx.query<{
        binding_id: string;
        project_id: string | null;
        revision_id: string;
      }>(
        `
        select distinct on (b.id)
          b.id as binding_id,
          b.project_id,
          br.id as revision_id
        from project_parameter_bindings b
        inner join project_parameter_binding_revisions br
          on br.binding_id = b.id
         and br.parameter_spec_version_id = $1
        where b.organization_id = $2
          and b.parameter_spec_id = $3
        order by b.id, br.created_at desc
        `,
        [spec.currentVersionId, auth.organization.id, input.specId],
      );

      const runId = randomUUID();
      const canAutoFinalize = tipBindings.rows.length === 0;
      await tx.query(
        `
        insert into parameter_spec_version_cutover_runs (
          id, organization_id, parameter_spec_id, from_version_id, to_version_id,
          status, created_by_user_id, finalized_at, metadata
        ) values (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9::jsonb
        )
        `,
        [
          runId,
          auth.organization.id,
          input.specId,
          spec.currentVersionId,
          nextVersionId,
          canAutoFinalize ? "finalized" : "preparing",
          auth.user.id,
          canAutoFinalize ? new Date().toISOString() : null,
          JSON.stringify({
            reasonHash: hashReason(input.reason),
            autoFinalized: canAutoFinalize,
            tipBindingCount: tipBindings.rows.length,
          }),
        ],
      );

      for (const tip of tipBindings.rows) {
        await tx.query(
          `
          insert into parameter_spec_version_cutover_items (
            id, run_id, binding_id, project_id, status, base_revision_id, details
          ) values ($1, $2, $3, $4, 'pending', $5, '{}'::jsonb)
          `,
          [
            randomUUID(),
            runId,
            tip.binding_id,
            tip.project_id,
            tip.revision_id,
          ],
        );
      }

      if (canAutoFinalize) {
        await tx.query(
          `
          update parameter_spec_versions
          set version_status = 'superseded', lifecycle = 'deprecated'
          where id = $1 and parameter_spec_id = $2
          `,
          [spec.currentVersionId, input.specId],
        );
        await tx.query(
          `
          update parameter_spec_versions
          set
            version_status = 'active',
            lifecycle = 'active',
            activated_at = now()
          where id = $1 and parameter_spec_id = $2
          `,
          [nextVersionId, input.specId],
        );
        activatedVersionId = nextVersionId;
        activatedVersion = nextVersion;
      } else {
        // Keep v1 active; draft v2 waits for finalize.
        activatedVersionId = spec.currentVersionId;
        activatedVersion = spec.currentVersion ?? 1;
      }
    } else {
      await tx.query(
        `
        update parameter_spec_versions
        set
          display_name = $3,
          description = $4,
          value_shape = $5::jsonb,
          lifecycle = 'active',
          version_status = 'active',
          activated_at = coalesce(activated_at, now()),
          units = case when $9::boolean then $6 else units end,
          example_value = case when $10::boolean then $11::jsonb else example_value end,
          constraints = $7::jsonb,
          documentation = $8
        where id = $1 and parameter_spec_id = $2
        `,
        [
          spec.currentVersionId,
          input.specId,
          displayName,
          description,
          JSON.stringify(input.valueShape),
          nextUnits,
          JSON.stringify(nextConstraints),
          input.documentation,
          input.units !== undefined,
          input.exampleValue !== undefined,
          input.exampleValue === undefined
            ? null
            : JSON.stringify(input.exampleValue),
        ],
      );
    }

    await tx.query(
      `
      update parameter_specs
      set definition_lifecycle = 'active'
      where id = $1
      `,
      [input.specId],
    );

    await tx.query(
      `
      update dts_property_specs
      set
        constraints = $2::jsonb,
        documentation = $3,
        units = case when $5::boolean then $4 else units end
      where parameter_spec_id = $1
      `,
      [
        input.specId,
        JSON.stringify(nextConstraints),
        input.documentation,
        nextUnits,
        input.units !== undefined,
      ],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-activated",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: activatedVersionId,
          version: activatedVersion,
          successorCreated: createSuccessor,
          valueShapeKind:
            input.valueShape &&
            typeof input.valueShape === "object" &&
            "kind" in input.valueShape
              ? String((input.valueShape as { kind: unknown }).kind)
              : null,
          reasonHash: hashReason(input.reason),
          previousLifecycle: spec.lifecycle,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

export async function updateParameterSpec(
  db: Database,
  auth: AuthContext,
  input: UpdateParameterSpecBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    // Org admins update org-owned specs; platform super admins may also update platform-global specs.
    const spec = isPlatformSuperAdmin(auth)
      ? await requireOrgOrGlobalSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        })
      : await requireOrgOwnedSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        });
    if (spec.lifecycle === "draft") {
      throw new ApiError(
        "CONFLICT",
        "Draft specs must be activated, not updated.",
        {
          parameterSpecId: input.specId,
          lifecycle: spec.lifecycle,
        },
      );
    }

    const semanticGate = guardSemanticFieldPatch(
      spec.lifecycle,
      input.specId,
      {
        valueShape: spec.valueShape,
        constraints: spec.constraints,
        units: spec.units ?? null,
      },
      {
        valueShape: input.valueShape,
        constraints: input.constraints,
        units: input.units,
      },
    );
    if (!semanticGate.ok) {
      throw new ApiError(
        semanticGate.code,
        semanticGate.message,
        semanticGate.details,
      );
    }

    const nextValueShape = input.valueShape ?? spec.valueShape ?? {};
    const nextConstraints = input.constraints ?? spec.constraints ?? {};
    if (!input.documentation.trim()) {
      throw new ApiError("VALIDATION_FAILED", "documentation is required.");
    }
    if (
      input.valueShape !== undefined &&
      stableJson(nextValueShape) !== stableJson(spec.valueShape)
    ) {
      assertSpecActivatable({
        parameterSpecId: input.specId,
        valueShape: nextValueShape,
        constraints: nextConstraints,
        documentation: input.documentation,
      });
    }

    await tx.query(
      `
      update parameter_spec_versions
      set
        display_name = case when $10::boolean then $3 else display_name end,
        description = case when $11::boolean then $4 else description end,
        value_shape = $5::jsonb,
        example_value = case when $12::boolean then $6::jsonb else example_value end,
        units = case when $13::boolean then $7 else units end,
        constraints = $8::jsonb,
        documentation = $9
      where id = $1 and parameter_spec_id = $2
      `,
      [
        spec.currentVersionId,
        input.specId,
        input.displayName === undefined
          ? null
          : persistOptionalText(input.displayName),
        input.description === undefined
          ? null
          : persistOptionalText(input.description),
        JSON.stringify(nextValueShape),
        input.exampleValue === undefined
          ? null
          : JSON.stringify(input.exampleValue),
        input.units === undefined ? null : input.units,
        JSON.stringify(nextConstraints),
        input.documentation,
        input.displayName !== undefined,
        input.description !== undefined,
        input.exampleValue !== undefined,
        input.units !== undefined,
      ],
    );
    await tx.query(
      `
      update dts_property_specs
      set
        constraints = $2::jsonb,
        documentation = $3,
        units = case when $5::boolean then $4 else units end
      where parameter_spec_id = $1
      `,
      [
        input.specId,
        JSON.stringify(nextConstraints),
        input.documentation,
        input.units === undefined ? null : input.units,
        input.units !== undefined,
      ],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-updated",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: spec.currentVersionId,
          reasonHash: hashReason(input.reason),
          lifecycle: spec.lifecycle,
          previousValueShape: spec.valueShape ?? null,
          nextValueShape: nextValueShape,
          previousConstraints: spec.constraints ?? {},
          nextConstraints: nextConstraints,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

export async function deprecateParameterSpec(
  db: Database,
  auth: AuthContext,
  input: DeprecateParameterSpecBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    // Org admins govern org-owned specs; platform super admins may also govern platform-global specs.
    const spec = isPlatformSuperAdmin(auth)
      ? await requireOrgOrGlobalSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        })
      : await requireOrgOwnedSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        });
    if (spec.lifecycle !== "draft" && spec.lifecycle !== "active") {
      throw new ApiError(
        "CONFLICT",
        "Only draft or active parameter specs can be deprecated.",
        {
          parameterSpecId: input.specId,
          lifecycle: spec.lifecycle,
        },
      );
    }

    await tx.query(
      `
      update parameter_specs
      set definition_lifecycle = 'deprecated'
      where id = $1
      `,
      [input.specId],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-deprecated",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: spec.currentVersionId,
          reasonHash: hashReason(input.reason),
          previousLifecycle: spec.lifecycle,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

export async function restoreParameterSpec(
  db: Database,
  auth: AuthContext,
  input: RestoreParameterSpecBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const spec = isPlatformSuperAdmin(auth)
      ? await requireOrgOrGlobalSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        })
      : await requireOrgOwnedSpec(tx, {
          organizationId: auth.organization.id,
          parameterSpecId: input.specId,
        });
    if (spec.lifecycle !== "deprecated") {
      throw new ApiError(
        "CONFLICT",
        "Only deprecated parameter specs can be restored.",
        {
          parameterSpecId: input.specId,
          lifecycle: spec.lifecycle,
        },
      );
    }

    const activated = await tx.query<{ activated_at: string | null }>(
      `
      select activated_at::text as activated_at
      from parameter_spec_versions
      where parameter_spec_id = $1
        and activated_at is not null
      order by version desc
      limit 1
      `,
      [input.specId],
    );
    const nextLifecycle = activated.rows[0]?.activated_at ? "active" : "draft";

    await tx.query(
      `
      update parameter_specs
      set definition_lifecycle = $2
      where id = $1
      `,
      [input.specId, nextLifecycle],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-restored",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: spec.currentVersionId,
          reasonHash: hashReason(input.reason),
          previousLifecycle: spec.lifecycle,
          nextLifecycle,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

async function requireGovernableSpec(
  tx: Queryable,
  auth: AuthContext,
  specId: string,
): Promise<ParameterSpecDetailRow> {
  return isPlatformSuperAdmin(auth)
    ? requireOrgOrGlobalSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId: specId,
      })
    : requireOrgOwnedSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId: specId,
      });
}

async function assertAttributionSubjectUsable(
  tx: Queryable,
  input: { organizationId: string | null; attributionSubjectId: string },
) {
  const subject = await tx.query<{
    subject_kind: string;
    organization_id: string | null;
  }>(
    `
    select subject_kind, organization_id
    from attribution_subjects
    where id = $1
      and (
        ($2::text is null and organization_id is null)
        or organization_id = $2
        or organization_id is null
      )
    limit 1
    `,
    [input.attributionSubjectId, input.organizationId],
  );
  const subjectRow = subject.rows[0];
  if (!subjectRow) {
    throw new ApiError("NOT_FOUND", "Attribution subject was not found.", {
      attributionSubjectId: input.attributionSubjectId,
    });
  }
  if (
    subjectRow.subject_kind !== "driver-registration" &&
    subjectRow.subject_kind !== "node-type-definition"
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter definitions must bind to a driver registration or node-type definition.",
      { subjectKind: subjectRow.subject_kind },
    );
  }
}

async function assertIdentityTripleAvailable(
  tx: Queryable,
  input: {
    organizationId: string | null;
    attributionSubjectId: string;
    propertyKey: string;
    excludeSpecId: string;
  },
) {
  const conflict = await findParameterSpecByIdentity(tx, {
    organizationId: input.organizationId,
    attributionSubjectId: input.attributionSubjectId,
    propertyKey: input.propertyKey,
  });
  if (conflict && conflict.parameterSpecId !== input.excludeSpecId) {
    const blocker = await getParameterSpecRow(tx, {
      organizationId: input.organizationId ?? "",
      specId: conflict.parameterSpecId,
    });
    throw new ApiError(
      "CONFLICT",
      "A parameter definition already exists for this subject and property key.",
      {
        parameterSpecId: conflict.parameterSpecId,
        lifecycle: blocker?.lifecycle ?? null,
        attributionSubjectId: input.attributionSubjectId,
        propertyKey: input.propertyKey,
      },
    );
  }
}

/**
 * Correct a mis-authored attribution subject in place (ADR-0017).
 * Allowed in any lifecycle; does not rewrite `parameter_specs.id`.
 *
 * A DTS property whose DriverSchema already names another subject is not
 * independently reattributable: changing only the property row would break
 * the canonical driver graph. Those rows stay fail-closed for the audited
 * reconciliation command, which has the schema candidate needed to repair
 * the whole tuple. A DTS driver root with an unassigned subject is safe to
 * complete here, so its root row is updated in the same transaction.
 */
export async function reattributeParameterSpec(
  db: Database,
  auth: AuthContext,
  input: ReattributeParameterSpecBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);
  const nextSubjectId = input.attributionSubjectId.trim();

  return db.transaction(async (tx) => {
    const spec = await requireGovernableSpec(tx, auth, input.specId);
    const previousSubjectId = spec.attributionSubjectId;
    const propertyKey = spec.propertyKey?.trim();
    if (!propertyKey) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Parameter definition is missing property_key; cannot reattribute.",
        { parameterSpecId: input.specId },
      );
    }
    if (previousSubjectId === nextSubjectId) {
      return { item: toParameterSpecDetailDto(spec) };
    }

    const dtsProperty = await tx.query<{
      driver_schema_id: string | null;
      property_key: string | null;
    }>(
      `select driver_schema_id, property_key
       from dts_property_specs
       where parameter_spec_id = $1
       for update`,
      [input.specId],
    );
    const dtsPropertyRow = dtsProperty.rows[0] ?? null;
    const driverRoots = await tx.query<{
      id: string;
      organization_id: string | null;
      attribution_subject_id: string | null;
    }>(
      `select id, organization_id, attribution_subject_id
       from driver_schemas
       where parameter_spec_id = $1
       for update`,
      [input.specId],
    );
    const rootIdsNeedingSubject = driverRoots.rows
      .filter((root) => root.attribution_subject_id === null)
      .map((root) => root.id);

    if (spec.sourceKind === "dts") {
      if (
        dtsPropertyRow &&
        dtsPropertyRow.property_key !== null &&
        dtsPropertyRow.property_key !== propertyKey
      ) {
        throw new ApiError(
          "CONFLICT",
          "A DTS property key mismatch must be repaired by parameter-definition reconciliation.",
          {
            parameterSpecId: input.specId,
            parameterPropertyKey: propertyKey,
            dtsPropertyKey: dtsPropertyRow.property_key,
          },
        );
      }
      if (dtsPropertyRow?.driver_schema_id) {
        const schema = await tx.query<{
          attribution_subject_id: string | null;
          organization_id: string | null;
        }>(
          `select attribution_subject_id, organization_id
           from driver_schemas
           where id = $1
           for update`,
          [dtsPropertyRow.driver_schema_id],
        );
        const schemaRow = schema.rows[0];
        if (
          !schemaRow ||
          schemaRow.attribution_subject_id !== nextSubjectId ||
          (schemaRow.organization_id !== null &&
            schemaRow.organization_id !== spec.organizationId)
        ) {
          throw new ApiError(
            "CONFLICT",
            "A linked DTS DriverSchema identity must be repaired by parameter-definition reconciliation.",
            {
              parameterSpecId: input.specId,
              driverSchemaId: dtsPropertyRow.driver_schema_id,
              requestedSubjectId: nextSubjectId,
              driverSchemaSubjectId: schemaRow?.attribution_subject_id ?? null,
            },
          );
        }
      }
      const conflictingRoot = driverRoots.rows.find(
        (root) =>
          root.attribution_subject_id !== null &&
          root.attribution_subject_id !== nextSubjectId,
      );
      if (conflictingRoot) {
        throw new ApiError(
          "CONFLICT",
          "A DTS driver root identity must be repaired by parameter-definition reconciliation.",
          {
            parameterSpecId: input.specId,
            driverSchemaId: conflictingRoot.id,
            requestedSubjectId: nextSubjectId,
            driverSchemaSubjectId: conflictingRoot.attribution_subject_id,
          },
        );
      }
      if (rootIdsNeedingSubject.length > 0) {
        const references = await tx.query<{ parameter_spec_id: string }>(
          `select distinct parameter_spec_id
           from dts_property_specs
           where driver_schema_id = any($1::text[])
             and parameter_spec_id <> $2
           limit 1`,
          [rootIdsNeedingSubject, input.specId],
        );
        if (references.rows[0]) {
          throw new ApiError(
            "CONFLICT",
            "A shared DTS driver root identity must be repaired by parameter-definition reconciliation.",
            {
              parameterSpecId: input.specId,
              driverSchemaId: rootIdsNeedingSubject[0],
              referencedPropertySpecId: references.rows[0].parameter_spec_id,
            },
          );
        }
      }
    }

    await assertAttributionSubjectUsable(tx, {
      organizationId: spec.organizationId,
      attributionSubjectId: nextSubjectId,
    });
    await assertIdentityTripleAvailable(tx, {
      organizationId: spec.organizationId,
      attributionSubjectId: nextSubjectId,
      propertyKey,
      excludeSpecId: input.specId,
    });

    const derived = buildSubjectScopedManualSpecIds({
      organizationId: spec.organizationId,
      attributionSubjectId: nextSubjectId,
      propertyKey,
    });

    await tx.query(
      `
      update parameter_specs
      set attribution_subject_id = $2,
          property_key = $3,
          specification_key = $4
      where id = $1
      `,
      [input.specId, nextSubjectId, propertyKey, derived.specificationKey],
    );
    if (rootIdsNeedingSubject.length > 0) {
      await tx.query(
        `update driver_schemas
         set attribution_subject_id = $2
         where id = any($1::text[])`,
        [rootIdsNeedingSubject, nextSubjectId],
      );
    }
    await tx.query(
      `
      update dts_property_specs
      set schema_namespace = $2,
          property_key = $3
      where parameter_spec_id = $1
      `,
      [input.specId, derived.schemaNamespace, propertyKey],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-reattributed",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: spec.currentVersionId,
          reasonHash: hashReason(input.reason),
          previousAttributionSubjectId: previousSubjectId,
          nextAttributionSubjectId: nextSubjectId,
          propertyKey,
          previousSpecificationKey: spec.specificationKey,
          nextSpecificationKey: derived.specificationKey,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

/**
 * Correct a mis-authored property key in place (ADR-0017).
 * Refused while any project binding references the definition.
 */
export async function renameParameterSpecPropertyKey(
  db: Database,
  auth: AuthContext,
  input: RenameParameterSpecPropertyKeyBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);
  const nextPropertyKey = input.propertyKey.trim();
  assertNonStructuralPropertyKey(nextPropertyKey);

  return db.transaction(async (tx) => {
    const spec = await requireGovernableSpec(tx, auth, input.specId);
    const previousPropertyKey = spec.propertyKey?.trim() ?? "";
    const attributionSubjectId = spec.attributionSubjectId;
    if (!attributionSubjectId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Parameter definition is missing attribution_subject_id; cannot rename.",
        { parameterSpecId: input.specId },
      );
    }
    if (previousPropertyKey === nextPropertyKey) {
      return { item: toParameterSpecDetailDto(spec) };
    }

    const referenceCounts = await loadReferenceCountsBySpecIds(tx, {
      organizationId: auth.organization.id,
      specIds: [input.specId],
    });
    const referenceCount = referenceCounts.get(input.specId) ?? 0;
    if (referenceCount > 0) {
      throw new ApiError(
        "CONFLICT",
        `Cannot rename property_key while ${referenceCount} project binding(s) reference this definition.`,
        {
          parameterSpecId: input.specId,
          referenceCount,
          propertyKey: previousPropertyKey,
        },
      );
    }

    await assertIdentityTripleAvailable(tx, {
      organizationId: spec.organizationId,
      attributionSubjectId,
      propertyKey: nextPropertyKey,
      excludeSpecId: input.specId,
    });

    const derived = buildSubjectScopedManualSpecIds({
      organizationId: spec.organizationId,
      attributionSubjectId,
      propertyKey: nextPropertyKey,
    });

    await tx.query(
      `
      update parameter_specs
      set property_key = $2,
          specification_key = $3
      where id = $1
      `,
      [input.specId, nextPropertyKey, derived.specificationKey],
    );
    await tx.query(
      `
      update dts_property_specs
      set property_key = $2,
          schema_namespace = $3
      where parameter_spec_id = $1
      `,
      [input.specId, nextPropertyKey, derived.schemaNamespace],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-property-key-changed",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          parameterSpecVersionId: spec.currentVersionId,
          reasonHash: hashReason(input.reason),
          attributionSubjectId,
          previousPropertyKey,
          nextPropertyKey,
          previousSpecificationKey: spec.specificationKey,
          nextSpecificationKey: derived.specificationKey,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}

export async function getParameterSpecVersionCutoverImpact(
  db: Database,
  auth: AuthContext,
  specId: string,
): Promise<{ item: ParameterSpecCutoverSummaryDto }> {
  requireCanView(auth);
  await requireOrgOwnedSpec(db, {
    organizationId: auth.organization.id,
    parameterSpecId: specId,
  });
  const cutover = await loadOpenCutoverSummaryForSpec(
    db,
    auth.organization.id,
    specId,
  );
  if (!cutover) {
    throw new ApiError(
      "NOT_FOUND",
      "No open version cutover run for this spec.",
      { specId },
    );
  }
  return { item: cutover };
}

export async function prepareParameterSpecVersionCutover(
  db: Database,
  auth: AuthContext,
  input: PrepareParameterSpecCutoverBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    await requireOrgOwnedSpec(tx, {
      organizationId: auth.organization.id,
      parameterSpecId: input.specId,
    });

    const runId = await resolveOpenCutoverRunId(
      tx,
      auth.organization.id,
      input.specId,
    );
    if (!runId) {
      throw new ApiError(
        "NOT_FOUND",
        "No open version cutover run for this spec.",
        {
          specId: input.specId,
        },
      );
    }

    const run = await tx.query<{
      id: string;
      status: string;
      parameter_spec_id: string;
    }>(
      `
      select id, status, parameter_spec_id
      from parameter_spec_version_cutover_runs
      where id = $1
        and organization_id = $2
      limit 1
      for update
      `,
      [runId, auth.organization.id],
    );
    const hit = run.rows[0];
    if (!hit) {
      throw new ApiError("NOT_FOUND", "Version cutover run was not found.", {
        runId,
      });
    }

    if (hit.status === "ready") {
      const refreshed = await getParameterSpecRow(tx, {
        organizationId: auth.organization.id,
        specId: input.specId,
      });
      if (!refreshed) {
        throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
          specId: input.specId,
        });
      }
      const cutover = await loadOpenCutoverSummaryForSpec(
        tx,
        auth.organization.id,
        input.specId,
      );
      return { item: toParameterSpecDetailDto(refreshed, cutover) };
    }

    if (hit.status !== "preparing") {
      throw new ApiError(
        "CONFLICT",
        "Cutover run cannot be prepared from its current status.",
        {
          runId,
          status: hit.status,
        },
      );
    }

    const pendingItems = await tx.query<{
      id: string;
      base_revision_id: string | null;
    }>(
      `
      select id, base_revision_id
      from parameter_spec_version_cutover_items
      where run_id = $1
        and status = 'pending'
      `,
      [runId],
    );

    for (const item of pendingItems.rows) {
      if (!item.base_revision_id) {
        await tx.query(
          `
          update parameter_spec_version_cutover_items
          set status = 'incompatible', incompatibility_code = 'base-revision-missing'
          where id = $1
          `,
          [item.id],
        );
        continue;
      }

      const revision = await tx.query<{ id: string }>(
        `
        select id
        from project_parameter_binding_revisions
        where id = $1
        limit 1
        `,
        [item.base_revision_id],
      );
      if (!revision.rows[0]) {
        await tx.query(
          `
          update parameter_spec_version_cutover_items
          set status = 'incompatible', incompatibility_code = 'base-revision-missing'
          where id = $1
          `,
          [item.id],
        );
      } else {
        await tx.query(
          `
          update parameter_spec_version_cutover_items
          set status = 'ready', successor_revision_id = $2
          where id = $1
          `,
          [item.id, item.base_revision_id],
        );
      }
    }

    const impact = await loadCutoverImpactCounts(tx, runId);
    const nextStatus =
      impact.pending > 0 || impact.incompatible > 0 ? "preparing" : "ready";
    await tx.query(
      `
      update parameter_spec_version_cutover_runs
      set status = $2
      where id = $1
      `,
      [runId, nextStatus],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-version-cutover-prepared",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          runId,
          nextStatus,
          reasonHash: input.reason ? hashReason(input.reason) : null,
          impact,
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: input.specId,
      });
    }
    const cutover = await loadOpenCutoverSummaryForSpec(
      tx,
      auth.organization.id,
      input.specId,
    );
    return { item: toParameterSpecDetailDto(refreshed, cutover) };
  });
}

export async function finalizeParameterSpecVersionCutoverForSpec(
  db: Database,
  auth: AuthContext,
  input: FinalizeParameterSpecCutoverBody & { specId: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  const runId = await db.query<{ id: string }>(
    `
    select id
    from parameter_spec_version_cutover_runs
    where organization_id = $1
      and parameter_spec_id = $2
      and status in ('preparing', 'ready')
    limit 1
    `,
    [auth.organization.id, input.specId],
  );
  const hit = runId.rows[0];
  if (!hit) {
    throw new ApiError(
      "NOT_FOUND",
      "No open version cutover run for this spec.",
      {
        specId: input.specId,
      },
    );
  }
  return finalizeParameterSpecVersionCutover(
    db,
    auth,
    { runId: hit.id, reason: input.reason },
    context,
  );
}

export async function finalizeParameterSpecVersionCutover(
  db: Database,
  auth: AuthContext,
  input: { runId: string; reason: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const run = await tx.query<{
      id: string;
      organization_id: string;
      parameter_spec_id: string;
      from_version_id: string;
      to_version_id: string;
      status: string;
    }>(
      `
      select id, organization_id, parameter_spec_id, from_version_id, to_version_id, status
      from parameter_spec_version_cutover_runs
      where id = $1
        and organization_id = $2
      limit 1
      for update
      `,
      [input.runId, auth.organization.id],
    );
    const hit = run.rows[0];
    if (!hit) {
      throw new ApiError("NOT_FOUND", "Version cutover run was not found.", {
        runId: input.runId,
      });
    }

    if (hit.status === "finalized") {
      const refreshed = await getParameterSpecRow(tx, {
        organizationId: auth.organization.id,
        specId: hit.parameter_spec_id,
      });
      if (!refreshed) {
        throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
          specId: hit.parameter_spec_id,
        });
      }
      return { item: toParameterSpecDetailDto(refreshed) };
    }

    if (hit.status !== "preparing" && hit.status !== "ready") {
      throw new ApiError(
        "CONFLICT",
        "Cutover run cannot be finalized from its current status.",
        {
          runId: input.runId,
          status: hit.status,
        },
      );
    }

    const blockers = await tx.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_spec_version_cutover_items
      where run_id = $1
        and status in ('pending', 'incompatible')
      `,
      [input.runId],
    );
    if (Number(blockers.rows[0]?.count ?? 0) > 0) {
      throw new ApiError(
        "CONFLICT",
        "Cutover cannot finalize while binding items remain pending or incompatible.",
        {
          runId: input.runId,
          blockingItems: Number(blockers.rows[0]?.count ?? 0),
        },
      );
    }

    await tx.query(
      `
      update project_parameter_binding_revisions br
      set parameter_spec_version_id = $1
      from parameter_spec_version_cutover_items ci
      where ci.run_id = $2
        and ci.status = 'ready'
        and br.id = ci.successor_revision_id
      `,
      [hit.to_version_id, input.runId],
    );

    await tx.query(
      `
      update parameter_spec_versions
      set version_status = 'superseded', lifecycle = 'deprecated'
      where id = $1 and parameter_spec_id = $2
      `,
      [hit.from_version_id, hit.parameter_spec_id],
    );
    await tx.query(
      `
      update parameter_spec_versions
      set
        version_status = 'active',
        lifecycle = 'active',
        activated_at = coalesce(activated_at, now())
      where id = $1 and parameter_spec_id = $2
      `,
      [hit.to_version_id, hit.parameter_spec_id],
    );
    await tx.query(
      `
      update parameter_specs
      set definition_lifecycle = 'active'
      where id = $1
      `,
      [hit.parameter_spec_id],
    );
    await tx.query(
      `
      update parameter_spec_version_cutover_items
      set status = 'applied'
      where run_id = $1
        and status = 'ready'
      `,
      [input.runId],
    );
    await tx.query(
      `
      update parameter_spec_version_cutover_runs
      set status = 'finalized', finalized_at = now()
      where id = $1
      `,
      [input.runId],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-version-cutover-finalized",
        targetType: "parameter-spec",
        targetId: hit.parameter_spec_id,
        metadata: {
          parameterSpecId: hit.parameter_spec_id,
          runId: hit.id,
          fromVersionId: hit.from_version_id,
          toVersionId: hit.to_version_id,
          reasonHash: hashReason(input.reason),
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: hit.parameter_spec_id,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", {
        specId: hit.parameter_spec_id,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}
