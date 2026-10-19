import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";

import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { IntegrationPrincipal } from "../auth/integrationPrincipal";
import { createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { LogAnalysisJobDto } from "../jobs/types";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { enqueueLogAnalysisJob, type LogAnalysisQueue } from "./logAnalysisQueue";
import { findLogDomainBySkillKey, getActiveLogDomainForBinding } from "./domainsRepository";
import { currentSkillRevisionId } from "./skillsRepository";
import type { ObjectStore, StoredObject } from "./objectStore";
import {
  aggregateFeedbackInsights,
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
  type LogFeedbackInsightDto,
  type LogFileObjectDto,
  type LogRunDto
} from "./repository";
import {
  requireLogAnalyze,
  requireLogArchive,
  requireLogFeedback,
  requireLogUpload,
  requireLogView
} from "./policy";
import { loadLogBundleLimits } from "../../config/env";
import { bundleFileUtf8Bytes, intakeLogBundle, isLogArchive, type BundleFile } from "./bundleIntake";
import { insertLogFiles, fileInventory, loadLegacyLogFile, loadLogFiles } from "./filesRepository";
import { ensureStoredLogIndex, readStoredLogRange } from "./fileReader";
import { logLineRangeQuerySchema } from "./schemas";
import { supportedLogExtensions } from "./status";
import {
  isSupportedStoredLogFileName,
  isSupportedTextLogFileName,
  supportedLogArchiveExtensions
} from "./unpack";
import type { LogFeedbackRating, LogLineRangeDto, LogRecordDto } from "./types";
import {
  resolveAuthorizedRelatedParameter,
  toRelatedParameterRunSnapshot,
  type RelatedParameterRunSnapshot,
  type RelatedParameterSelection
} from "./relatedParameter";

export type UploadLogFileInput = {
  skillId?: string;
  skillKey?: string;
  sourceVersion?: string;
  fileName: string;
  contentType: string;
  bytes: Buffer | Uint8Array;
  files?: Array<{ fileName: string; bytes: Buffer }>;
  analysisQuestion?: string;
  relatedParameterId?: string;
  relatedParameterPin?: RelatedParameterSelection;
  logDomainId?: string;
};

export type CreateLogFromFileInput = {
  skillId?: string;
  skillKey?: string;
  sourceVersion?: string;
  fileObjectId: string;
  fileName: string;
  analysisQuestion?: string;
  relatedParameterId?: string;
  relatedParameterPin?: RelatedParameterSelection;
  logDomainId?: string;
};

export type ListLogRecordsQuery = {
  status?: LogRecordDto["status"];
  timeWindow?: "today" | "7d" | "30d";
  includeArchived?: boolean;
};

export type RerunLogAnalysisInput = {
  revisionPolicy?: "current" | "pinned";
  logId: string;
  analysisQuestion?: string;
  logDomainId?: string;
};

export type SubmitLogFeedbackInput = {
  logId: string;
  rating: LogFeedbackRating;
  note?: string;
};

type ServiceContext = AuditCorrelationContext & {
  logAnalysisQueue?: LogAnalysisQueue;
};

type LogPrincipal = AuthContext | IntegrationPrincipal;

function organizationId(auth: LogPrincipal) {
  return "kind" in auth ? auth.organizationId : auth.organization.id;
}

function uploadingUserId(auth: LogPrincipal) {
  return "kind" in auth ? null : auth.user.id;
}

function creatingCredentialId(auth: LogPrincipal) {
  return "kind" in auth ? auth.credentialId : undefined;
}

function uploadInvocation(auth: LogPrincipal): TrustedInvocationContext {
  return "kind" in auth ? auth.invocation : createUserInvocation(auth);
}

function unsupportedReason() {
  return `Unsupported log format. Supported extensions: ${supportedLogExtensions.join(", ")} (archives: ${supportedLogArchiveExtensions.join(", ")}).`;
}

type ResolvedLogRelatedParameter = {
  relatedParameterId: string;
  relatedParameterProjectId: string;
  relatedParameterSnapshot: RelatedParameterRunSnapshot;
};

async function resolveLogRelatedParameter(
  db: Database,
  auth: LogPrincipal,
  input: { relatedParameterId?: string; relatedParameterPin?: RelatedParameterSelection }
): Promise<ResolvedLogRelatedParameter | undefined> {
  if ("kind" in auth) {
    if (input.relatedParameterId || input.relatedParameterPin) {
      throw new ApiError("FORBIDDEN", "Integration credentials cannot select related parameters.");
    }
    return undefined;
  }
  if (!input.relatedParameterPin) {
    if (input.relatedParameterId) {
      throw new ApiError(
        "CONFLICT",
        "Related parameters must be selected by an authorized, project-scoped canonical Binding."
      );
    }
    return undefined;
  }
  if (input.relatedParameterId && input.relatedParameterId !== input.relatedParameterPin.bindingId) {
    throw new ApiError("VALIDATION_FAILED", "relatedParameterId must match relatedParameterPin.bindingId.");
  }
  const pool = getRootPostgresPool(db);
  if (!pool) {
    throw new ApiError("INTERNAL_ERROR", "A root PostgreSQL pool is required to resolve a related parameter pin.");
  }
  const parameter = await resolveAuthorizedRelatedParameter(pool, {
    invocation: createUserInvocation(auth),
    projectId: input.relatedParameterPin.projectId,
    bindingId: input.relatedParameterPin.bindingId,
    definitionId: input.relatedParameterPin.definitionId,
    definitionRevisionId: input.relatedParameterPin.definitionRevisionId
  });
  return {
    relatedParameterId: parameter.pin.bindingId,
    relatedParameterProjectId: parameter.pin.projectId,
    relatedParameterSnapshot: toRelatedParameterRunSnapshot(parameter)
  };
}

/**
 * Rejected uploads are recorded through an `inline/` pseudo storage key without
 * ever writing the object store; such file objects can never be analyzed.
 */
function isAnalyzableStoredLogObject(fileObject: { storageKey: string; fileName: string }): boolean {
  return !fileObject.storageKey.startsWith("inline/") && isSupportedStoredLogFileName(fileObject.fileName);
}

/**
 * Optional log-domain binding: the domain must belong to the organization and be
 * active, otherwise the request fails with 400. Absence keeps the uncategorized
 * log domain semantics — uploads are never blocked by domain selection.
 */
async function requireBindableLogDomainId(db: Queryable, auth: LogPrincipal, logDomainId: string | undefined) {
  if (logDomainId === undefined) {
    return undefined;
  }

  const domain = await getActiveLogDomainForBinding(db, {
    organizationId: organizationId(auth),
    domainId: logDomainId
  });
  if (!domain) {
    throw new ApiError("VALIDATION_FAILED", "Log domain is unknown or not active in this organization.", {
      logDomainId
    });
  }

  return domain.id;
}

async function resolveUploadSkillId(db: Queryable, auth: LogPrincipal, input: {
  skillId?: string; logDomainId?: string; skillKey?: string;
}) {
  if (input.skillId && input.logDomainId && input.skillId !== input.logDomainId) {
    if ("kind" in auth && auth.skillId) throw new ApiError("FORBIDDEN", "Credential skill binding does not match the selected skill.");
    throw new ApiError("VALIDATION_FAILED", "skillId and logDomainId must identify the same analysis skill.");
  }
  const id = input.skillId ?? input.logDomainId;
  if ("kind" in auth && auth.skillId && ((!id && input.skillKey === undefined) || (id && id !== auth.skillId))) {
    throw new ApiError("FORBIDDEN", "A bound credential must select its bound skill.");
  }
  if (input.skillKey !== undefined) {
    const skill = await findLogDomainBySkillKey(db, { organizationId: organizationId(auth), skillKey: input.skillKey });
    if ("kind" in auth && auth.skillId && (!skill || skill.id !== auth.skillId)) {
      throw new ApiError("FORBIDDEN", "Credential skill binding does not match the selected skill.");
    }
    if (!skill || skill.status !== "active") {
      throw new ApiError("VALIDATION_FAILED", "skillKey is unknown or not active in this organization.", { fieldErrors: { skillKey: "Unknown or inactive analysis skill." } });
    }
    if (id && id !== skill.id) throw new ApiError("VALIDATION_FAILED", "skillKey and skillId/logDomainId must identify the same analysis skill.");
    return skill.id;
  }
  return requireBindableLogDomainId(db, auth, id);
}

async function createLogAudit(
  tx: AuditTx,
  invocation: TrustedInvocationContext,
  input: {
    kind: "log-upload" | "log-upload-failed" | "log-rerun" | "log-archive" | "log-unarchive" | "log-feedback";
    action: string;
    logId: string;
    severity?: "High" | "Medium" | "Low";
    metadata?: Record<string, unknown>;
  },
  context: ServiceContext = {}
) {
  // requestId fallback survives only until log contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, invocation, { requestId: context.requestId ?? randomUUID() }, {
    app: "log-analysis",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    projectId: null,
    targetType: "log-record",
    targetId: input.logId,
    metadata: input.metadata ?? {}
  });
}

