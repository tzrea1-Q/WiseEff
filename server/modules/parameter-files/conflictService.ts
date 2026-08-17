import { randomUUID } from "node:crypto";

import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { listDraftsForParameterValue } from "../parameter-drafts/repository";
import {
  insertFileSyncConflict,
  listFileSyncConflictsByIds,
  listOpenConflicts,
  resolveConflict,
  type FileSyncConflictRecord
} from "../parameters/fileSyncConflictRepository";
import { canReviewParameters } from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export type DetectFileUiDraftConflictInput = {
  organizationId: string;
  projectId: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  fileVersionId: string;
  fileDraftId: string;
  fileValue: string;
  /** Post-cutover identity; callers may still pass the binding id via projectParameterValueId. */
  projectParameterBindingId?: string;
  parameterSpecId?: string;
};

export async function detectFileUiDraftConflict(
  db: Queryable,
  input: DetectFileUiDraftConflictInput
) {
  const drafts = await listDraftsForParameterValue(db, {
    projectParameterValueId: input.projectParameterValueId
  });
  const openConflicts = await listOpenConflicts(db, {
    organizationId: input.organizationId,
    projectParameterValueId: input.projectParameterValueId
  });
  const existingPairs = new Set(openConflicts.map((conflict) => `${conflict.fileDraftId}:${conflict.uiDraftId}`));

  const manualDrafts = drafts.filter(
    (draft) => draft.origin === "manual" && draft.targetValue !== input.fileValue && draft.id !== input.fileDraftId
  );
  const createdConflicts = [];

  for (const manualDraft of manualDrafts) {
    const pair = `${input.fileDraftId}:${manualDraft.id}`;
    if (existingPairs.has(pair)) {
      continue;
    }

    const conflict = await insertFileSyncConflict(db, {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectParameterValueId: input.projectParameterValueId,
      parameterDefinitionId: input.parameterDefinitionId,
      fileVersionId: input.fileVersionId,
      fileDraftId: input.fileDraftId,
      uiDraftId: manualDraft.id,
      fileValue: input.fileValue,
      uiDraftValue: manualDraft.targetValue,
      projectParameterBindingId: input.projectParameterBindingId,
      parameterSpecId: input.parameterSpecId
    });
    existingPairs.add(pair);
    createdConflicts.push(conflict);
  }

  return createdConflicts;
}

export type ResolveParameterFileConflictInput = {
  conflictId: string;
  resolution: "file" | "ui";
  reason?: string;
};

function normalizeConflictReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Eligibility for bulk arbitration (TD-058):
 * - Eligible: open conflicts in the target project that have both fileValue and uiDraftValue
 *   (all current open file↔ui sync conflicts qualify).
 * - Ineligible when requested by id: missing, already resolved, or wrong project.
 */
function isEligibleOpenConflict(conflict: FileSyncConflictRecord, projectId: string): boolean {
  return (
    conflict.projectId === projectId &&
    conflict.status === "open" &&
    Boolean(conflict.fileValue) &&
    Boolean(conflict.uiDraftValue)
  );
}

function buildBulkImpact(eligible: FileSyncConflictRecord[]) {
  const parameterNames = [
    ...new Set(eligible.map((conflict) => conflict.parameterName).filter((name): name is string => Boolean(name)))
  ];
  const fileIds = [
    ...new Set(eligible.map((conflict) => conflict.fileId).filter((fileId): fileId is string => Boolean(fileId)))
  ];
  return {
    eligibleCount: eligible.length,
    ineligibleCount: 0,
    parameterNames,
    fileIds
  };
}

export type BulkConflictIneligibleReason = "not_found" | "already_resolved" | "wrong_project" | "missing_values";

export type BulkConflictPreviewResult = {
  resolution: "file" | "ui";
  eligible: FileSyncConflictRecord[];
  ineligible: Array<{ conflict: Pick<FileSyncConflictRecord, "id"> & Partial<FileSyncConflictRecord>; reason: BulkConflictIneligibleReason }>;
  impact: {
    eligibleCount: number;
    ineligibleCount: number;
    parameterNames: string[];
    fileIds: string[];
  };
};

