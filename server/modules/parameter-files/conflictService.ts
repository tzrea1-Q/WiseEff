import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import {
  insertFileSyncConflict,
  listDraftsForParameterValue,
  listOpenConflicts,
  resolveConflict
} from "../parameters/repository";
import { canReviewParameters } from "../parameters/policy";
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
      uiDraftValue: manualDraft.targetValue
    });
    existingPairs.add(pair);
    createdConflicts.push(conflict);
  }

  return createdConflicts;
}

export type ResolveParameterFileConflictInput = {
  conflictId: string;
  resolution: "file" | "ui";
};

export async function resolveParameterFileConflict(
  db: Database,
  auth: AuthContext,
  input: ResolveParameterFileConflictInput
) {
  if (!canReviewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review permission is required.", 403);
  }

  return db.transaction(async (tx) => {
    const [conflict] = await listOpenConflicts(tx, {
      organizationId: auth.organization.id,
      conflictId: input.conflictId
    });
    if (!conflict) {
      throw new ApiError("NOT_FOUND", "Open parameter file sync conflict was not found.", 404, {
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
      throw new ApiError("CONFLICT", "Parameter file sync conflict is already resolved.", 409, {
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

    await createAuditEvent(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: resolved.projectId,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameters",
      kind: "parameter-file-conflict-resolve",
      action: "resolve",
      severity: "Medium",
      targetType: "parameter-file-sync-conflict",
      targetId: resolved.id,
      metadata: {
        resolution: input.resolution,
        fileDraftId: resolved.fileDraftId,
        uiDraftId: resolved.uiDraftId,
        projectParameterValueId: resolved.projectParameterValueId
      },
      traceId: randomUUID()
    });

    return resolved;
  });
}