async function persistFileObject(
  db: Queryable,
  auth: LogPrincipal,
  input: { stored: StoredObject }
): Promise<LogFileObjectDto> {
  return createFileObject(db, {
    id: randomUUID(),
    organizationId: organizationId(auth),
    storageKey: input.stored.storageKey,
    fileName: input.stored.fileName,
    contentType: input.stored.contentType,
    fileSizeBytes: input.stored.fileSizeBytes,
    checksumSha256: input.stored.checksumSha256,
    uploadedByUserId: uploadingUserId(auth),
    createdByCredentialId: creatingCredentialId(auth)
  });
}

export async function uploadLogFile(
  db: Database,
  objectStore: ObjectStore,
  auth: LogPrincipal,
  input: UploadLogFileInput,
  context: ServiceContext = {}
): Promise<{ fileObject: LogFileObjectDto; log: LogRecordDto; job: LogAnalysisJobDto | null }> {
  if (!("kind" in auth)) requireLogUpload(auth);
  const logDomainId = await resolveUploadSkillId(db, auth, input);
  const relatedParameter = await resolveLogRelatedParameter(db, auth, input);
  const uploads = input.files ?? [{ fileName: input.fileName, bytes: Buffer.isBuffer(input.bytes) ? input.bytes
    : Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength) }];
  const intake = intakeLogBundle(uploads, loadLogBundleLimits());
  const singleUnsupported = uploads.length === 1 && !isLogArchive(uploads[0].fileName)
    && extname(uploads[0].fileName) !== ""
    && !isSupportedTextLogFileName(uploads[0].fileName);
  const failureReason = !intake.ok ? intake.reason : intake.files.some((file) => file.status === "analyzed")
    ? undefined : singleUnsupported ? unsupportedReason() : "日志包中没有可分析的文本文件";
  const storedFiles: Array<Omit<BundleFile, "bytes"> & { objectKey: string | null }> = [];
  const originalObjects = new Map<string, StoredObject>();
  let stored: StoredObject | undefined;
  for (const file of intake.ok ? intake.files : []) {
    const object = file.status === "analyzed" ? await objectStore.put({
      organizationId: organizationId(auth),
      fileName: uploads.length === 1 && !isLogArchive(uploads[0].fileName) ? input.fileName : `${file.sha256}.log`,
      contentType: "text/plain; charset=utf-8", bytes: bundleFileUtf8Bytes(file)
    }) : undefined;
    stored ??= object;
    const original = uploads.find((upload) => upload.fileName === file.path && !isLogArchive(upload.fileName));
    if (object && original && bundleFileUtf8Bytes(file).equals(original.bytes)) originalObjects.set(original.fileName, object);
    delete file.bytes;
    storedFiles.push({ ...file, objectKey: object?.storageKey ?? null });
  }
  const primary = stored ? { ...stored, fileName: input.fileName,
    fileSizeBytes: storedFiles.reduce((sum, file) => sum + file.sizeBytes, 0) } : {
    storageKey: `inline/${randomUUID()}`, fileName: input.fileName, contentType: input.contentType,
    fileSizeBytes: uploads.reduce((sum, file) => sum + file.bytes.length, 0),
    checksumSha256: createHash("sha256").update(input.bytes).digest("hex")
  };
  const originalUploads = failureReason ? [] : await Promise.all(uploads.map(async (upload) => ({
    fileName: upload.fileName, sizeBytes: upload.bytes.length,
    objectKey: (originalObjects.get(upload.fileName) ?? await objectStore.put({ organizationId: organizationId(auth),
      fileName: `original-${randomUUID()}.bin`, contentType: "application/octet-stream", bytes: upload.bytes })).storageKey
  })));

  const result = await db.transaction(async (tx) => {
    const fileObject = await persistFileObject(tx, auth, { stored: primary });
    if (failureReason) {
      const log = await markUnsupportedLog(tx, { id: randomUUID(), organizationId: organizationId(auth),
        fileObjectId: fileObject.id, fileName: input.fileName, source: "upload", submittedByUserId: uploadingUserId(auth),
        createdByCredentialId: creatingCredentialId(auth),
        failureReason, analysisQuestion: input.analysisQuestion, logDomainId,
        relatedParameterId: relatedParameter?.relatedParameterId, relatedParameterProjectId: relatedParameter?.relatedParameterProjectId });
      if (!log) throw new ApiError("INTERNAL_ERROR", "Log record was not created.");
      await insertLogFiles(tx, organizationId(auth), log.id, storedFiles);
      await createLogAudit(asAuditTx(tx), uploadInvocation(auth), {
        kind: "log-upload-failed", action: "upload-failed", logId: log.id, severity: "Low",
        metadata: { fileName: input.fileName, failureReason: log.failureReason }
      }, context);
      return { fileObject, log: { ...log, files: fileInventory(storedFiles) }, job: null };
    }
    const { log, job } = await createLogRecordWithRunAndJob(
      tx,
      {
        logId: randomUUID(),
        runId: randomUUID(),
        jobId: randomUUID(),
        organizationId: organizationId(auth),
        fileObjectId: fileObject.id,
        fileName: input.fileName,
        source: "upload",
        submittedByUserId: uploadingUserId(auth),
        createdByCredentialId: creatingCredentialId(auth),
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: relatedParameter?.relatedParameterId,
        relatedParameterProjectId: relatedParameter?.relatedParameterProjectId,
        relatedParameterSnapshot: relatedParameter?.relatedParameterSnapshot,
        sourceVersion: input.sourceVersion,
        logDomainId
      }
    );
    await createLogAudit(
      asAuditTx(tx),
      uploadInvocation(auth),
      {
        kind: "log-upload",
        action: "upload",
        logId: log.id,
        metadata: { fileName: input.fileName, runId: job.runId, jobId: job.id, logDomainId: logDomainId ?? null }
      },
      context
    );

    await insertLogFiles(tx, organizationId(auth), log.id, storedFiles);
    for (const [position, upload] of originalUploads.entries()) await tx.query(`insert into log_original_uploads
      (organization_id, record_id, position, file_name, object_key, size_bytes) values ($1,$2,$3,$4,$5,$6)`,
    [organizationId(auth), log.id, position, upload.fileName, upload.objectKey, upload.sizeBytes]);
    return { fileObject, log: { ...log, files: fileInventory(storedFiles) }, job };
  });

  if (result.job) await enqueueLogAnalysisJob(context.logAnalysisQueue, {
    organizationId: organizationId(auth),
    logId: result.log.id,
    runId: result.job.runId,
    jobId: result.job.id
  });

  return result;
}

