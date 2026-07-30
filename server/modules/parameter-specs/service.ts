import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import { countOpenIdentityMappingTasksForRevision } from "../parameter-topology/bindingService";
import { stableSemanticId } from "../parameter-topology/migration";
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
import { assertSpecActivatable, assertSpecResolvable } from "./specCompleteness";
import {
  ensureExplicitOverlayCoverageClaim,
  findExistingCoverageClaim,
} from "./coverageClaim";
import {
  countOpenSpecReviewTasksForRevision,
  getParameterSpecRow,
  getSpecReviewTaskById,
  listParameterSpecRows,
  listSpecReviewTaskRows,
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
import type {
  ActivateParameterSpecBody,
  CreateParameterSpecBody,
  DeprecateParameterSpecBody,
  ListParameterSpecsQuery,
  ListSpecReviewTasksQuery,
  ParameterSpecDetailDto,
  ParameterSpecReviewTaskDto,
  ParameterSpecSummaryDto,
  ResolveSpecReviewTaskBody,
  RestoreParameterSpecBody,
  UpdateParameterSpecBody,
} from "./schemas";

function isPlatformSuperAdmin(auth: AuthContext) {
  return auth.roles.some((binding) => binding.roleId === "platform-admin");
}
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
      return {
        id,
        label: candidateLabel(candidate, id),
        propertyKey: asString(candidate.propertyKey),
        driverModule: asString(candidate.schemaNamespace),
      };
    })
    .filter(
      (item): item is { id: string; label: string; propertyKey: string | null; driverModule: string | null } =>
        item != null,
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
  return { item: toParameterSpecDetailDto(row) };
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
    throw new ApiError("NOT_FOUND", "Property occurrence was not found for draft spec creation.", 404, input);
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
        throw new ApiError("NOT_FOUND", "Parameter spec review task was not found.", 404, {
          taskId: input.taskId,
        });
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
      throw new ApiError("CONFLICT", "Parameter spec review task already resolved with a different choice.", 409, {
        taskId: input.taskId,
        status: known.status,
        parameterSpecId: known.parameterSpecId ?? null,
      });
    }

    const evidence = parseSpecReviewEvidence(locked);
    const locate = requireLocateEvidence(evidence, locked.id);
    await validateSpecReviewTenantEvidence(tx, {
      organizationId: auth.organization.id,
      taskId: locked.id,
      locate,
    });

    let applied: { projectId: string; configRevisionId: string; bindingId?: string };
    let parameterSpecId = input.parameterSpecId;
    let createdSpec = false;
    let propertyKeyMismatchConfirmed = false;
    let mismatchKeys: { taskPropertyKey: string | null; specPropertyKey: string | null } = {
      taskPropertyKey: null,
      specPropertyKey: null,
    };

    if (input.decision === "resolved" && input.createSpec) {
      if (locked.candidateSchemas.length > 0) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Cannot create a new spec when review task candidates exist; select from the library.",
          400,
          { taskId: input.taskId },
        );
      }
      const taskPropertyKey = evidence.propertyKey;
      if (!taskPropertyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Review task evidence is missing propertyKey required to create a spec.",
          400,
          { taskId: input.taskId },
        );
      }
      const driverModule =
        asString(asRecord(locked.sourceEvidence).driverModule) ??
        asString(asRecord(locked.candidateSchemas[0] ?? {}).schemaNamespace);
      const occurrence = await loadOccurrenceForDraft(tx, {
        propertyOccurrenceId: locate.propertyOccurrenceId,
        configRevisionId: locate.configRevisionId,
      });
      const created = await createOrgManualParameterSpec(tx, {
        organizationId: auth.organization.id,
        propertyKey: taskPropertyKey,
        driverModule,
        sourceReviewTaskId: locked.id,
        propertyOccurrenceId: locate.propertyOccurrenceId,
        configRevisionId: locate.configRevisionId,
        reviewerUserId: auth.user.id,
        occurrenceAstJson: occurrence.astJson,
        occurrenceRawText: occurrence.rawText,
      });

      await writeGovernanceAudit(
        tx,
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
        throw new ApiError("VALIDATION_FAILED", "parameterSpecId is required when resolving a review task.", 400);
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
      throw new ApiError("CONFLICT", "Parameter spec review task is not open.", 409, { taskId: input.taskId });
    }

    const openReviewsRemaining = await countOpenSpecReviewTasksForRevision(tx, {
      organizationId: auth.organization.id,
      projectId: applied.projectId,
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

function toParameterSpecDetailDto(refreshed: ParameterSpecDetailRow): ParameterSpecDetailDto {
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
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function activationContentChanged(
  spec: ParameterSpecDetailRow,
  input: ActivateParameterSpecBody,
  nextConstraints: Record<string, unknown>,
): boolean {
  if (stableJson(spec.valueShape) !== stableJson(input.valueShape)) return true;
  if (stableJson(spec.constraints ?? {}) !== stableJson(nextConstraints)) return true;
  if ((spec.documentation ?? "").trim() !== input.documentation.trim()) return true;
  if (input.displayName != null && input.displayName !== (spec.displayName ?? null)) return true;
  if (input.description != null && input.description !== (spec.description ?? null)) return true;
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
    throw new ApiError("VALIDATION_FAILED", "propertyKey is required.", 400);
  }
  assertNonStructuralPropertyKey(propertyKey);

  if (typeof input.attributionSubjectId !== "string" || !input.attributionSubjectId.trim()) {
    throw new ApiError("VALIDATION_FAILED", "attributionSubjectId is required.", 400);
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
      throw new ApiError("NOT_FOUND", "Attribution subject was not found.", 404, {
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
        400,
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
        409,
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
        409,
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
        definition_lifecycle, attribution_subject_id
      ) values ($1, $2, 'manual', $3, 'draft', $4)
      `,
      [ids.parameterSpecId, auth.organization.id, ids.specificationKey, attributionSubjectId],
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
        input.exampleValue === undefined ? null : JSON.stringify(input.exampleValue),
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
      tx,
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
      throw new ApiError("NOT_FOUND", "Parameter spec was not found after create.", 404, {
        specId: ids.parameterSpecId,
      });
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
      throw new ApiError("CONFLICT", "Deprecated parameter specs cannot be activated.", 409, {
        parameterSpecId: input.specId,
        lifecycle: spec.lifecycle,
      });
    }
    if (spec.lifecycle !== "draft" && spec.lifecycle !== "active") {
      throw new ApiError("CONFLICT", "Only draft or active parameter specs can be activated.", 409, {
        parameterSpecId: input.specId,
        lifecycle: spec.lifecycle,
      });
    }
    if (!spec.currentVersionId) {
      throw new ApiError("VALIDATION_FAILED", "Parameter spec has no version to activate.", 400, {
        parameterSpecId: input.specId,
      });
    }

    const nextConstraints = {
      ...(spec.constraints ?? {}),
      ...input.constraints,
    };
    assertSpecActivatable({
      parameterSpecId: input.specId,
      valueShape: input.valueShape,
      constraints: nextConstraints,
      documentation: input.documentation,
      storedValueShape: spec.lifecycle === "draft" ? spec.valueShape : undefined,
    });

    // Mature create path (subject-bound definitions) requires an explicit coverage claim.
    if (spec.attributionSubjectId && spec.lifecycle === "draft") {
      const propertyKey = (spec.propertyKey ?? "").trim();
      if (!propertyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Subject-bound definitions require a property key before activation.",
          400,
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
          400,
          { parameterSpecId: input.specId, attributionSubjectId: spec.attributionSubjectId },
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

    const displayName = input.displayName ?? spec.displayName ?? spec.propertyKey ?? input.specId;
    const description = input.description ?? spec.description ?? displayName;
    const contentChanged = activationContentChanged(spec, input, nextConstraints);
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
          spec.exampleValue === undefined || spec.exampleValue === null
            ? null
            : JSON.stringify(spec.exampleValue),
          spec.units ?? null,
          JSON.stringify(nextConstraints),
          input.documentation,
          null,
        ],
      );

      const tipBindings = await tx.query<{ binding_id: string; project_id: string | null; revision_id: string }>(
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
          [randomUUID(), runId, tip.binding_id, tip.project_id, tip.revision_id],
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
          units = coalesce($6, units),
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
          spec.units ?? null,
          JSON.stringify(nextConstraints),
          input.documentation,
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
      set constraints = $2::jsonb, documentation = $3
      where parameter_spec_id = $1
      `,
      [input.specId, JSON.stringify(nextConstraints), input.documentation],
    );

    await writeGovernanceAudit(
      tx,
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
            input.valueShape && typeof input.valueShape === "object" && "kind" in input.valueShape
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
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId: input.specId });
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
    // Admins may update org-owned or platform-global catalog specs in place.
    const spec = await requireOrgOrGlobalSpec(tx, {
      organizationId: auth.organization.id,
      parameterSpecId: input.specId,
    });
    if (spec.lifecycle === "draft") {
      throw new ApiError("CONFLICT", "Draft specs must be activated, not updated.", 409, {
        parameterSpecId: input.specId,
        lifecycle: spec.lifecycle,
      });
    }

    const nextValueShape = input.valueShape ?? spec.valueShape ?? {};
    const nextConstraints = {
      ...(spec.constraints ?? {}),
      ...input.constraints,
    };
    if (!input.documentation.trim()) {
      throw new ApiError("VALIDATION_FAILED", "documentation is required.", 400);
    }

    await tx.query(
      `
      update parameter_spec_versions
      set
        display_name = coalesce($3, display_name),
        description = coalesce($4, description),
        value_shape = $5::jsonb,
        example_value = coalesce($6::jsonb, example_value),
        units = coalesce($7, units),
        constraints = $8::jsonb,
        documentation = $9
      where id = $1 and parameter_spec_id = $2
      `,
      [
        spec.currentVersionId,
        input.specId,
        input.displayName ?? spec.displayName,
        input.description ?? spec.description,
        JSON.stringify(nextValueShape),
        input.exampleValue === undefined ? null : JSON.stringify(input.exampleValue),
        input.units === undefined ? null : input.units,
        JSON.stringify(nextConstraints),
        input.documentation,
      ],
    );
    await tx.query(
      `
      update dts_property_specs
      set
        constraints = $2::jsonb,
        documentation = $3,
        units = coalesce($4, units)
      where parameter_spec_id = $1
      `,
      [
        input.specId,
        JSON.stringify(nextConstraints),
        input.documentation,
        input.units === undefined ? null : input.units,
      ],
    );

    await writeGovernanceAudit(
      tx,
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
        },
      },
      context,
    );

    const refreshed = await getParameterSpecRow(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
    });
    if (!refreshed) {
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId: input.specId });
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
      throw new ApiError("CONFLICT", "Only draft or active parameter specs can be deprecated.", 409, {
        parameterSpecId: input.specId,
        lifecycle: spec.lifecycle,
      });
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
      tx,
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
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId: input.specId });
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
      throw new ApiError("CONFLICT", "Only deprecated parameter specs can be restored.", 409, {
        parameterSpecId: input.specId,
        lifecycle: spec.lifecycle,
      });
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
      tx,
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
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, { specId: input.specId });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
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
      throw new ApiError("NOT_FOUND", "Version cutover run was not found.", 404, { runId: input.runId });
    }

    if (hit.status === "finalized") {
      const refreshed = await getParameterSpecRow(tx, {
        organizationId: auth.organization.id,
        specId: hit.parameter_spec_id,
      });
      if (!refreshed) {
        throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, {
          specId: hit.parameter_spec_id,
        });
      }
      return { item: toParameterSpecDetailDto(refreshed) };
    }

    if (hit.status !== "preparing" && hit.status !== "ready") {
      throw new ApiError("CONFLICT", "Cutover run cannot be finalized from its current status.", 409, {
        runId: input.runId,
        status: hit.status,
      });
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
        409,
        { runId: input.runId, blockingItems: Number(blockers.rows[0]?.count ?? 0) },
      );
    }

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
      tx,
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
      throw new ApiError("NOT_FOUND", "Parameter spec was not found.", 404, {
        specId: hit.parameter_spec_id,
      });
    }
    return { item: toParameterSpecDetailDto(refreshed) };
  });
}
