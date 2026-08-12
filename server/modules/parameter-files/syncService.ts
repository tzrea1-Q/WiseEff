import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import {
  bindParameterSource,
  findProjectValueBySource
} from "../parameters/repository";
import type { FileSyncConflictRecord } from "../parameters/fileSyncConflictRepository";
import { upsertFileSyncDraft } from "../parameter-drafts/repository";
import { parameterIdentityMode } from "../parameters/parameterIdentityMode";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { detectFileUiDraftConflict } from "./conflictService";
import { getFileVersionById, getProjectParameterFileById } from "./repository";

export type SyncFileVersionInput = {
  fileId: string;
  versionId: string;
};

export type FileSyncSummary = {
  draftsCreated: number;
  unchanged: number;
  unmatched: number;
  skipped: boolean;
  /** Always 0 after (name, module) identity fallback retirement. */
  identityFallbackUses: number;
};

export async function syncFileVersion(
  db: Queryable,
  auth: AuthContext,
  input: SyncFileVersionInput,
  context: AuditCorrelationContext = {}
): Promise<FileSyncSummary> {
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId: input.fileId
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", 404, { fileId: input.fileId });
  }

  const version = await getFileVersionById(db, { versionId: input.versionId });
  if (!version || version.fileId !== file.id) {
    throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", 404, {
      versionId: input.versionId
    });
  }

  if (version.origin === "writeback") {
    return { draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: true, identityFallbackUses: 0 };
  }

  // Semantic config ingest owns source identity after cutover. The adapter below
  // is intentionally limited to the retired flat parameter tables.
  if (parameterIdentityMode() === "semantic") {
    return { draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: true, identityFallbackUses: 0 };
  }

  let draftsCreated = 0;
  let unchanged = 0;
  let unmatched = 0;
  const openedConflicts: FileSyncConflictRecord[] = [];
  const entries = Object.entries(version.parsedIndex);

  for (const [nodePath, entry] of entries) {
    const resolved = await findProjectValueBySource(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      sourceFileName: file.fileName,
      sourceNodePath: nodePath
    });

    if (!resolved) {
      unmatched += 1;
      continue;
    }

    const targetValue = entry.value;
    if (resolved.currentValue === targetValue) {
      unchanged += 1;
      await bindParameterSource(db, {
        projectParameterValueId: resolved.id,
        sourceFileName: file.fileName,
        sourceNodePath: nodePath
      });
      continue;
    }

    const fileDraft = await upsertFileSyncDraft(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      projectParameterValueId: resolved.id,
      userId: auth.user.id,
      targetValue,
      reason: `Synced from ${file.fileName}:${nodePath}`,
      originFileVersionId: version.id
    });
    draftsCreated += 1;

    await bindParameterSource(db, {
      projectParameterValueId: resolved.id,
      sourceFileName: file.fileName,
      sourceNodePath: nodePath
    });
    const opened = await detectFileUiDraftConflict(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      projectParameterValueId: resolved.id,
      parameterDefinitionId: resolved.parameterDefinitionId,
      fileVersionId: version.id,
      fileDraftId: fileDraft.id,
      fileValue: targetValue
    });
    openedConflicts.push(...opened);
  }

  for (const conflict of openedConflicts) {
    await createAuditEvent(db, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: file.projectId,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameters",
      kind: "parameter-file-conflict-open",
      action: "open",
      severity: "Medium",
      targetType: "parameter-file-sync-conflict",
      targetId: conflict.id,
      metadata: {
        fileDraftId: conflict.fileDraftId,
        uiDraftId: conflict.uiDraftId,
        projectParameterValueId: conflict.projectParameterValueId,
        fileVersionId: version.id
      },
      traceId: context.requestId ?? randomUUID()
    });
  }

  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: file.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "parameter-file-sync",
    action: "sync",
    severity: "Low",
    targetType: "project-parameter-file",
    targetId: file.id,
    metadata: {
      fileVersionId: version.id,
      draftsCreated,
      unchanged,
      unmatched,
      conflictsOpened: openedConflicts.length
    },
    traceId: context.requestId ?? randomUUID()
  });

  return { draftsCreated, unchanged, unmatched, skipped: false, identityFallbackUses: 0 };
}
