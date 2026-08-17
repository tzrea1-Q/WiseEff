import { randomUUID } from "node:crypto";

import { writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import {
  bindParameterSource,
  findProjectValueBySource
} from "../parameters/repository";
import type { FileSyncConflictRecord } from "../parameters/fileSyncConflictRepository";
import { upsertFileSyncDraft } from "../parameter-drafts/repository";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { ApiError } from "../../shared/http/errors";
import { detectFileUiDraftConflict } from "./conflictService";
import { getFileVersionById, getProjectParameterFileById } from "./repository";
import { findBindingBySource } from "./syncIdentity";

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
  db: AuditTx,
  auth: AuthContext,
  input: SyncFileVersionInput,
  context: AuditCorrelationContext = {}
): Promise<FileSyncSummary> {
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId: input.fileId
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", { fileId: input.fileId });
  }

  const version = await getFileVersionById(db, { versionId: input.versionId });
  if (!version || version.fileId !== file.id) {
    throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", {
      versionId: input.versionId
    });
  }

  if (version.origin === "writeback") {
    return { draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: true, identityFallbackUses: 0 };
  }

  const semantic = parameterIdentityMode() === "semantic";
  let draftsCreated = 0;
  let unchanged = 0;
  let unmatched = 0;
  const openedConflicts: FileSyncConflictRecord[] = [];
  const entries = Object.entries(version.parsedIndex);

  for (const [nodePath, entry] of entries) {
    let resolved: { id: string; currentValue: string; definitionOrSpecId: string } | null = null;
    if (semantic) {
      const binding = await findBindingBySource(db, {
        organizationId: auth.organization.id,
        projectId: file.projectId,
        sourceFileName: file.fileName,
        sourceNodePath: nodePath,
        fileVersionId: version.id
      });
      if (binding) {
        resolved = {
          id: binding.id,
          currentValue: binding.currentValue,
          definitionOrSpecId: binding.parameterSpecId
        };
      }
    } else {
      const ppv = await findProjectValueBySource(db, {
        organizationId: auth.organization.id,
        projectId: file.projectId,
        sourceFileName: file.fileName,
        sourceNodePath: nodePath
      });
      if (ppv) {
        resolved = {
          id: ppv.id,
          currentValue: ppv.currentValue,
          definitionOrSpecId: ppv.parameterDefinitionId
        };
      }
    }

    if (!resolved) {
      unmatched += 1;
      continue;
    }

    const targetValue = entry.value;
    if (resolved.currentValue === targetValue) {
      unchanged += 1;
      if (!semantic) {
        await bindParameterSource(db, {
          projectParameterValueId: resolved.id,
          sourceFileName: file.fileName,
          sourceNodePath: nodePath
        });
      }
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

    if (!semantic) {
      await bindParameterSource(db, {
        projectParameterValueId: resolved.id,
        sourceFileName: file.fileName,
        sourceNodePath: nodePath
      });
    }
    const opened = await detectFileUiDraftConflict(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      projectParameterValueId: resolved.id,
      parameterDefinitionId: resolved.definitionOrSpecId,
      fileVersionId: version.id,
      fileDraftId: fileDraft.id,
      fileValue: targetValue
    });
    openedConflicts.push(...opened);
  }

  // requestId fallback survives only until sync contexts become mandatory (ADR-0027).
  for (const conflict of openedConflicts) {
    await writeAuditEventInTx(db, auth, { requestId: context.requestId ?? randomUUID() }, {
      app: "parameters",
      kind: "parameter-file-conflict-open",
      action: "open",
      severity: "Medium",
      projectId: file.projectId,
      targetType: "parameter-file-sync-conflict",
      targetId: conflict.id,
      metadata: {
        fileDraftId: conflict.fileDraftId,
        uiDraftId: conflict.uiDraftId,
        projectParameterValueId: conflict.projectParameterValueId,
        fileVersionId: version.id
      }
    });
  }

  await writeAuditEventInTx(db, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "parameters",
    kind: "parameter-file-sync",
    action: "sync",
    severity: "Low",
    projectId: file.projectId,
    targetType: "project-parameter-file",
    targetId: file.id,
    metadata: {
      fileVersionId: version.id,
      draftsCreated,
      unchanged,
      unmatched,
      conflictsOpened: openedConflicts.length
    }
  });

  return { draftsCreated, unchanged, unmatched, skipped: false, identityFallbackUses: 0 };
}
