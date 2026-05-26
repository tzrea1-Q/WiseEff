import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import type { LogAnalysisJobDto } from "../jobs/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore, StoredObject } from "./objectStore";
import {
  appendFeedback,
  archiveLog,
  createFileObject,
  createLogRecordWithRunAndJob,
  createRerunWithJob,
  getFileObjectById,
  getLogDetail,
  listLogs,
  listRuns,
  markUnsupportedLog,
  unarchiveLog,
  type LogFileObjectDto,
  type LogRunDto
} from "./repository";
import {
  getAllowedLogProjectIds,
  requireLogAnalyze,
  requireLogArchive,
  requireLogFeedback,
  requireLogProjectAccess,
  requireLogUpload,
  requireLogView
} from "./policy";
import { supportedLogExtensions } from "./status";
import type { LogFeedbackRating, LogRecordDto } from "./types";

export type UploadLogFileInput = {
  projectId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer | Uint8Array;
  analysisQuestion?: string;
  relatedParameterId?: string;
};

export type CreateLogFromFileInput = {
  projectId: string;
  fileObjectId: string;
  fileName: string;
  analysisQuestion?: string;
  relatedParameterId?: string;
};

export type ListLogRecordsQuery = {
  projectId?: string;
  status?: LogRecordDto["status"];
  timeWindow?: "today" | "7d" | "30d";
  includeArchived?: boolean;
};

export type RerunLogAnalysisInput = {
  logId: string;
  analysisQuestion?: string;
};

export type SubmitLogFeedbackInput = {
  logId: string;
  rating: LogFeedbackRating;
  note?: string;
};

const supportedExtensions = new Set<string>(supportedLogExtensions);

function unsupportedReason() {
  return `Unsupported log format. Supported extensions: ${supportedLogExtensions.join(", ")}.`;
}

function isSupportedLogFile(fileName: string) {
  return supportedExtensions.has(extname(fileName).toLowerCase());
}

function storedObjectFromBytes(input: UploadLogFileInput): StoredObject {
  const bytes = input.bytes instanceof Buffer ? input.bytes : Buffer.from(input.bytes);
  return {
    storageKey: `inline/${createHash("sha256").update(bytes).digest("hex")}-${input.fileName}`,
    fileName: input.fileName,
    contentType: input.contentType,
    fileSizeBytes: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function createLogAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: "log-upload" | "log-upload-failed" | "log-rerun" | "log-archive" | "log-unarchive" | "log-feedback";
    action: string;
    projectId?: string | null;
    logId: string;
    severity?: "High" | "Medium" | "Low";
    metadata?: Record<string, unknown>;
  }
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId ?? null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "log-analysis",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    targetType: "log-record",
    targetId: input.logId,
    metadata: input.metadata ?? {},
    traceId: randomUUID()
  });
}

async function persistFileObject(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; stored: StoredObject }
): Promise<LogFileObjectDto> {
  return createFileObject(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    storageKey: input.stored.storageKey,
    fileName: input.stored.fileName,
    contentType: input.stored.contentType,
    fileSizeBytes: input.stored.fileSizeBytes,
    checksumSha256: input.stored.checksumSha256,
    uploadedByUserId: auth.user.id
  });
}

