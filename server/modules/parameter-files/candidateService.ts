import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { listRegisteredCompatibles } from "../parameter-modules/repository";
import { buildIngestDriverSummary } from "../parameter-modules/ingestDriverSummary";
import { listOpenConflicts } from "../parameters/fileSyncConflictRepository";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { diffResolvedDts } from "./baselineDiff";
import {
  abandonParameterFileCandidate,
  getParameterFileCandidateById,
  insertParameterFileCandidate,
  listParameterFileCandidates,
  markParameterFileCandidateActive,
  markParameterFileCandidateStale,
  updateParameterFileCandidateParseResult
} from "./candidateRepository";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import {
  getFileVersionById,
  getProjectParameterFileById,
  getProjectParameterFileByName,
  insertFileVersion,
  insertProjectParameterFile,
  setCurrentVersion
} from "./repository";
import { getConfigSetById, setFileConfigSetMembership } from "./configSetRepository";
import { detectFormat, extractCompatiblesFromDtsSource, MAX_FILE_BYTES, maybeIngestSemanticConfigRevision } from "./service";
import { ingestDtsFileVersion } from "./structuralIngest";
import { isDtsStructuralIngestEnabled } from "./structuralFlag";
import { syncFileVersion } from "./syncService";
import type {
  CandidateBlocker,
  CandidateDiagnostic,
  CandidateImpact,
  CandidateStatus,
  ConfigSetRole,
  ParameterFileFormat,
  ProjectParameterFileCandidateDto,
  ProjectParameterFileDto,
  ProjectParameterFileVersionDto
} from "./types";

export type CandidateServiceContext = AuditCorrelationContext;

export type CreateCandidateInput = {
  projectId: string;
  fileName: string;
  bytes: Buffer;
  fileId?: string;
};

function requireCandidateAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}

function requireCandidateViewer(auth: AuthContext) {
  if (!canViewParameters(auth) && !canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "parameter:view" });
  }
}

function contentTypeForFormat(format: ParameterFileFormat) {
  return format === "json" ? "application/json" : "text/plain";
}

function buildParsedIndex(format: ParameterFileFormat, bytes: Buffer) {
  return format === "json" ? buildJsonParsedIndex(bytes.toString("utf8")) : buildDtsParsedIndex(bytes.toString("utf8"));
}

export function buildUnifiedTextDiff(before: string, after: string, beforeLabel: string, afterLabel: string): string {
  const leftLines = before.split("\n");
  const rightLines = after.split("\n");
  const max = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [`--- ${beforeLabel}`, `+++ ${afterLabel}`];
  for (let i = 0; i < max; i += 1) {
    const a = leftLines[i];
    const b = rightLines[i];
    if (a === b) {
      if (a !== undefined) out.push(` ${a}`);
      continue;
    }
    if (a !== undefined) out.push(`-${a}`);
    if (b !== undefined) out.push(`+${b}`);
  }
  return out.join("\n");
}

function writeCandidateAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    candidate: ProjectParameterFileCandidateDto;
    action: "create" | "abandon" | "recompute" | "activate" | "stale";
    kind: string;
    metadata?: Record<string, unknown>;
  },
  context: CandidateServiceContext = {}
) {
  return createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    targetType: "project-parameter-file-candidate",
    targetId: input.candidate.id,
    metadata: {
      fileName: input.candidate.fileName,
      fileId: input.candidate.fileId ?? null,
      status: input.candidate.status,
      sizeBytes: input.candidate.sizeBytes ?? null,
      ...(input.metadata ?? {})
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function computeCandidateImpact(input: {
  format: ParameterFileFormat;
  candidateSource: string;
  baseSource: string | null;
  baseLabel: string;
  candidateLabel: string;
  registeredCompatibles: string[];
  openConflicts: Array<{
    id: string;
    parameterName?: string;
    parameterModule?: string;
    status: string;
    fileValue: string;
    uiDraftValue: string;
  }>;
}): Promise<{
  impact: CandidateImpact;
  diagnostics: CandidateDiagnostic[];
  blockers: CandidateBlocker[];
  status: Exclude<CandidateStatus, "uploading" | "parsing" | "abandoned">;
}> {
  const diagnostics: CandidateDiagnostic[] = [];
  const blockers: CandidateBlocker[] = [];

  let parsedIndexOk = true;
  try {
    if (input.format === "json") {
      buildJsonParsedIndex(input.candidateSource);
    } else {
      buildDtsParsedIndex(input.candidateSource);
    }
  } catch (error) {
    parsedIndexOk = false;
    diagnostics.push({
      severity: "error",
      code: "parse-failed",
      message: error instanceof Error ? error.message : "Failed to parse candidate content."
    });
  }

  if (!parsedIndexOk) {
    return {
      status: "failed",
      diagnostics,
      blockers,
      impact: { diagnostics, blockers }
    };
  }

  const textDiff = buildUnifiedTextDiff(
    input.baseSource ?? "",
    input.candidateSource,
    input.baseLabel,
    input.candidateLabel
  );

  let structuralDiff: CandidateImpact["structuralDiff"] = [];
  if (input.format === "dts") {
    try {
      structuralDiff = diffResolvedDts(input.baseSource ?? "", input.candidateSource);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "structural-diff-failed",
        message: error instanceof Error ? error.message : "Failed to compute structural diff."
      });
      blockers.push({
        code: "structural-diff-failed",
        message: "Structural comparison could not be completed for this candidate."
      });
    }
  }

  const coverage =
    input.format === "dts"
      ? buildIngestDriverSummary({
          observedCompatibles: extractCompatiblesFromDtsSource(input.candidateSource),
          registeredCompatibles: new Set(input.registeredCompatibles)
        })
      : undefined;

  if (coverage && coverage.newUnregisteredCount > 0) {
    diagnostics.push({
      severity: "warning",
      code: "unregistered-compatibles",
      message: `${coverage.newUnregisteredCount} compatible string(s) are not registered.`
    });
  }

  const conflicts = input.openConflicts.map((conflict) => ({
    id: conflict.id,
    parameterName: conflict.parameterName,
    parameterModule: conflict.parameterModule,
    status: conflict.status,
    fileValue: conflict.fileValue,
    uiDraftValue: conflict.uiDraftValue
  }));

  for (const conflict of conflicts) {
    blockers.push({
      code: "open-conflict",
      message: `Open file/UI conflict ${conflict.id}${conflict.parameterName ? ` (${conflict.parameterName})` : ""} must be resolved before activation.`
    });
  }

  const impact: CandidateImpact = {
    textDiff,
    structuralDiff,
    diagnostics,
    ...(coverage ? { coverage } : {}),
    conflicts,
    blockers
  };

  return {
    status: blockers.length > 0 ? "blocked" : "ready",
    diagnostics,
    blockers,
    impact
  };
}

