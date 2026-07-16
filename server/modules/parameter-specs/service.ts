import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import {
  getParameterSpecRow,
  getSpecReviewTaskById,
  listParameterSpecRows,
  resolveSpecReviewTaskRow
} from "./repository";
import type {
  ListParameterSpecsQuery,
  ParameterSpecDetailDto,
  ParameterSpecSummaryDto,
  ResolveSpecReviewTaskBody
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

export async function listParameterSpecs(
  db: Database,
  auth: AuthContext,
  query: ListParameterSpecsQuery = {}
): Promise<{ items: ParameterSpecSummaryDto[] }> {
  requireCanView(auth);
  const rows = await listParameterSpecRows(db, {
    organizationId: auth.organization.id,
    ...query
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
      currentVersion: row.currentVersion
    }))
  };
}

export async function getParameterSpec(
  db: Database,
  auth: AuthContext,
  specId: string
): Promise<{ item: ParameterSpecDetailDto }> {
  requireCanView(auth);
  const row = await getParameterSpecRow(db, {
    organizationId: auth.organization.id,
    specId
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
      policyTarget: row.policyTarget
    }
  };
}

export async function resolveSpecReviewTask(
  db: Database,
  auth: AuthContext,
  input: ResolveSpecReviewTaskBody & { taskId: string },
  context: AuditCorrelationContext = {}
): Promise<{ id: string; status: "resolved" | "dismissed"; parameterSpecId?: string; reason?: string }> {
  requireCanAdmin(auth);

  const existing = await getSpecReviewTaskById(db, {
    organizationId: auth.organization.id,
    taskId: input.taskId
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Parameter spec review task was not found.", 404, { taskId: input.taskId });
  }

  const resolved = await resolveSpecReviewTaskRow(db, {
    taskId: input.taskId,
    organizationId: auth.organization.id,
    status: input.decision,
    parameterSpecId: input.parameterSpecId,
    reviewerUserId: auth.user.id,
    reason: input.reason
  });
  if (!resolved) {
    throw new ApiError("CONFLICT", "Parameter spec review task is not open.", 409, { taskId: input.taskId });
  }

  await writeGovernanceAudit(
    db,
    auth,
    {
      action: input.decision === "resolved" ? "spec-review-resolved" : "spec-review-dismissed",
      projectId: null,
      targetType: "parameter-spec-review-task",
      targetId: resolved.id,
      metadata: {
        taskId: resolved.id,
        parameterSpecId: resolved.parameterSpecId ?? input.parameterSpecId ?? null,
        decision: input.decision,
        reasonHash: hashReason(input.reason),
        projectCount: existing.projectCount
      }
    },
    context
  );

  return {
    id: resolved.id,
    status: resolved.status === "open" ? input.decision : resolved.status,
    parameterSpecId: resolved.parameterSpecId,
    reason: resolved.reason
  };
}

function hashReason(reason: string) {
  let hash = 0;
  for (let i = 0; i < reason.length; i += 1) {
    hash = (hash * 31 + reason.charCodeAt(i)) >>> 0;
  }
  return `r${hash.toString(16)}`;
}