export async function createLogFromFile(db: Database, auth: LogPrincipal, input: CreateLogFromFileInput, context: ServiceContext = {}) {
  if (!("kind" in auth)) requireLogUpload(auth);
  const logDomainId = await resolveUploadSkillId(db, auth, input);

  const fileObject = await getFileObjectById(db, {
    organizationId: organizationId(auth),
    fileObjectId: input.fileObjectId
  });
  if (!fileObject) {
    throw new ApiError("NOT_FOUND", "File object was not found.", { fileObjectId: input.fileObjectId });
  }
  if ("kind" in auth ? fileObject.createdByCredentialId !== auth.credentialId : fileObject.uploadedByUserId !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "File object ownership is required.", {
      fileObjectId: input.fileObjectId
    });
  }
  if (input.fileName !== fileObject.fileName) {
    throw new ApiError("VALIDATION_FAILED", "File name does not match the stored file object.", {
      fileObjectId: input.fileObjectId,
      fileName: input.fileName
    });
  }
  const relatedParameter = await resolveLogRelatedParameter(db, auth, input);

  const sourceBundle = await db.query<{ id: string }>(`select lr.id from log_records lr
    where lr.organization_id=$1 and lr.file_object_id=$2
      and exists (select 1 from log_files lf where lf.record_id=lr.id and lf.organization_id=lr.organization_id and lf.status='analyzed')
    order by lr.captured_at desc, lr.id desc limit 1`, [organizationId(auth), fileObject.id]);
  const sourceRecordId = sourceBundle.rows[0]?.id;
  if (!sourceRecordId && !isAnalyzableStoredLogObject(fileObject)) {
    return db.transaction(async (tx) => {
      const log = await markUnsupportedLog(tx, {
        id: randomUUID(),
        organizationId: organizationId(auth),
        fileObjectId: input.fileObjectId,
        fileName: fileObject.fileName,
        source: "upload",
        submittedByUserId: uploadingUserId(auth),
        createdByCredentialId: creatingCredentialId(auth),
        failureReason: unsupportedReason(),
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: relatedParameter?.relatedParameterId,
        relatedParameterProjectId: relatedParameter?.relatedParameterProjectId,
        logDomainId
      });
      if (!log) throw new ApiError("NOT_FOUND", "Log record was not created.");
      await createLogAudit(
        asAuditTx(tx),
        uploadInvocation(auth),
        {
          kind: "log-upload-failed",
          action: "upload-failed",
          logId: log.id,
          severity: "Low",
          metadata: { fileName: fileObject.fileName, failureReason: log.failureReason }
        },
        context
      );
      return { log, job: null };
    });
  }

  const result = await db.transaction(async (tx) => {
    const result = await createLogRecordWithRunAndJob(
      tx,
      {
        logId: randomUUID(),
        runId: randomUUID(),
        jobId: randomUUID(),
        organizationId: organizationId(auth),
        fileObjectId: input.fileObjectId,
        fileName: fileObject.fileName,
        source: "upload",
        submittedByUserId: uploadingUserId(auth),
        createdByCredentialId: creatingCredentialId(auth),
        analysisQuestion: input.analysisQuestion,
        relatedParameterId: relatedParameter?.relatedParameterId,
        relatedParameterProjectId: relatedParameter?.relatedParameterProjectId,
        relatedParameterSnapshot: relatedParameter?.relatedParameterSnapshot,
        sourceVersion: input.sourceVersion,
        logDomainId
      }
    );
    await createLogAudit(
      asAuditTx(tx),
      uploadInvocation(auth),
      {
        kind: "log-upload",
        action: "upload",
        logId: result.log.id,
        metadata: { fileName: fileObject.fileName, runId: result.job.runId, jobId: result.job.id, logDomainId: logDomainId ?? null }
      },
      context
    );
    if (sourceRecordId) {
      await tx.query(`insert into log_files(id, organization_id, record_id, path, size_bytes, sha256, encoding, lossy,
        line_count, status, skip_reason, object_key, line_index_key)
        select gen_random_uuid()::text, organization_id, $3, path, size_bytes, sha256, encoding, lossy,
          line_count, status, skip_reason, object_key, line_index_key from log_files where organization_id=$1 and record_id=$2`,
      [organizationId(auth), sourceRecordId, result.log.id]);
      await tx.query(`insert into log_original_uploads (organization_id, record_id, position, file_name, object_key, size_bytes)
        select organization_id, $3, position, file_name, object_key, size_bytes from log_original_uploads
        where organization_id = $1 and record_id = $2`, [organizationId(auth), sourceRecordId, result.log.id]);
      result.log.files = fileInventory(await loadLogFiles(tx, organizationId(auth), result.log.id));
    }
    return result;
  });

  await enqueueLogAnalysisJob(context.logAnalysisQueue, {
    organizationId: organizationId(auth),
    logId: result.log.id,
    runId: result.job.runId,
    jobId: result.job.id
  });

  return result;
}