export async function createCandidate(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: CreateCandidateInput,
  context: CandidateServiceContext = {}
): Promise<ProjectParameterFileCandidateDto> {
  requireCandidateAdmin(auth);

  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ApiError("VALIDATION_FAILED", "Candidate fileName is required.", 400);
  }
  const format = detectFormat(fileName);
  const sizeBytes = input.bytes.byteLength;
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Project parameter file exceeds the 2MB limit.", 400, {
      maxBytes: MAX_FILE_BYTES,
      sizeBytes
    });
  }

  let fileId = input.fileId;
  let baseVersionId: string | undefined;
  let baseStorageKey: string | undefined;
  let existingFileName = fileName;

  if (fileId) {
    const file = await getProjectParameterFileById(db, {
      organizationId: auth.organization.id,
      fileId
    });
    if (!file || file.projectId !== input.projectId) {
      throw new ApiError("NOT_FOUND", "Project parameter file was not found.", 404, { fileId });
    }
    existingFileName = file.fileName;
    if (fileName !== file.fileName) {
      throw new ApiError("VALIDATION_FAILED", "fileName must match the existing file when fileId is provided.", 400, {
        fileId,
        fileName,
        existingFileName: file.fileName
      });
    }
    baseVersionId = file.currentVersionId;
    if (baseVersionId) {
      const baseVersion = await getFileVersionById(db, { versionId: baseVersionId });
      baseStorageKey = baseVersion?.storageKey;
    }
  } else {
    const existing = await getProjectParameterFileByName(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      fileName
    });
    if (existing) {
      fileId = existing.id;
      existingFileName = existing.fileName;
      baseVersionId = existing.currentVersionId;
      if (baseVersionId) {
        const baseVersion = await getFileVersionById(db, { versionId: baseVersionId });
        baseStorageKey = baseVersion?.storageKey;
      }
    }
  }

  const candidateId = randomUUID();
  const source = input.bytes.toString("utf8");
  const stored = await objectStore.put({
    organizationId: auth.organization.id,
    fileName,
    contentType: contentTypeForFormat(format),
    bytes: input.bytes
  });

  return db.transaction(async (tx) => {
    const uploading = await insertParameterFileCandidate(tx, {
      id: candidateId,
      organizationId: auth.organization.id,
      projectId: input.projectId,
      fileId,
      fileName: existingFileName,
      format,
      status: "uploading",
      baseVersionId,
      storageKey: stored.storageKey,
      checksum: stored.checksumSha256,
      sizeBytes: stored.fileSizeBytes,
      createdByUserId: auth.user.id
    });

    await updateParameterFileCandidateParseResult(tx, {
      candidateId: uploading.id,
      status: "parsing"
    });

    let parsedIndex = {};
    try {
      parsedIndex = buildParsedIndex(format, input.bytes);
    } catch (error) {
      const parseDiagnostics: CandidateDiagnostic[] = [
        {
          severity: "error",
          code: "parse-failed",
          message: error instanceof Error ? error.message : "Failed to parse candidate content."
        }
      ];
      const failed = await updateParameterFileCandidateParseResult(tx, {
        candidateId: uploading.id,
        status: "failed",
        parsedIndex: {},
        diagnostics: parseDiagnostics,
        impact: { diagnostics: parseDiagnostics, blockers: [] },
        blockers: []
      });
      if (!failed) {
        throw new ApiError("INTERNAL_ERROR", "Failed to persist candidate parse failure.", 500);
      }
      await writeCandidateAudit(
        tx,
        auth,
        { projectId: input.projectId, candidate: failed, action: "create", kind: "parameter-file-candidate-create" },
        context
      );
      return failed;
    }

    const baseSource = baseStorageKey ? (await objectStore.get(baseStorageKey)).toString("utf8") : null;
    const registered = format === "dts" ? await listRegisteredCompatibles(tx, auth.organization.id) : [];
    const openConflicts =
      fileId != null
        ? (
            await listOpenConflicts(tx, {
              organizationId: auth.organization.id,
              projectId: input.projectId
            })
          ).filter((conflict) => conflict.fileVersionId === baseVersionId)
        : [];

    const computed = await computeCandidateImpact({
      format,
      candidateSource: source,
      baseSource,
      baseLabel: baseVersionId ? `active:${baseVersionId}` : "/dev/null",
      candidateLabel: `candidate:${uploading.id}`,
      registeredCompatibles: registered,
      openConflicts: openConflicts.map((conflict) => ({
        id: conflict.id,
        status: conflict.status,
        fileValue: conflict.fileValue,
        uiDraftValue: conflict.uiDraftValue
      }))
    });

    const updated = await updateParameterFileCandidateParseResult(tx, {
      candidateId: uploading.id,
      status: computed.status,
      parsedIndex,
      diagnostics: computed.diagnostics,
      impact: computed.impact,
      blockers: computed.blockers
    });
    if (!updated) {
      throw new ApiError("INTERNAL_ERROR", "Failed to persist candidate impact.", 500);
    }

    await writeCandidateAudit(
      tx,
      auth,
      { projectId: input.projectId, candidate: updated, action: "create", kind: "parameter-file-candidate-create" },
      context
    );
    return updated;
  });
}

export async function getCandidate(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; candidateId: string }
): Promise<ProjectParameterFileCandidateDto> {
  requireCandidateViewer(auth);
  const candidate = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!candidate) {
    throw new ApiError("NOT_FOUND", "Candidate file version was not found.", 404, {
      candidateId: input.candidateId
    });
  }
  return candidate;
}

