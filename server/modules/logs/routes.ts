import { logValidationIssues } from "./validationMessages";
import { previewLogDeletion } from "./deletionPreview";
import { logDeletionStatus, pendingLogDeletions, purgeLog } from "./purge";
import { getSkillDeletionStatus, listSkillDeletions, previewSkillDeletion, purgeSkill } from "./skillDeletion";
import { skillDeletionRequestSchema } from "../contracts/dtoSchemas/skillDeletion";
import type { MultipartBody } from "../../shared/http/server";
import { MAX_LOG_JSON_UPLOAD_BYTES } from "./bundleIntake";
import { z } from "zod";
import type { LogSkillBudgetCaps } from "./skillBudgets";
import type { AuthContext } from "../auth/types";
import type { IntegrationPrincipal } from "../auth/integrationPrincipal";
import { isIntegrationAuthorization } from "../auth/integrationCredentialResolver";
import { issueLogIntegrationCredentialBodySchema, issueIntegrationCredential, listIntegrationCredentials, revokeIntegrationCredential, rotateIntegrationCredential } from "./integrationCredentials";
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
  getLogLineRange,
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
import { createLogSkill, discardLogSkillDraft, getLogSkill, listLogSkills, listLogSkillSourceVersions, listLogSkillTemplates, publishLogSkill, readLogSkillRevisions, restoreLogSkillRevision, saveLogSkillDraft } from "./skillsService";
import { exportLogSkillPackage, importLogSkillPackage } from "./skillPackages";
import { deleteLogSkillSample, getLogSkillSample, replaceLogSkillSample } from "./skillSamplesService";
import { previewLogSkillFiles, skillFilePreviewRequestSchema } from "./skillFilePreview";
import { logSkillSpecSchema } from "./skillSpec";
import { previewLogSkillSignals, signalPreviewRequestSchema } from "./signalPreview";
import { previewLogSkillParsing, previewLogSkillExtractor, previewLogSkillFormat, runLogSkillParseTests } from "./skillsService";
import { parsePreviewRequestSchema } from "./parsing/spec";
import { extractorPreviewRequestSchema } from "./parsing/extractorBuilder";
import { formatPreviewRequestSchema } from "./formatProfile";
import { archiveSourceSnapshot, getSourceEvidence, listSourceSnapshots, retrySourceSnapshot, setDefaultSourceSnapshot, trySourceStatement, uploadSourceSnapshot } from "./sourceSnapshots";
import { sourceSnapshotUploadSchema } from "./schemas";
import { recommendOrganizationLogSkills } from "./skillRecommendationService";
import { logSkillRecommendationRequestSchema } from "./schemas";
import type { LogAnalysisAdapter } from "./analyzer";
import { getLogTrace, getSkillDryRun, getSkillDryRunLines, startSkillDryRun } from "./dryRuns";
import { requireLogAdminDomains } from "./policy";
import { createAnalysisCase, updateAnalysisCase, deleteAnalysisCase, listAnalysisCases, startAnalysisCaseRun, getAnalysisCaseRun, getAnalysisCaseTrace, getAnalysisCasePrefill, importSkillAnalysisCases, exportSkillAnalysisCases } from "./analysisCases";
import {
  createLogBodySchema,
  createLogDomainBodySchema,
  createLogFileBodySchema,
  createLogSkillBodySchema,
  replaceLogSkillSampleBodySchema,
  feedbackInsightsQuerySchema,
  listLogDomainsQuerySchema,
  listLogsQuerySchema,
  logLineRangeQuerySchema,
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
    throw new ApiError("INTERNAL_ERROR", "日志接口需要数据库适配器。");
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "日志文件上传需要对象存储服务。");
  }

  return objectStore;
}

function requireLocalOrganization(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) {
    throw new ApiError("FORBIDDEN", "无权访问此组织的日志。", { organizationId: auth.organization.id });
  }
}

function parseWithSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, message = "提交的日志信息无效，请检查后重试。") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: logValidationIssues(parsed.error.issues) });
  }

  return parsed.data;
}

async function getAuth(getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext, request: RouteRequest) {
  if (isIntegrationAuthorization(request.headers.authorization)) throw new ApiError("UNAUTHENTICATED", "请使用用户账号登录后操作。");
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
    throw new ApiError("INTERNAL_ERROR", "结果通知测试需要通知发送服务。");
  }

  return webhooks.deliverer;
}

