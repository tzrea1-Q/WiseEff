import type { AuthContext } from "../auth/types";
import {
  bindParameterSource,
  findProjectValueBySource,
  upsertFileSyncDraft
} from "../parameters/repository";
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
  input: SyncFileVersionInput
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

  let draftsCreated = 0;
  let unchanged = 0;
  let unmatched = 0;
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
    await detectFileUiDraftConflict(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      projectParameterValueId: resolved.id,
      parameterDefinitionId: resolved.parameterDefinitionId,
      fileVersionId: version.id,
      fileDraftId: fileDraft.id,
      fileValue: targetValue
    });
  }

  return { draftsCreated, unchanged, unmatched, skipped: false, identityFallbackUses: 0 };
}