export async function resolveParameterFileConflict(
  db: Database,
  auth: AuthContext,
  input: ResolveParameterFileConflictInput,
  context: { requestId?: string } = {}
) {
  if (!canReviewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review permission is required.");
  }

  const reason = normalizeConflictReason(input.reason);

  return db.transaction(async (tx) => {
    const [conflict] = await listOpenConflicts(tx, {
      organizationId: auth.organization.id,
      conflictId: input.conflictId
    });
    if (!conflict) {
      throw new ApiError("NOT_FOUND", "Open parameter file sync conflict was not found.", {
        conflictId: input.conflictId
      });
    }

    // Resolve before deleting drafts: ui/file draft FKs cascade-delete the conflict row.
    const resolved = await resolveConflict(tx, {
      organizationId: auth.organization.id,
      conflictId: input.conflictId,
      status: input.resolution === "file" ? "resolved_file" : "resolved_ui",
      resolvedByUserId: auth.user.id
    });
    if (!resolved) {
      throw new ApiError("CONFLICT", "Parameter file sync conflict is already resolved.", {
        conflictId: input.conflictId
      });
    }

    const draftIdToDelete = input.resolution === "file" ? conflict.uiDraftId : conflict.fileDraftId;
    await tx.query(
      `
      delete from parameter_drafts
      where organization_id = $1
        and id = $2
      `,
      [auth.organization.id, draftIdToDelete]
    );

    // requestId fallback survives only until conflict contexts become mandatory (ADR-0027).
    await writeAuditEventInTx(asAuditTx(tx), auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameters",
      kind: "parameter-file-conflict-resolve",
      action: "resolve",
      severity: "Medium",
      projectId: resolved.projectId,
      targetType: "parameter-file-sync-conflict",
      targetId: resolved.id,
      metadata: {
        resolution: input.resolution,
        fileDraftId: resolved.fileDraftId,
        uiDraftId: resolved.uiDraftId,
        projectParameterValueId: resolved.projectParameterValueId,
        ...(reason ? { reason } : {})
      }
    });

    return resolved;
  });
}

export async function previewBulkConflictResolution(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    resolution: "file" | "ui";
    conflictIds?: string[];
  }
): Promise<BulkConflictPreviewResult> {
  if (!canReviewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review permission is required.");
  }

  const openConflicts = await listOpenConflicts(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });

  if (input.conflictIds === undefined) {
    const eligible = openConflicts.filter((conflict) => isEligibleOpenConflict(conflict, input.projectId));
    const impact = buildBulkImpact(eligible);
    return {
      resolution: input.resolution,
      eligible,
      ineligible: [],
      impact: {
        ...impact,
        ineligibleCount: 0
      }
    };
  }

  const openById = new Map(openConflicts.map((conflict) => [conflict.id, conflict]));
  const missingIds = input.conflictIds.filter((id) => !openById.has(id));
  const lookedUp =
    missingIds.length > 0
      ? await listFileSyncConflictsByIds(db, {
          organizationId: auth.organization.id,
          conflictIds: missingIds
        })
      : [];
  const lookedUpById = new Map(lookedUp.map((conflict) => [conflict.id, conflict]));

  const eligible: FileSyncConflictRecord[] = [];
  const ineligible: BulkConflictPreviewResult["ineligible"] = [];

  for (const conflictId of input.conflictIds) {
    const open = openById.get(conflictId);
    if (open && isEligibleOpenConflict(open, input.projectId)) {
      eligible.push(open);
      continue;
    }

    const found = open ?? lookedUpById.get(conflictId);
    if (!found) {
      ineligible.push({ conflict: { id: conflictId }, reason: "not_found" });
      continue;
    }
    if (found.projectId !== input.projectId) {
      ineligible.push({ conflict: found, reason: "wrong_project" });
      continue;
    }
    if (found.status !== "open") {
      ineligible.push({ conflict: found, reason: "already_resolved" });
      continue;
    }
    ineligible.push({ conflict: found, reason: "missing_values" });
  }

  const impact = buildBulkImpact(eligible);
  return {
    resolution: input.resolution,
    eligible,
    ineligible,
    impact: {
      ...impact,
      ineligibleCount: ineligible.length
    }
  };
}

export async function resolveConflictsBulk(
  db: Database,
  auth: AuthContext,
  input: {
    projectId: string;
    resolution: "file" | "ui";
    conflictIds: string[];
    reason?: string;
  },
  context: { requestId?: string } = {}
) {
  if (!canReviewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review permission is required.");
  }

  const preview = await previewBulkConflictResolution(db, auth, {
    projectId: input.projectId,
    resolution: input.resolution,
    conflictIds: input.conflictIds
  });

  if (preview.eligible.length === 0) {
    return { resolved: [], skipped: preview.ineligible };
  }

  // A bulk arbitration is one human decision: every eligible conflict resolves or
  // none does. Per-conflict transactions inside resolveParameterFileConflict degrade
  // to savepoints under this outer transaction, so an unexpected mid-batch failure
  // rolls the whole batch back instead of leaving it half-applied. `skipped` still
  // reports the entries preview classified as ineligible up front.
  const resolved = await db.transaction(async (tx) => {
    const items: FileSyncConflictRecord[] = [];
    for (const conflict of preview.eligible) {
      const item = await resolveParameterFileConflict(tx, auth, {
        conflictId: conflict.id,
        resolution: input.resolution,
        reason: input.reason
      }, context);
      items.push(item);
    }
    return items;
  });

  return {
    resolved,
    skipped: preview.ineligible
  };
}