export async function listLogRecords(db: Queryable, auth: AuthContext, query: ListLogRecordsQuery = {}) {
  requireLogView(auth);
  return { items: await listLogs(db, auth, query) };
}

export async function getLogRecord(db: Queryable, auth: LogPrincipal, logId: string) {
  if (!("kind" in auth)) requireLogView(auth);
  const log = await getLogDetail(db, auth, logId);
  if (!log) {
    throw new ApiError("NOT_FOUND", "Log record was not found.", { logId });
  }
  return log;
}

export async function getLogLineRange(db: Queryable, objectStore: ObjectStore, auth: LogPrincipal,
  logId: string, input: { file: string; startLine: number; endLine: number }): Promise<LogLineRangeDto> {
  await getLogRecord(db, auth, logId);
  const parsed = logLineRangeQuerySchema.safeParse(input);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Request an inclusive range of at most 400 lines.");
  const inventory = await loadLogFiles(db, organizationId(auth), logId);
  const storedFile = inventory.find((item) => item.path === input.file)
    ?? (!inventory.length ? await loadLegacyLogFile(db, organizationId(auth), logId, input.file) : undefined);
  if (!storedFile || storedFile.status !== "analyzed" || !storedFile.objectKey) {
    throw new ApiError("NOT_FOUND", "Log file was not found.", { logId, file: input.file });
  }
  const file = await ensureStoredLogIndex(db, objectStore, organizationId(auth), logId, storedFile);
  if (input.startLine > Math.max(1, file.lineCount)) {
    throw new ApiError("VALIDATION_FAILED", "Start line is outside the log file.");
  }
  const endLine = Math.min(input.endLine, file.lineCount);
  const lines = endLine < input.startLine ? [] : await readStoredLogRange(objectStore, file, input.startLine, endLine);
  return { file: file.path, startLine: input.startLine, endLine, totalLines: file.lineCount, lines };
}

