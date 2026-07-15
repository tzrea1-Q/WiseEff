import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import {
  bindParameterSource,
  findProjectValueByDefinition,
  findProjectValueBySource,
  upsertFileSyncDraft
} from "../parameters/repository";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { detectFileUiDraftConflict } from "./conflictService";
import { readDtsIdentityFallbackMode } from "./identityFallbackMode";
import { getFileVersionById, getProjectParameterFileById } from "./repository";
import { nodePathToParameterIdentity } from "./pathMapper";

export type SyncFileVersionInput = {
  fileId: string;
  versionId: string;
};

export type FileSyncSummary = {
  draftsCreated: number;
  unchanged: number;
  unmatched: number;
  skipped: boolean;
  /** Times identity fell back from structural source_node_path to (name, module). */
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
    throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", 404, { versionId: input.versionId });
  }

  if (version.origin === "writeback") {
    return { draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: true, identityFallbackUses: 0 };
  }

  let draftsCreated = 0;
  let unchanged = 0;
  let unmatched = 0;
  let identityFallbackUses = 0;
  const entries = Object.entries(version.parsedIndex);
  const fallbackMode = readDtsIdentityFallbackMode();

  for (const [nodePath, entry] of entries) {
    // Prefer structural source identity (nodePath including @address).
    let resolved = await findProjectValueBySource(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      sourceFileName: file.fileName,
      sourceNodePath: nodePath
    });

    if (!resolved) {
      if (fallbackMode === "deny") {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Identity fallback via (name, module) is denied. Bind source_file_name/source_node_path first.",
          409,
          {
            mode: "deny",
            sourceFileName: file.fileName,
            sourceNodePath: nodePath,
            fileId: file.id
          }
        );
      }

      try {
        // Compatibility fallback: (name, module) from pathMapper — transitional (TD-039).
        const identity = nodePathToParameterIdentity(nodePath);
        resolved = await findProjectValueByDefinition(db, {
          organizationId: auth.organization.id,
          projectId: file.projectId,
          name: identity.name,
          module: identity.module
        });
        if (resolved) {
          identityFallbackUses += 1;
          if (fallbackMode === "warn") {
            await createAuditEvent(db, {
              id: randomUUID(),
              organizationId: auth.organization.id,
              projectId: file.projectId,
              actorUserId: auth.user.id,
              actorType: "user",
              app: "parameters",
              kind: "parameter-file-identity-fallback",
              action: "warn",
              severity: "Low",
              targetType: "project-parameter-file",
              targetId: file.id,
              metadata: {
                mode: "warn",
                sourceFileName: file.fileName,
                sourceNodePath: nodePath,
                fallbackName: identity.name,
                fallbackModule: identity.module,
                projectParameterValueId: resolved.id
              }
            });
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        unmatched += 1;
        continue;
      }
    }

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

  return { draftsCreated, unchanged, unmatched, skipped: false, identityFallbackUses };
}