export async function listCandidates(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; fileId?: string; includeAbandoned?: boolean }
): Promise<ProjectParameterFileCandidateDto[]> {
  requireCandidateViewer(auth);
  return listParameterFileCandidates(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    fileId: input.fileId,
    includeAbandoned: input.includeAbandoned
  });
}

export async function getCandidateImpact(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; candidateId: string }
): Promise<{ candidate: ProjectParameterFileCandidateDto; impact: CandidateImpact }> {
  const candidate = await getCandidate(db, auth, input);
  return { candidate, impact: candidate.impact ?? {} };
}

export async function getCandidateContent(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string }
): Promise<{ candidate: ProjectParameterFileCandidateDto; bytes: Buffer; contentType: string }> {
  const candidate = await getCandidate(db, auth, input);
  if (!candidate.storageKey) {
    throw new ApiError("VALIDATION_FAILED", "Candidate has no stored content.", 400, {
      candidateId: candidate.id,
      status: candidate.status
    });
  }
  const bytes = await objectStore.get(candidate.storageKey);
  return {
    candidate,
    bytes,
    contentType: contentTypeForFormat(candidate.format)
  };
}

export async function abandonCandidate(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; candidateId: string },
  context: CandidateServiceContext = {}
): Promise<ProjectParameterFileCandidateDto> {
  requireCandidateAdmin(auth);
  const existing = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Candidate file version was not found.", 404, {
      candidateId: input.candidateId
    });
  }
  if (!["ready", "blocked", "failed", "stale"].includes(existing.status)) {
    throw new ApiError("VALIDATION_FAILED", "Only ready, blocked, failed, or stale candidates can be abandoned.", 400, {
      candidateId: existing.id,
      status: existing.status
    });
  }

  return db.transaction(async (tx) => {
    const abandoned = await abandonParameterFileCandidate(tx, {
      candidateId: existing.id,
      abandonedByUserId: auth.user.id
    });
    if (!abandoned) {
      throw new ApiError("VALIDATION_FAILED", "Candidate could not be abandoned from its current status.", 400, {
        candidateId: existing.id,
        status: existing.status
      });
    }
    await writeCandidateAudit(
      tx,
      auth,
      {
        projectId: input.projectId,
        candidate: abandoned,
        action: "abandon",
        kind: "parameter-file-candidate-abandon"
      },
      context
    );
    return abandoned;
  });
}

export async function recomputeCandidateImpact(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; candidateId: string },
  context: CandidateServiceContext = {}
): Promise<ProjectParameterFileCandidateDto> {
  requireCandidateAdmin(auth);
  const existing = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Candidate file version was not found.", 404, {
      candidateId: input.candidateId
    });
  }
  if (!["ready", "blocked", "failed", "stale"].includes(existing.status)) {
    throw new ApiError("VALIDATION_FAILED", "Only ready, blocked, failed, or stale candidates can be recomputed.", 400, {
      status: existing.status
    });
  }
  if (!existing.storageKey) {
    throw new ApiError("VALIDATION_FAILED", "Candidate has no stored content to recompute.", 400);
  }

  let baseVersionId = existing.baseVersionId;
  let baseSource: string | null = null;

  if (existing.fileId) {
    const file = await getProjectParameterFileById(db, {
      organizationId: auth.organization.id,
      fileId: existing.fileId
    });
    if (file?.currentVersionId) {
      baseVersionId = file.currentVersionId;
      const baseVersion = await getFileVersionById(db, { versionId: file.currentVersionId });
      if (baseVersion?.storageKey) {
        baseSource = (await objectStore.get(baseVersion.storageKey)).toString("utf8");
      }
    }
  } else if (existing.baseVersionId) {
    const baseVersion = await getFileVersionById(db, { versionId: existing.baseVersionId });
    if (baseVersion?.storageKey) {
      baseSource = (await objectStore.get(baseVersion.storageKey)).toString("utf8");
    }
  }

  const candidateSource = (await objectStore.get(existing.storageKey)).toString("utf8");
  const registered =
    existing.format === "dts" ? await listRegisteredCompatibles(db, auth.organization.id) : [];
  const openConflicts =
    existing.fileId != null
      ? (
          await listOpenConflicts(db, {
            organizationId: auth.organization.id,
            projectId: input.projectId
          })
        ).filter((conflict) => conflict.fileVersionId === baseVersionId)
      : [];

  const computed = await computeCandidateImpact({
    format: existing.format,
    candidateSource,
    baseSource,
    baseLabel: baseVersionId ? `active:${baseVersionId}` : "/dev/null",
    candidateLabel: `candidate:${existing.id}`,
    registeredCompatibles: registered,
    openConflicts: openConflicts.map((conflict) => ({
      id: conflict.id,
      status: conflict.status,
      fileValue: conflict.fileValue,
      uiDraftValue: conflict.uiDraftValue
    }))
  });

  return db.transaction(async (tx) => {
    const updated = await updateParameterFileCandidateParseResult(tx, {
      candidateId: existing.id,
      status: computed.status,
      diagnostics: computed.diagnostics,
      impact: computed.impact,
      blockers: computed.blockers,
      baseVersionId: baseVersionId ?? null
    });
    if (!updated) {
      throw new ApiError("INTERNAL_ERROR", "Failed to persist recomputed candidate impact.", 500);
    }
    await writeCandidateAudit(
      tx,
      auth,
      {
        projectId: input.projectId,
        candidate: updated,
        action: "recompute",
        kind: "parameter-file-candidate-recompute"
      },
      context
    );
    return updated;
  });
}