export async function listLogRuns(db: Queryable, auth: AuthContext, logId: string): Promise<LogRunDto[]> {
  requireLogView(auth);
  await getLogRecord(db, auth, logId);
  return listRuns(db, auth, logId);
}

export async function rerunLogAnalysis(db: Database, auth: AuthContext, input: RerunLogAnalysisInput, context: ServiceContext = {}) {
  requireLogAnalyze(auth);

  const existing = await getLogDetail(db, auth, input.logId);
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Log record was not found.", { logId: input.logId });
  }
  const relatedParameter = existing.relatedParameterId && existing.relatedParameterProjectId
    ? await resolveLogRelatedParameter(db, auth, {
        relatedParameterId: existing.relatedParameterId,
        relatedParameterPin: {
          kind: "canonical-pin",
          projectId: existing.relatedParameterProjectId,
          bindingId: existing.relatedParameterId
        }
      })
    : undefined;

  const result = await db.transaction(async (tx) => {
    await tx.query(`select id from log_records where organization_id = $1 and id = $2 for update`, [auth.organization.id, input.logId]);
    const current = await getLogDetail(tx, auth, input.logId);
    if (!current) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId: input.logId });
    }
    const logDomainId = await requireBindableLogDomainId(tx, auth, input.logDomainId);

    if (input.revisionPolicy === "pinned" && logDomainId && logDomainId !== current.logDomainId) {
      throw new ApiError("VALIDATION_FAILED", "A pinned rerun cannot change its analysis skill.");
    }
    if (input.revisionPolicy === "pinned" && current.logDomainId && !current.skillRevision) {
      throw new ApiError("CONFLICT", "This record has no previous skill revision to replay.");
    }
    const skillRevisionId = input.revisionPolicy === "pinned" ? current.skillRevision?.id ?? null
      : await currentSkillRevisionId(tx, auth.organization.id, logDomainId ?? current.logDomainId);
    const job = await createRerunWithJob(tx, {
      skillRevisionId,
      preserveLegacyKnowledgeScope: input.revisionPolicy === "pinned",
      runId: randomUUID(),
      jobId: randomUUID(),
      organizationId: auth.organization.id,
      logId: input.logId,
      analysisQuestion: input.analysisQuestion,
      logDomainId,
      relatedParameterSnapshot: relatedParameter?.relatedParameterSnapshot
    });
    const log = await getLogDetail(tx, auth, input.logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId: input.logId });
    }
    await createLogAudit(
      asAuditTx(tx),
      createUserInvocation(auth),
      {
        kind: "log-rerun",
        action: "rerun",
        logId: input.logId,
        metadata: {
          runId: job.runId,
          jobId: job.id,
          analysisQuestion: input.analysisQuestion,
          logDomainId: logDomainId ?? current.logDomainId ?? null
        }
      },
      context
    );
    const runs = await listRuns(tx, auth, input.logId);

    return { log, job, runs };
  });

  await enqueueLogAnalysisJob(context.logAnalysisQueue, {
    organizationId: auth.organization.id,
    logId: result.log.id,
    runId: result.job.runId,
    jobId: result.job.id
  });

  return result;
}

