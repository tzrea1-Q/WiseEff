import type { AuthContext } from "../auth/types";
import {
  canAdminParameters,
  canViewParameters,
} from "../parameter-kernel/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  listParameterSpecRows,
  listSpecReviewTaskRows,
  type PersistedSpecReviewTask,
  type SpecReviewTaskListCursor,
} from "./repository";
import type {
  ListParameterSpecsQuery,
  ListSpecReviewTasksQuery,
  ParameterSpecReviewTaskDto,
  ParameterSpecSummaryDto,
} from "./schemas";

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