export function registerLogRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    logAnalysisQueue?: LogAnalysisQueue;
    analyzer?: LogAnalysisAdapter;
    webhooks?: LogWebhookRouteContext;
    skillBudgetCaps?: LogSkillBudgetCaps;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
    getIntegrationPrincipal?: (request: RouteRequest) => Promise<IntegrationPrincipal>;
  }
) {
  router.get("/api/v1/logs/:logId/analysis-case-prefill", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await getAnalysisCasePrefill(requireDb(options.db), auth, request.params.logId) };
  });
  router.get("/api/v1/log-skills/:skillId/analysis-cases", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await listAnalysisCases(requireDb(options.db), auth, request.params.skillId) };
  });
  router.post("/api/v1/log-skills/:skillId/analysis-cases", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    requireLocalOrganization(auth); requireLogAdminDomains(auth);
    const body = parseWithSchema(z.object({ name: z.string().trim().min(1).max(200), expectations: z.unknown(), sourceRecordId: z.string().min(1).optional(),
      files: z.array(z.object({ fileName: z.string().min(1).max(1024), contentBase64: z.string().min(1).max(14 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) })).min(1).max(100).optional() }).strict(), request.body);
    const item = await createAnalysisCase(requireDb(options.db), requireObjectStore(options.objectStore), auth, request.params.skillId,
      { ...body, expectations: body.expectations, files: body.files?.map((file) => ({ fileName: file.fileName, bytes: Buffer.from(file.contentBase64, "base64") })) }, createUserInvocation(auth), { requestId: request.requestId });
    return { status: 201, body: { item } };
  });
  router.patch("/api/v1/log-skills/:skillId/analysis-cases/:caseId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(z.object({ name: z.string().trim().min(1).max(200), expectations: z.unknown() }).strict(), request.body);
    const item = await updateAnalysisCase(requireDb(options.db), requireObjectStore(options.objectStore), auth, request.params.skillId, request.params.caseId, { ...body, expectations: body.expectations }, createUserInvocation(auth), { requestId: request.requestId });
    return { status: 200, body: { item } };
  });
  router.delete("/api/v1/log-skills/:skillId/analysis-cases/:caseId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await deleteAnalysisCase(requireDb(options.db), auth, request.params.skillId, request.params.caseId, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.post("/api/v1/log-skills/:skillId/analysis-case-runs", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    requireLocalOrganization(auth); requireLogAdminDomains(auth);
    if (!options.analyzer) throw new ApiError("INTERNAL_ERROR", "运行分析用例需要已配置的日志分析器。");
    const body = parseWithSchema(z.object({ caseIds: z.array(z.string().min(1)).min(1).max(20).optional() }).strict(), request.body ?? {});
    return { status: 202, body: await startAnalysisCaseRun(requireDb(options.db), requireObjectStore(options.objectStore), options.analyzer, auth, request.params.skillId, body.caseIds, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.get("/api/v1/log-skills/:skillId/analysis-case-runs/:runId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await getAnalysisCaseRun(requireDb(options.db), auth, request.params.skillId, request.params.runId) };
  });
  router.get("/api/v1/log-skills/:skillId/analysis-case-runs/:runId/cases/:caseId/trace", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(z.object({ revision: z.enum(["draft", "published"]).default("draft") }), request.query);
    return { status: 200, body: await getAnalysisCaseTrace(requireDb(options.db), auth, request.params.skillId, request.params.runId, request.params.caseId, query.revision ?? "draft") };
  });
  router.post("/api/v1/log-skills/:skillId/analysis-cases/import", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    requireLocalOrganization(auth); requireLogAdminDomains(auth);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    if (!multipart || multipart.files.length !== 1) throw new ApiError("VALIDATION_FAILED", "请选择一个用例 ZIP 压缩包。");
    return { status: 201, body: await importSkillAnalysisCases(requireDb(options.db), requireObjectStore(options.objectStore), auth, request.params.skillId, multipart.files[0].bytes, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.get("/api/v1/log-skills/:skillId/analysis-cases/export", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, bytes: await exportSkillAnalysisCases(requireDb(options.db), requireObjectStore(options.objectStore), auth, request.params.skillId), contentType: "application/zip", fileName: "analysis-cases.zip" };
  });
  router.post("/api/v1/log-skills/recommend", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    requireLocalOrganization(auth);
    const body = parseWithSchema(logSkillRecommendationRequestSchema, request.body);
    return { status: 200, body: await recommendOrganizationLogSkills(requireDb(options.db), auth, body.files) };
  });
  const getLogPrincipal = async (request: RouteRequest): Promise<AuthContext | IntegrationPrincipal> => {
    if (isIntegrationAuthorization(request.headers.authorization)) {
      if (!options.getIntegrationPrincipal) throw new ApiError("UNAUTHENTICATED", "尚未配置集成凭据解析服务。");
      return options.getIntegrationPrincipal(request);
    }
    return getAuth(options.getCurrentAuthContext, request);
  };
  router.get("/api/v1/log-integration-credentials", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await listIntegrationCredentials(requireDb(options.db), auth) };
  });
  router.post("/api/v1/log-integration-credentials", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(issueLogIntegrationCredentialBodySchema, request.body);
    return { status: 201, headers: { "Cache-Control": "no-store" }, body: await issueIntegrationCredential(requireDb(options.db), auth, body, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.post("/api/v1/log-integration-credentials/:credentialId/rotate", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, headers: { "Cache-Control": "no-store" }, body: await rotateIntegrationCredential(requireDb(options.db), auth, request.params.credentialId, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.post("/api/v1/log-integration-credentials/:credentialId/revoke", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await revokeIntegrationCredential(requireDb(options.db), auth, request.params.credentialId, createUserInvocation(auth), { requestId: request.requestId }) };
  });
  router.get("/api/v1/log-skills/:skillId/source-versions", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await listLogSkillSourceVersions(requireDb(options.db), auth, request.params.skillId) };
  });
  router.get("/api/v1/logs/:logId/trace", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await getLogTrace(requireDb(options.db), auth, request.params.logId) };
  });
  router.post("/api/v1/log-skills/:skillId/dry-runs", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    // Authorization happens before reporting analyzer availability.
    requireLocalOrganization(auth);
    requireLogAdminDomains(auth);
    if (!options.analyzer) throw new ApiError("INTERNAL_ERROR", "试运行需要已配置的日志分析器。");
    return { status: 202, body: await startSkillDryRun(requireDb(options.db), requireObjectStore(options.objectStore), options.analyzer, auth, request.params.skillId) };
  });
  router.get("/api/v1/log-skills/:skillId/dry-runs/:runId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await getSkillDryRun(requireDb(options.db), auth, request.params.skillId, request.params.runId) };
  });
  router.get("/api/v1/log-skills/:skillId/dry-runs/:runId/lines", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const item = await getSkillDryRunLines(requireDb(options.db), requireObjectStore(options.objectStore), auth,
      request.params.skillId, request.params.runId, parseWithSchema(logLineRangeQuerySchema, request.query));
    return { status: 200, body: { item } };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/locate", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(z.object({ line: z.string().trim().min(1).max(4000) }).strict(), request.body);
    return { status: 200, body: await trySourceStatement(requireDb(options.db), auth, request.params.skillId, request.params.snapshotId, body.line) };
  });
  router.get("/api/v1/logs/:logId/evidence/:evidenceId/source", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: { item: await getSourceEvidence(requireDb(options.db), auth, request.params.logId, request.params.evidenceId) } };
  });
  router.get("/api/v1/log-skills/:skillId/source-snapshots", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: await listSourceSnapshots(requireDb(options.db), auth, request.params.skillId) };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    const files = multipart?.files.filter((file) => file.fieldName === "file");
    if (!multipart || files?.length !== 1) throw new ApiError("VALIDATION_FAILED", "请选择一个源码压缩包。");
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
    return { status: 200, body: { item: await getLogSkill(db, auth, request.params.skillId, options.skillBudgetCaps) } };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/archive", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const item = await archiveSourceSnapshot(requireDb(options.db), auth, request.params.skillId, request.params.snapshotId,
      createUserInvocation(auth), { requestId: request.requestId });
    return { status: 200, body: { item } };
  });
  router.post("/api/v1/log-skills/:skillId/source-snapshots/:snapshotId/retry", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    parseWithSchema(z.object({}).strict(), request.body ?? {});
    const item = await retrySourceSnapshot(requireDb(options.db), auth, request.params.skillId, request.params.snapshotId,
      createUserInvocation(auth), { requestId: request.requestId });
    return { status: 202, body: { item } };
  });
  router.post("/api/v1/log-files", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getLogPrincipal(request);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    const files = multipart?.files.filter((file) => file.fieldName === "file");
    if (multipart && !files?.length) throw new ApiError("VALIDATION_FAILED", "请选择至少一个日志文件");
    if (!multipart && typeof (request.body as { contentBase64?: unknown })?.contentBase64 === "string"
      && (request.body as { contentBase64: string }).contentBase64.length > 4 * Math.ceil(MAX_LOG_JSON_UPLOAD_BYTES / 3)) {
      throw new ApiError("PAYLOAD_TOO_LARGE", "当前上传方式最多支持 32 MiB，请使用文件上传方式提交更大的日志包。");
    }
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
      sourceVersion: body.sourceVersion,
      skillSelection: body.skillSelection,
      logDomainId: body.logDomainId,
      skillId: body.skillId,
      skillKey: body.skillKey
    }, { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue });

    return { status: 201, body: { fileObject: result.fileObject, log: result.log, job: result.job } };
  });

  router.post("/api/v1/logs", async (request) => {
    const db = requireDb(options.db);
    const auth = await getLogPrincipal(request);
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
        sourceVersion: body.sourceVersion,
        skillSelection: body.skillSelection,
        logDomainId: body.logDomainId,
        skillId: body.skillId,
        skillKey: body.skillKey
      },
      { requestId: request.requestId, logAnalysisQueue: options.logAnalysisQueue, objectStore: requireObjectStore(options.objectStore) }
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
    const auth = await getLogPrincipal(request);
    if (!("kind" in auth)) requireLocalOrganization(auth);
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

  router.get("/api/v1/logs/:logId/deletion-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { logId } = parseWithSchema(paramsWithLogIdSchema, request.params);
    return { status: 200, body: { item: await previewLogDeletion(requireDb(options.db), auth, logId) } };
  });
  router.get("/api/v1/logs/deletions", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: { items: await pendingLogDeletions(requireDb(options.db), auth) } };
  });
  router.get("/api/v1/logs/:logId/deletion-status", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { logId } = parseWithSchema(paramsWithLogIdSchema, request.params);
    return { status: 200, body: { item: await logDeletionStatus(requireDb(options.db), auth, logId) } };
  });
  router.delete("/api/v1/logs/:logId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { logId } = parseWithSchema(paramsWithLogIdSchema, request.params);
    const { version } = parseWithSchema(z.object({ version: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), request.body);
    return { status: 200, body: { item: await purgeLog(requireDb(options.db), createUserInvocation(auth), logId, version, request.requestId, options.objectStore) } };
  });

  router.get("/api/v1/logs/:logId/lines", async (request) => {
    const db = requireDb(options.db);
    const auth = await getLogPrincipal(request);
    if (!("kind" in auth)) requireLocalOrganization(auth);
    const params = parseWithSchema(paramsWithLogIdSchema, request.params);
    const query = parseWithSchema(logLineRangeQuerySchema, request.query);
    const item = await getLogLineRange(db, requireObjectStore(options.objectStore), auth, params.logId, query);
    return { status: 200, body: { item } };
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
    return { status: 201, body: { item: await createLogSkill(requireDb(options.db), auth, body, createUserInvocation(auth), { requestId: request.requestId }, options.skillBudgetCaps) } };
  });
  router.post("/api/v1/log-skills/import", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    requireLocalOrganization(auth); requireLogAdminDomains(auth);
    const multipart = (request.body as Partial<MultipartBody>)?.kind === "multipart" ? request.body as MultipartBody : undefined;
    if (!multipart || multipart.files.length !== 1 || multipart.files[0].fieldName !== "file") throw new ApiError("VALIDATION_FAILED", "请选择一个技能包 ZIP 文件。");
    const fields = parseWithSchema(z.object({ status: z.enum(["draft", "published"]).default("draft"), name: z.string().optional() }).strict(), multipart.fields);
    return { status: 201, body: { item: await importLogSkillPackage(requireDb(options.db), requireObjectStore(options.objectStore), auth,
      multipart.files[0].bytes, fields.status, createUserInvocation(auth), { requestId: request.requestId }, options.skillBudgetCaps, fields.name) } };
  });
  router.get("/api/v1/log-skills/:skillId/package", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(z.object({ revision: z.enum(["published", "draft"]).default("published") }).strict(), request.query);
    return { status: 200, bytes: await exportLogSkillPackage(requireDb(options.db), requireObjectStore(options.objectStore), auth,
      request.params.skillId, query.revision), contentType: "application/zip", fileName: "skill-package.zip" };
  });
  const skillParams = z.object({ skillId: z.string().min(1) });
  router.get("/api/v1/log-skills/deletions", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    return { status: 200, body: { items: await listSkillDeletions(requireDb(options.db), auth) } };
  });
  router.get("/api/v1/log-skills/:skillId/deletion-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await previewSkillDeletion(requireDb(options.db), auth, skillId) } };
  });
  router.get("/api/v1/log-skills/:skillId/deletion-status", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await getSkillDeletionStatus(requireDb(options.db), auth, skillId) } };
  });
  router.post("/api/v1/log-skills/:skillId/purge", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { version } = parseWithSchema(skillDeletionRequestSchema, request.body);
    return { status: 200, body: { item: await purgeSkill(requireDb(options.db), createUserInvocation(auth), skillId, version, request.requestId, options.objectStore) } };
  });
  router.get("/api/v1/log-skills/:skillId/sample", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await getLogSkillSample(requireDb(options.db), requireObjectStore(options.objectStore), auth, skillId) } };
  });
  router.put("/api/v1/log-skills/:skillId/sample", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(replaceLogSkillSampleBodySchema, request.body, "请选择一个不超过 2 MiB 的文本样例或压缩包。");
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
  router.post("/api/v1/log-skills/:skillId/files/preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(skillFilePreviewRequestSchema, request.body);
    return { status: 200, body: await previewLogSkillFiles(requireDb(options.db), requireObjectStore(options.objectStore), auth, skillId, body) };
  });
  router.post("/api/v1/log-skills/:skillId/parse-tests", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(z.object({ spec: z.unknown().refine((value) => value !== undefined, "请提供技能配置") }).strict(), request.body);
    return { status: 200, body: await runLogSkillParseTests(requireDb(options.db), auth, skillId, body.spec) };
  });
  router.post("/api/v1/log-skills/:skillId/signals-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(signalPreviewRequestSchema, request.body);
    return { status: 200, body: await previewLogSkillSignals(requireDb(options.db), requireObjectStore(options.objectStore), auth, skillId, body) };
  });
  router.post("/api/v1/log-skills/:skillId/extractor-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(extractorPreviewRequestSchema, request.body);
    return { status: 200, body: await previewLogSkillExtractor(requireDb(options.db), auth, skillId, body) };
  });
  router.post("/api/v1/log-skills/:skillId/format-preview", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const body = parseWithSchema(formatPreviewRequestSchema, request.body);
    return { status: 200, body: await previewLogSkillFormat(requireDb(options.db), auth, skillId, body) };
  });
  router.get("/api/v1/log-skills/:skillId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    return { status: 200, body: { item: await getLogSkill(requireDb(options.db), auth, skillId, options.skillBudgetCaps) } };
  });
  router.put("/api/v1/log-skills/:skillId/draft", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { spec, baseDraftRevisionId, basePublishedRevisionId } = parseWithSchema(z.object({ spec: logSkillSpecSchema, baseDraftRevisionId: z.string().min(1).nullable(), basePublishedRevisionId: z.string().min(1) }).strict(), request.body);
    return { status: 200, body: { item: await saveLogSkillDraft(requireDb(options.db), auth, skillId, spec, baseDraftRevisionId, basePublishedRevisionId, createUserInvocation(auth), { requestId: request.requestId }, options.skillBudgetCaps) } };
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
    return { status: 200, body: { item: await restoreLogSkillRevision(requireDb(options.db), auth, skillId, revisionId, createUserInvocation(auth), { requestId: request.requestId }, options.skillBudgetCaps) } };
  });
  router.post("/api/v1/log-skills/:skillId/publish", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const { skillId } = parseWithSchema(skillParams, request.params);
    const { draftRevisionId } = parseWithSchema(z.object({ draftRevisionId: z.string().min(1) }).strict(), request.body);
    return { status: 200, body: { item: await publishLogSkill(requireDb(options.db), auth, skillId, draftRevisionId, createUserInvocation(auth), { requestId: request.requestId }, options.skillBudgetCaps) } };
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
    if (!item) throw new ApiError("NOT_FOUND", "未找到技能版本。");
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
      skillKey: body.skillKey,
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