export async function archiveLogRecord(db: Database, auth: AuthContext, logId: string, context: ServiceContext = {}) {
  requireLogArchive(auth);
  return db.transaction(async (tx) => {
    const existing = await getLogDetail(tx, auth, logId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId });
    }
    const log = await archiveLog(tx, auth, logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId });
    }
    await createLogAudit(
      asAuditTx(tx),
      createUserInvocation(auth),
      {
        kind: "log-archive",
        action: "archive",
        logId,
        metadata: { archiveState: "archived" }
      },
      context
    );
    return log;
  });
}

export async function unarchiveLogRecord(db: Database, auth: AuthContext, logId: string, context: ServiceContext = {}) {
  requireLogArchive(auth);
  return db.transaction(async (tx) => {
    const existing = await getLogDetail(tx, auth, logId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId });
    }
    const log = await unarchiveLog(tx, auth, logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId });
    }
    await createLogAudit(
      asAuditTx(tx),
      createUserInvocation(auth),
      {
        kind: "log-unarchive",
        action: "unarchive",
        logId,
        metadata: { archiveState: "active" }
      },
      context
    );
    return log;
  });
}

export type ListLogFeedbackInsightsQuery = {
  timeWindow?: "today" | "7d" | "30d";
};

/** Feedback quality insights for the `/log-admin` dashboard (org-scoped, read-only). */
export async function listLogFeedbackInsights(
  db: Queryable,
  auth: AuthContext,
  query: ListLogFeedbackInsightsQuery = {}
): Promise<{ items: LogFeedbackInsightDto[] }> {
  requireLogView(auth);
  return { items: await aggregateFeedbackInsights(db, auth, query) };
}

export async function submitLogFeedback(db: Database, auth: AuthContext, input: SubmitLogFeedbackInput, context: ServiceContext = {}) {
  requireLogFeedback(auth);
  return db.transaction(async (tx) => {
    const log = await getLogDetail(tx, auth, input.logId);
    if (!log) {
      throw new ApiError("NOT_FOUND", "Log record was not found.", { logId: input.logId });
    }
    await appendFeedback(tx, auth, {
      id: randomUUID(),
      logId: input.logId,
      rating: input.rating,
      note: input.note
    });
    await createLogAudit(
      asAuditTx(tx),
      createUserInvocation(auth),
      {
        kind: "log-feedback",
        action: "feedback",
        logId: input.logId,
        severity: "Low",
        metadata: { rating: input.rating, note: input.note }
      },
      context
    );
  });
}