export type ActivateCandidateInput = {
  projectId: string;
  candidateId: string;
  /** Version identity the Admin reviewed; null/undefined for a new-file candidate with no base. */
  expectedCurrentVersionId?: string | null;
  configSetId?: string;
  role?: ConfigSetRole;
};

export type ActivateCandidateResult = {
  candidate: ProjectParameterFileCandidateDto;
  file: ProjectParameterFileDto;
  version: ProjectParameterFileVersionDto;
};

export async function activateCandidate(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: ActivateCandidateInput,
  context: CandidateServiceContext = {}
): Promise<ActivateCandidateResult> {
  requireCandidateAdmin(auth);

  const existing = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    candidateId: input.candidateId
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Candidate file version was not found.", 404, {
      candidateId: input.candidateId
    });
  }
  if (existing.status !== "ready") {
    throw new ApiError("VALIDATION_FAILED", "Only ready candidates can be activated.", 400, {
      candidateId: existing.id,
      status: existing.status
    });
  }
  if ((existing.blockers?.length ?? 0) > 0) {
    throw new ApiError("VALIDATION_FAILED", "Candidate has unresolved blockers and cannot be activated.", 400, {
      candidateId: existing.id,
      blockers: existing.blockers
    });
  }
  if (!existing.storageKey || !existing.checksum || existing.sizeBytes == null) {
    throw new ApiError("VALIDATION_FAILED", "Candidate has no stored content to activate.", 400, {
      candidateId: existing.id
    });
  }

  const isNewFile = !existing.fileId;
  if (isNewFile) {
    if (!input.configSetId || !input.role) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Activating a new file requires an explicit configSetId and member role.",
        400,
        { candidateId: existing.id }
      );
    }
  }

  const expectedCurrentVersionId =
    input.expectedCurrentVersionId === undefined ? null : input.expectedCurrentVersionId;

  return db.transaction(async (tx) => {
    const locked = await getParameterFileCandidateById(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      candidateId: input.candidateId
    });
    if (!locked || locked.status !== "ready") {
      throw new ApiError("VALIDATION_FAILED", "Only ready candidates can be activated.", 400, {
        candidateId: input.candidateId,
        status: locked?.status
      });
    }

    let file: ProjectParameterFileDto | null = null;
    if (locked.fileId) {
      file = await getProjectParameterFileById(tx, {
        organizationId: auth.organization.id,
        fileId: locked.fileId
      });
      if (!file || file.projectId !== input.projectId) {
        throw new ApiError("NOT_FOUND", "Project parameter file was not found.", 404, {
          fileId: locked.fileId
        });
      }
    } else {
      const raced = await getProjectParameterFileByName(tx, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileName: locked.fileName
      });
      if (raced) {
        file = raced;
      }
    }

    const actualCurrentVersionId = file?.currentVersionId ?? null;
    const casMatches =
      (actualCurrentVersionId ?? null) === (expectedCurrentVersionId ?? null) &&
      (locked.baseVersionId ?? null) === (expectedCurrentVersionId ?? null);

    if (!casMatches) {
      const stale = await markParameterFileCandidateStale(tx, { candidateId: locked.id });
      if (!stale) {
        throw new ApiError("CONFLICT", "Candidate base changed and could not be marked stale.", 409, {
          reason: "stale-base",
          candidateId: locked.id,
          expectedCurrentVersionId,
          actualCurrentVersionId
        });
      }
      await writeCandidateAudit(
        tx,
        auth,
        {
          projectId: input.projectId,
          candidate: stale,
          action: "stale",
          kind: "parameter-file-candidate-stale",
          metadata: {
            expectedCurrentVersionId,
            actualCurrentVersionId,
            preservedWorkingConfiguration: true
          }
        },
        context
      );
      throw new ApiError(
        "CONFLICT",
        "Candidate base is stale; Working configuration was preserved. Recompute impact before activating.",
        409,
        {
          reason: "stale-base",
          candidate: stale,
          expectedCurrentVersionId,
          actualCurrentVersionId
        }
      );
    }

    if (isNewFile) {
      const configSet = await getConfigSetById(tx, {
        organizationId: auth.organization.id,
        configSetId: input.configSetId!
      });
      if (!configSet || configSet.projectId !== input.projectId) {
        throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId: input.configSetId });
      }
    }

    const source = (await objectStore.get(locked.storageKey!)).toString("utf8");

    if (!file) {
      file = await insertProjectParameterFile(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileName: locked.fileName,
        format: locked.format
      });
    }

    const version = await insertFileVersion(tx, {
      id: randomUUID(),
      fileId: file.id,
      versionNumber: (file.currentVersionNumber ?? 0) + 1,
      storageKey: locked.storageKey!,
      checksum: locked.checksum!,
      sizeBytes: locked.sizeBytes!,
      parsedIndex: locked.parsedIndex ?? {},
      origin: "upload",
      createdByUserId: auth.user.id
    });

    await setCurrentVersion(tx, { fileId: file.id, versionId: version.id });

    if (isNewFile) {
      await setFileConfigSetMembership(tx, {
        fileId: file.id,
        configSetId: input.configSetId!,
        role: input.role!,
        sortOrder: 0
      });
    }

    if (locked.format === "dts" && isDtsStructuralIngestEnabled()) {
      await ingestDtsFileVersion(tx, version.id, source);
    }
    if (locked.format === "dts") {
      await maybeIngestSemanticConfigRevision(tx, objectStore, auth, {
        fileId: file.id,
        frozenVersionId: version.id,
        frozenSource: source
      });
      await syncFileVersion(tx, auth, { fileId: file.id, versionId: version.id });
    }

    const activated = await markParameterFileCandidateActive(tx, {
      candidateId: locked.id,
      activatedByUserId: auth.user.id,
      activatedVersionId: version.id,
      fileId: file.id,
      baseVersionId: expectedCurrentVersionId
    });
    if (!activated) {
      throw new ApiError("CONFLICT", "Candidate could not be activated from its current status.", 409, {
        candidateId: locked.id
      });
    }

    await writeCandidateAudit(
      tx,
      auth,
      {
        projectId: input.projectId,
        candidate: activated,
        action: "activate",
        kind: "parameter-file-candidate-activate",
        metadata: {
          activatedVersionId: version.id,
          previousVersionId: expectedCurrentVersionId,
          configSetId: input.configSetId ?? null,
          role: input.role ?? null
        }
      },
      context
    );

    return {
      candidate: activated,
      file: {
        ...file,
        currentVersionId: version.id,
        currentVersionNumber: version.versionNumber
      },
      version
    };
  });
}