export async function uploadLogFile(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: UploadLogFileInput
): Promise<{ log: LogRecordDto; job: LogAnalysisJobDto | null }> {
  requireLogUpload(auth);
  requireLogProjectAccess(auth, input.projectId);
  const supported = isSupportedLogFile(input.fileName);
  const stored = supported
    ? await objectStore.put({
        organizationId: auth.organization.id,
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.bytes instanceof Buffer ? input.bytes : Buffer.from(input.bytes)
      })
    : storedObjectFromBytes(input);

  if (!supported) {
    return db.transaction(async (tx) => {
      const fileObject = await persistFileObject(tx, auth, { projectId: input.projectId, stored });
      const log = await markUnsupportedLog(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileObjectId: fileObject.id,
        fileName: input.fileName,
        source: "upload",
        submittedByUserId: auth.user.id,
        failureReason: unsupportedReason(),
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: input.relatedParameterId
      });
      if (!log) {
        throw new ApiError("NOT_FOUND", "Log record was not created.", 404);
      }
      await createLogAudit(tx, auth, {
        kind: "log-upload-failed",
        action: "upload-failed",
        projectId: input.projectId,
        logId: log.id,
        severity: "Low",
        metadata: { fileName: input.fileName, failureReason: log.failureReason }
      });

      return { log, job: null };
    });
  }

  return db.transaction(async (tx) => {
    const fileObject = await persistFileObject(tx, auth, { projectId: input.projectId, stored });
    const { log, job } = await createLogRecordWithRunAndJob(
      {
        query: tx.query,
        transaction: async (fn) => fn(tx)
      },
      {
        logId: randomUUID(),
        runId: randomUUID(),
        jobId: randomUUID(),
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileObjectId: fileObject.id,
        fileName: input.fileName,
        source: "upload",
        submittedByUserId: auth.user.id,
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: input.relatedParameterId
      }
    );
    await createLogAudit(tx, auth, {
      kind: "log-upload",
      action: "upload",
      projectId: input.projectId,
      logId: log.id,
      metadata: { fileName: input.fileName, runId: job.runId, jobId: job.id }
    });

    return { log, job };
  });
}

export async function createLogFromFile(db: Database, auth: AuthContext, input: CreateLogFromFileInput) {
  requireLogUpload(auth);
  requireLogProjectAccess(auth, input.projectId);

  const fileObject = await getFileObjectById(db, {
    organizationId: auth.organization.id,
    fileObjectId: input.fileObjectId
  });
  if (!fileObject) {
    throw new ApiError("NOT_FOUND", "File object was not found.", 404, { fileObjectId: input.fileObjectId });
  }
  if (fileObject.projectId !== input.projectId) {
    throw new ApiError("VALIDATION_FAILED", "File object does not belong to the requested project.", 400, {
      fileObjectId: input.fileObjectId,
      projectId: input.projectId
    });
  }
  if (fileObject.uploadedByUserId !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "File object ownership is required.", 403, {
      fileObjectId: input.fileObjectId
    });
  }
  if (input.fileName !== fileObject.fileName) {
    throw new ApiError("VALIDATION_FAILED", "File name does not match the stored file object.", 400, {
      fileObjectId: input.fileObjectId,
      fileName: input.fileName
    });
  }

  if (!isSupportedLogFile(fileObject.fileName)) {
    return db.transaction(async (tx) => {
      const log = await markUnsupportedLog(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileObjectId: input.fileObjectId,
        fileName: fileObject.fileName,
        source: "upload",
        submittedByUserId: auth.user.id,
        failureReason: unsupportedReason(),
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: input.relatedParameterId
      });
      if (!log) throw new ApiError("NOT_FOUND", "Log record was not created.", 404);
      await createLogAudit(tx, auth, {
        kind: "log-upload-failed",
        action: "upload-failed",
        projectId: input.projectId,
        logId: log.id,
        severity: "Low",
        metadata: { fileName: fileObject.fileName, failureReason: log.failureReason }
      });
      return { log, job: null };
    });
  }

  return db.transaction(async (tx) => {
    const result = await createLogRecordWithRunAndJob(
      {
        query: tx.query,
        transaction: async (fn) => fn(tx)
      },
      {
        logId: randomUUID(),
        runId: randomUUID(),
        jobId: randomUUID(),
        organizationId: auth.organization.id,
        projectId: input.projectId,
        fileObjectId: input.fileObjectId,
        fileName: fileObject.fileName,
        source: "upload",
        submittedByUserId: auth.user.id,
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: input.relatedParameterId
      }
    );
    await createLogAudit(tx, auth, {
      kind: "log-upload",
      action: "upload",
      projectId: input.projectId,
      logId: result.log.id,
      metadata: { fileName: fileObject.fileName, runId: result.job.runId, jobId: result.job.id }
    });
    return result;
  });
}

