import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { ObjectStore } from "./objectStore";
import type { LogAnalysisQueue } from "./logAnalysisQueue";
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

function requireLocalOrganization(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) {
    throw new ApiError("FORBIDDEN", "Log organization access is required.", 403, { organizationId: auth.organization.id });
  }
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid log route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

async function getAuth(getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext, request: RouteRequest) {
  return getCurrentAuthContext(request);
}

export function registerLogRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    logAnalysisQueue?: LogAnalysisQueue;
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
    }, { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue });

    return { status: 201, body: { fileObject: result.fileObject, log: result.log, job: result.job } };
  });

  router.post("/api/v1/logs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogBodySchema, request.body);
    const result = await createLogFromFile(db, auth, body, { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue });

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
    requireLocalOrganization(auth);
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
    }, { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue });

    return { status: 200, body: result };
  });

  router.post("/api/v1/logs/:logId/archive", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const item = await archiveLogRecord(db, auth, params.logId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/logs/:logId/unarchive", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const item = await unarchiveLogRecord(db, auth, params.logId, { requestId: request.requestId });

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
    }, { requestId: request.requestId });

    return { status: 200, body: { ok: true } };
  });
}
