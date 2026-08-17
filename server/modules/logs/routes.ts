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
  listLogFeedbackInsights,
  listLogRecords,
  listLogRuns,
  rerunLogAnalysis,
  submitLogFeedback,
  unarchiveLogRecord,
  uploadLogFile
} from "./service";
import {
  archiveLogDomainRecord,
  createLogDomainRecord,
  listLogDomainKnowledgeLinkRecords,
  listLogDomainRecords,
  listLogDomainWebhookDeliveryRecords,
  sendLogDomainWebhookTestDelivery,
  setLogDomainKnowledgeLinkRecords,
  setLogDomainWebhookRecord,
  updateLogDomainRecord
} from "./domainsService";
import type { LogWebhookDeliverer } from "./webhookDelivery";
import {
  createLogBodySchema,
  createLogDomainBodySchema,
  createLogFileBodySchema,
  feedbackInsightsQuerySchema,
  listLogDomainsQuerySchema,
  listLogsQuerySchema,
  logFeedbackBodySchema,
  rerunLogBodySchema,
  setLogDomainKnowledgeLinksBodySchema,
  setLogDomainWebhookBodySchema,
  updateLogDomainBodySchema,
  webhookDeliveriesQuerySchema
} from "./schemas";

const paramsWithLogIdSchema = z.object({
  logId: z.string().min(1)
});

const paramsWithDomainIdSchema = z.object({
  domainId: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for log routes.");
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for log file uploads.");
  }

  return objectStore;
}

function requireLocalOrganization(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) {
    throw new ApiError("FORBIDDEN", "Log organization access is required.", { organizationId: auth.organization.id });
  }
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid log route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

async function getAuth(getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext, request: RouteRequest) {
  return getCurrentAuthContext(request);
}

/** Route wiring for the P3b result-webhook governance endpoints. */
export type LogWebhookRouteContext = {
  deliverer?: Pick<LogWebhookDeliverer, "sendTestDelivery">;
  /** Mirrors LOG_WEBHOOK_ALLOW_INSECURE_LOCAL for save-time URL validation. */
  allowInsecureLocal?: boolean;
};

function requireWebhookDeliverer(webhooks: LogWebhookRouteContext | undefined) {
  if (!webhooks?.deliverer) {
    throw new ApiError("INTERNAL_ERROR", "Webhook deliverer is required for test deliveries.");
  }

  return webhooks.deliverer;
}

export function registerLogRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    logAnalysisQueue?: LogAnalysisQueue;
    webhooks?: LogWebhookRouteContext;
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
      fileName: body.fileName,
      contentType: body.contentType,
      bytes,
      analysisQuestion: body.analysisQuestion,
      relatedParameterId: body.relatedParameterId,
      logDomainId: body.logDomainId
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

  // Static path resolved before /api/v1/logs/:logId by the router's static-count precedence.
  router.get("/api/v1/logs/feedback-insights", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(feedbackInsightsQuerySchema, request.query);
    const result = await listLogFeedbackInsights(db, auth, query);

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
      analysisQuestion: body.analysisQuestion,
      logDomainId: body.logDomainId
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

  router.get("/api/v1/log-domains", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(listLogDomainsQuerySchema, request.query);
    const result = await listLogDomainRecords(db, auth, {
      includeArchived: typeof query.includeArchived === "boolean" ? query.includeArchived : undefined
    });

    return { status: 200, body: result };
  });

  router.post("/api/v1/log-domains", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogDomainBodySchema, request.body);
    const item = await createLogDomainRecord(db, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/log-domains/:domainId", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const body = parseWithSchema(updateLogDomainBodySchema, request.body ?? {});
    const item = await updateLogDomainRecord(db, auth, {
      domainId: params.domainId,
      name: body.name,
      description: body.description,
      formatProfile: body.formatProfile,
      status: body.status,
      modelOverride: body.modelOverride
    }, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.put("/api/v1/log-domains/:domainId/webhook", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const body = parseWithSchema(setLogDomainWebhookBodySchema, request.body);
    const item = await setLogDomainWebhookRecord(
      db,
      auth,
      { domainId: params.domainId, url: body.url, enabled: body.enabled, secret: body.secret },
      { requestId: request.requestId },
      { allowInsecureLocal: options.webhooks?.allowInsecureLocal }
    );

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/log-domains/:domainId/webhook-deliveries", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const query = parseWithSchema(webhookDeliveriesQuerySchema, request.query);
    const result = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId: params.domainId, limit: query.limit });

    return { status: 200, body: result };
  });

  router.post("/api/v1/log-domains/:domainId/webhook-test", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const deliverer = requireWebhookDeliverer(options.webhooks);
    const outcome = await sendLogDomainWebhookTestDelivery(db, auth, params.domainId, deliverer, {
      requestId: request.requestId
    });

    return { status: 200, body: { outcome } };
  });

  router.post("/api/v1/log-domains/:domainId/archive", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const item = await archiveLogDomainRecord(db, auth, params.domainId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/log-domains/:domainId/knowledge-links", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const result = await listLogDomainKnowledgeLinkRecords(db, auth, params.domainId);

    return { status: 200, body: result };
  });

  router.put("/api/v1/log-domains/:domainId/knowledge-links", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithDomainIdSchema, request.params);
    const body = parseWithSchema(setLogDomainKnowledgeLinksBodySchema, request.body);
    const result = await setLogDomainKnowledgeLinkRecords(
      db,
      auth,
      { domainId: params.domainId, knowledgeEntryIds: body.knowledgeEntryIds },
      { requestId: request.requestId }
    );

    return { status: 200, body: result };
  });
}