export async function listLogRecords(db: Queryable, auth: AuthContext, query: ListLogRecordsQuery = {}) {
  requireLogView(auth);
  if (query.projectId) {
    requireLogProjectAccess(auth, query.projectId);
  }
  return { items: await listLogs(db, auth, { ...query, allowedProjectIds: getAllowedLogProjectIds(auth) }) };
}

export async function getLogRecord(db: Queryable, auth: AuthContext, logId: string) {
  requireLogView(auth);
  const log = await getLogDetail(db, auth, logId);
  if (!log) {
    throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId });
  }
  requireLogProjectAccess(auth, log.projectId);
  return log;
}

export async function listLogRuns(db: Queryable, auth: AuthContext, logId: string): Promise<LogRunDto[]> {
  requireLogView(auth);
  await getLogRecord(db, auth, logId);
  return listRuns(db, auth, logId);
}

export async function rerunLogAnalysis(db: Database, auth: AuthContext, input: RerunLogAnalysisInput) {
  requireLogAnalyze(auth);

  return db.transaction(async (tx) => {
    const existing = await getLogDetail(tx, auth, input.logId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId: input.logId });
    }
    requireLogProjectAccess(auth, existing.projectId);

    const job = await createRerunWithJob(tx, {
      runId: randomUUID(),
      jobId: randomUUID(),
      organizationId: auth.organization.id,
      logId: input.logId,
      analysisQuestion: input.analysisQuestion
    });
    const log = await getLogDetail(tx, auth, input.logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId: input.logId });
    }
    requireLogProjectAccess(auth, log.projectId);
    await createLogAudit(tx, auth, {
      kind: "log-rerun",
      action: "rerun",
      projectId: log.projectId,
      logId: input.logId,
      metadata: { runId: job.runId, jobId: job.id, analysisQuestion: input.analysisQuestion }
    });
    const runs = await listRuns(tx, auth, input.logId);

    return { log, job, runs };
  });
}

export async function archiveLogRecord(db: Database, auth: AuthContext, logId: string) {
  requireLogArchive(auth);
  return db.transaction(async (tx) => {
    const existing = await getLogDetail(tx, auth, logId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId });
    }
    requireLogProjectAccess(auth, existing.projectId);
    const log = await archiveLog(tx, auth, logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId });
    }
    await createLogAudit(tx, auth, {
      kind: "log-archive",
      action: "archive",
      projectId: log.projectId,
      logId,
      metadata: { archiveState: "archived" }
    });
    return log;
  });
}

export async function unarchiveLogRecord(db: Database, auth: AuthContext, logId: string) {
  requireLogArchive(auth);
  return db.transaction(async (tx) => {
    const existing = await getLogDetail(tx, auth, logId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId });
    }
    requireLogProjectAccess(auth, existing.projectId);
    const log = await unarchiveLog(tx, auth, logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId });
    }
    await createLogAudit(tx, auth, {
      kind: "log-unarchive",
      action: "unarchive",
      projectId: log.projectId,
      logId,
      metadata: { archiveState: "active" }
    });
    return log;
  });
}

export async function submitLogFeedback(db: Database, auth: AuthContext, input: SubmitLogFeedbackInput) {
  requireLogFeedback(auth);
  return db.transaction(async (tx) => {
    const log = await getLogDetail(tx, auth, input.logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", 404, { logId: input.logId });
    }
    requireLogProjectAccess(auth, log.projectId);
    await appendFeedback(tx, auth, {
      id: randomUUID(),
      logId: input.logId,
      rating: input.rating,
      note: input.note
    });
    await createLogAudit(tx, auth, {
      kind: "log-feedback",
      action: "feedback",
      projectId: log.projectId,
      logId: input.logId,
      severity: "Low",
      metadata: { rating: input.rating, note: input.note }
    });
  });
}
