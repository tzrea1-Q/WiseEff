import type { MultipartBody } from "../../shared/http/server";
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
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
import { createLogSkill, discardLogSkillDraft, getLogSkill, listLogSkills, listLogSkillTemplates, publishLogSkill, readLogSkillRevisions, restoreLogSkillRevision, saveLogSkillDraft } from "./skillsService";
import { deleteLogSkillSample, getLogSkillSample, replaceLogSkillSample } from "./skillSamplesService";
import { logSkillSpecSchema } from "./skillSpec";
import { previewLogSkillParsing } from "./skillsService";
import { parsePreviewRequestSchema } from "./parsing/spec";
import { archiveSourceSnapshot, listSourceSnapshots, setDefaultSourceSnapshot, uploadSourceSnapshot } from "./sourceSnapshots";
import { sourceSnapshotUploadSchema } from "./schemas";
import {
  createLogBodySchema,
  createLogDomainBodySchema,
  createLogFileBodySchema,
  createLogSkillBodySchema,
  replaceLogSkillSampleBodySchema,
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
  router.get("/api/v1/log-skills/:skillId/source-snapshots", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await listSourceSnapshots(requireDb(options.db), auth, request.params.skillId) };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    const files = multipart?.files.filter((file) => file.fieldName === "file");
    if (!multipart || files?.length !== 1) throw new ApiError("VALIDATION_FAILED", "One multipart source archive is required.");
    const body = parseWithSchema(sourceSnapshotUploadSchema, {
      versionLabel: multipart.fields.versionLabel, fileName: files[0].fileName
    });
    const item = await uploadSourceSnapshot(requireDb(options.db), requireObjectStore(options.objectStore), auth,
      request.params.skillId, { versionLabel: body.versionLabel, fileName: body.fileName,
        bytes: files[0].bytes },
      createUserInvocation(auth), { requestId: request.requestId });
    return { status: 201, body: { item } };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/default", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const db = requireDb(options.db);
    await setDefaultSourceSnapshot(db, auth, request.params.skillId, request.params.snapshotId,
      createUserInvocation(auth), { requestId: request.requestId });
    return { status: 200, body: { item: await getLogSkill(db, auth, request.params.skillId) } };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/archive", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const item = await archiveSourceSnapshot(requireDb(options.db), auth, request.params.skillId, request.params.snapshotId,
      createUserInvocation(auth), { requestId: request.requestId });
    return { status: 200, body: { item } };
  });
  router.post("/api/v1/log-files", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    const files = multipart?.files.filter((file) => file.fieldName === "file");
    if (multipart && !files?.length) throw new ApiError("VALIDATION_FAILED", "请选择至少一个日志文件");
    let fields: Record<string, unknown> = multipart?.fields ?? {};
    if (multipart?.fields.relatedParameterPin) {
      try { fields = { ...fields, relatedParameterPin: JSON.parse(multipart.fields.relatedParameterPin) }; }
      catch { throw new ApiError("VALIDATION_FAILED", "关联参数格式无效"); }
    }
    const body = parseWithSchema(createLogFileBodySchema, multipart ? {
      ...fields, fileName: files![0].fileName, contentType: files![0].contentType,
      contentBase64: "AA==" // Validate metadata without duplicating multipart bytes as base64.
    } : request.body);
    const bytes = files?.[0].bytes ?? Buffer.from(body.contentBase64, "base64");
    const result = await uploadLogFile(db, objectStore, auth, {
      files,
      fileName: files && files.length > 1 ? `${files[0].fileName} 等 ${files.length} 个文件` : body.fileName,
      contentType: body.contentType,
      bytes,
      analysisQuestion: body.analysisQuestion,
      relatedParameterId: body.relatedParameterId,
      relatedParameterPin: body.relatedParameterPin,
      logDomainId: body.skillId ?? body.logDomainId
    }, { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue });

    return { status: 201, body: { fileObject: result.fileObject, log: result.log, job: result.job } };
  });

  router.post("/api/v1/logs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogBodySchema, request.body);
    const result = await createLogFromFile(
      db,
      auth,
      {
        fileObjectId: body.fileObjectId,
        fileName: body.fileName,
        analysisQuestion: body.analysisQuestion,
        relatedParameterId: body.relatedParameterId,
        relatedParameterPin: body.relatedParameterPin,
        logDomainId: body.skillId ?? body.logDomainId
      },
      { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue }
    );

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
      logDomainId: body.skillId ?? body.logDomainId,
      revisionPolicy: body.revisionPolicy
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

  router.get("/api/v1/log-skills", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(listLogDomainsQuerySchema, request.query);
    return { status: 200, body: await listLogSkills(requireDb(options.db), auth, typeof query.includeArchived === "boolean" ? query.includeArchived : undefined) };
  });
  router.get("/api/v1/log-skill-templates", async (request) => ({
    status: 200, body: listLogSkillTemplates(await getAuth(options.getCurrentAuthContext, request))
  }));
  router.post("/api/v1/log-skills", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createLogSkillBodySchema, request.body);
    return { status: 201, body: { item: await createLogSkill(requireDb(options.db), auth, body, createUserInvocation(auth), { requestId: request.requestId }) } };
  });
  const skillParams = z.object({ skillId: z.string().min(1) });
  router.get("/api/v1/log-skills/:skillId/sample", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await getLogSkillSample(requireDb(options.db), requireObjectStore(options.objectStore), auth, skillId) } };
  });
  router.put("/api/v1/log-skills/:skillId/sample", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(replaceLogSkillSampleBodySchema, request.body, "请选择一个不超过 2 MiB 的文本样例日志。");
    return { status: 200, body: { item: await replaceLogSkillSample(requireDb(options.db), requireObjectStore(options.objectStore), auth, skillId, body,
      createUserInvocation(auth), { requestId: request.requestId }) } };
  });
  router.delete("/api/v1/log-skills/:skillId/sample", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    await deleteLogSkillSample(requireDb(options.db), auth, skillId, createUserInvocation(auth), { requestId: request.requestId });
    return { status: 204, body: undefined };
  });
  router.post("/api/v1/log-skills/:skillId/parse-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(parsePreviewRequestSchema, request.body);
    return { status: 200, body: await previewLogSkillParsing(requireDb(options.db), auth, skillId, body) };
  });
  router.get("/api/v1/log-skills/:skillId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await getLogSkill(requireDb(options.db), auth, skillId) } };
  });
  router.put("/api/v1/log-skills/:skillId/draft", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { spec, baseDraftRevisionId, basePublishedRevisionId } = parseWithSchema(z.object({ spec: logSkillSpecSchema, baseDraftRevisionId: z.string().min(1).nullable(), basePublishedRevisionId: z.string().min(1) }).strict(), request.body);
    return { status: 200, body: { item: await saveLogSkillDraft(requireDb(options.db), auth, skillId, spec, baseDraftRevisionId, basePublishedRevisionId, createUserInvocation(auth), { requestId: request.requestId }) } };
  });
  router.delete("/api/v1/log-skills/:skillId/draft", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { draftRevisionId } = parseWithSchema(z.object({ draftRevisionId: z.string().min(1) }).strict(), request.query);
    await discardLogSkillDraft(requireDb(options.db), auth, skillId, draftRevisionId, createUserInvocation(auth), { requestId: request.requestId });
    return { status: 204, body: null };
  });
  router.post("/api/v1/log-skills/:skillId/revisions/:revisionId/restore", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId, revisionId } = parseWithSchema(skillParams.extend({ revisionId: z.string().min(1) }), request.params);
    return { status: 200, body: { item: await restoreLogSkillRevision(requireDb(options.db), auth, skillId, revisionId, createUserInvocation(auth), { requestId: request.requestId }) } };
  });
  router.post("/api/v1/log-skills/:skillId/publish", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { draftRevisionId } = parseWithSchema(z.object({ draftRevisionId: z.string().min(1) }).strict(), request.body);
    return { status: 200, body: { item: await publishLogSkill(requireDb(options.db), auth, skillId, draftRevisionId, createUserInvocation(auth), { requestId: request.requestId }) } };
  });
  router.get("/api/v1/log-skills/:skillId/revisions", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { items: await readLogSkillRevisions(requireDb(options.db), auth, skillId) } };
  });
  router.get("/api/v1/log-skills/:skillId/revisions/:revisionId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId, revisionId } = parseWithSchema(skillParams.extend({ revisionId: z.string().min(1) }), request.params);
    const item = (await readLogSkillRevisions(requireDb(options.db), auth, skillId)).find((r) => r.id === revisionId);
    if (!item) throw new ApiError("NOT_FOUND", "Skill revision was not found.");
    return { status: 200, body: { item } };
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
