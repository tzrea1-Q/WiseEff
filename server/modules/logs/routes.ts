import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { ObjectStore } from "./objectStore";
import type { LogFileObjectDto } from "./repository";
import {
  archiveLogRecord,
  createLogFromFile,
  getLogRecord,
  listLogRecords,
  listLogRuns,
  rerunLogAnalysis,
  submitLogFeedback,
  unarchiveLogRecord,
  uploadLogFile
} from "./service";
import {
  createLogBodySchema,
  createLogFileBodySchema,
  listLogsQuerySchema,
  logFeedbackBodySchema,
  rerunLogBodySchema
} from "./schemas";

const paramsWithLogIdSchema = z.object({
  logId: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for log routes.", 500);
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for log file uploads.", 500);
  }

  return objectStore;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid log route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

async function getAuth(
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext,
  request: RouteRequest
) {
  return getCurrentAuthContext(request);
}

type LogFileObjectRow = {
  id: string;
  organization_id: string;
  project_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  file_size_bytes: number | string;
  checksum_sha256: string;
  uploaded_by_user_id: string | null;
  created_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toFileObjectDto(row: LogFileObjectRow): LogFileObjectDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: Number(row.file_size_bytes),
    checksumSha256: row.checksum_sha256,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: dateTimeToIso(row.created_at)
  };
}

async function getUploadedFileObject(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; fileName: string; checksumSha256: string }
) {
  const result = await db.query<LogFileObjectRow>(
    `
    select *
    from log_file_objects
    where organization_id = $1
      and project_id = $2
      and file_name = $3
      and checksum_sha256 = $4
    order by created_at desc
    limit 1
    `,
    [auth.organization.id, input.projectId, input.fileName, input.checksumSha256]
  );

  if (!result.rows[0]) {
    throw new ApiError("NOT_FOUND", "Uploaded file object was not found.", 404, input);
  }

  return toFileObjectDto(result.rows[0]);
}

export function registerLogRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.post("/api/v1/log-files", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogFileBodySchema, request.body);
    const bytes = Buffer.from(body.contentBase64, "base64");
    const result = await uploadLogFile(db, objectStore, auth, {
      projectId: body.projectId,
      fileName: body.fileName,
      contentType: body.contentType,
      bytes,
      analysisQuestion: body.analysisQuestion,
      relatedParameterId: body.relatedParameterId
    });
    const fileObject = await getUploadedFileObject(db, auth, {
      projectId: body.projectId,
      fileName: body.fileName,
      checksumSha256: createHash("sha256").update(bytes).digest("hex")
    });

    return { status: 201, body: { fileObject, log: result.log, job: result.job } };
  });

  router.post("/api/v1/logs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogBodySchema, request.body);
    const result = await createLogFromFile(db, auth, body);

    return { status: 201, body: result };
  });

  router.get("/api/v1/logs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(listLogsQuerySchema, request.query);
    const result = await listLogRecords(db, auth, {
      ...query,
      includeArchived: typeof query.includeArchived === "boolean" ? query.includeArchived : undefined
    });

    return { status: 200, body: result };
  });

  router.get("/api/v1/logs/:logId", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const item = await getLogRecord(db, auth, params.logId);

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/logs/:logId/runs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const items = await listLogRuns(db, auth, params.logId);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/logs/:logId/rerun", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const body = parseWithSchema(rerunLogBodySchema, request.body ?? {});
    const result = await rerunLogAnalysis(db, auth, {
      logId: params.logId,
      analysisQuestion: body.analysisQuestion
    });

    return { status: 200, body: result };
  });

  router.post("/api/v1/logs/:logId/archive", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const item = await archiveLogRecord(db, auth, params.logId);

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/logs/:logId/unarchive", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const item = await unarchiveLogRecord(db, auth, params.logId);

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/logs/:logId/feedback", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const body = parseWithSchema(logFeedbackBodySchema, request.body);

    await submitLogFeedback(db, auth, {
      logId: params.logId,
      rating: body.rating,
      note: body.note
    });

    return { status: 200, body: { ok: true } };
  });
}
