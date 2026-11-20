import { parameterInvocation, parameterOrganizationId, parameterRequestAccess } from "../parameters/operatingScope";
import { z } from "zod";
import { isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { assertTrustedRefusalAuditSink, createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { applyCanonicalMemberAddition, previewCanonicalMemberAddition } from "./canonicalMemberAddition";
import { memberAdditionBodySchema, memberAdditionApplyBodySchema, memberAdditionIntentActionSchema, memberAdditionIntentRegisterSchema } from "../contracts/dtoSchemas/canonicalMemberAddition";
import { listMemberAdditionIntents, reserveMemberAddition, resolveMemberAdditionIntent } from "./canonicalMemberAdditionIntents";
import { readCurrentJsonInstances, readJsonCorrectionSchemas } from "./canonicalJsonSource";
import { loadSnapshot, requireCurrentSourceAdministrator } from "./sourceRevisionService";
import {
  jsonCorrectionApplySchema, jsonCorrectionPreviewResponseSchema, jsonCorrectionSchema,
  pathCorrectionApplySchema, pathCorrectionPreviewResponseSchema, pathCorrectionSchema
} from "../contracts/dtoSchemas/configurationCorrection";

export function registerCanonicalMemberAdditionRoutes(router: WiseEffRouter, options: {
  db?: Database; objectStore?: ObjectStore; refusalAuditSink?: TrustedRefusalAuditSink;
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}) {
  const sink = options.refusalAuditSink ?? (options.db && isRootDatabase(options.db) ? createTrustedRefusalAuditSink(options.db) : undefined);
  if (sink) assertTrustedRefusalAuditSink(sink);
  async function handle(request: RouteRequest, operation: "preview" | "apply") {
    if (!options.db || !options.objectStore || !sink) throw new ApiError("INTERNAL_ERROR", "Configuration source storage and refusal auditing are required.");
    const params = z.object({ projectId: z.string().min(1), configSetId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw new ApiError("VALIDATION_FAILED", "Invalid configuration target.");
    const auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request), security = { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink: sink };
    if (operation === "preview") {
      const body = memberAdditionBodySchema.safeParse(request.body);
      if (!body.success) throw new ApiError("VALIDATION_FAILED", "文件、用途、顺序或 JSON 映射不完整。", { issues: body.error.issues });
      return { status: 200, body: { item: await previewCanonicalMemberAddition(options.db, options.objectStore, auth, { ...params.data, ...body.data }, security) } };
    }
    const body = memberAdditionApplyBodySchema.safeParse(request.body);
    if (!body.success) throw new ApiError("VALIDATION_FAILED", "确认预览、原因或操作编号不完整。", { issues: body.error.issues });
    return { status: 200, body: { item: await applyCanonicalMemberAddition(options.db, options.objectStore, auth, { ...params.data, ...body.data }, security) } };
  }
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/preview", (request) => handle(request, "preview"));
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/apply", (request) => handle(request, "apply"));
  async function correctPath(request: RouteRequest, operation: "preview" | "apply") {
    if (!options.db || !options.objectStore || !sink) throw new ApiError("INTERNAL_ERROR", "Configuration source storage and refusal auditing are required.");
    const params = z.object({ projectId: z.string().min(1), configSetId: z.string().min(1), fileId: z.string().min(1) }).safeParse(request.params);
    const apply = operation === "apply" ? pathCorrectionApplySchema.safeParse(request.body) : null;
    const parsed = apply ?? pathCorrectionSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw new ApiError("VALIDATION_FAILED", "请填写项目文件的新路径及确认信息。");
    const auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const security = { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink: sink };
    const input = { ...params.data, pathCorrection: parsed.data.sourceName, role: "misc" as const, sortOrder: 0 };
    const item = apply?.success
      ? await applyCanonicalMemberAddition(options.db, options.objectStore, auth, { ...input, ...apply.data }, security)
      : await previewCanonicalMemberAddition(options.db, options.objectStore, auth, input, security);
    return { status: 200, body: apply?.success ? { item } : pathCorrectionPreviewResponseSchema.parse({ item }) };
  }
  const path = "/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId/path-correction";
  router.post(`${path}/preview`, (request) => correctPath(request, "preview"));
  router.post(`${path}/apply`, (request) => correctPath(request, "apply"));
  const jsonPath = "/api/v2/projects/:projectId/parameter-files/:fileId/configuration-instances";
  async function correctJson(request: RouteRequest, operation: "read" | "preview" | "apply") {
    if (!options.db || !options.objectStore || !sink) throw new ApiError("INTERNAL_ERROR", "Configuration source storage and refusal auditing are required.");
    const params = z.object({ projectId: z.string().min(1), fileId: z.string().min(1), occurrenceId: z.string().min(1).optional() }).safeParse(request.params);
    if (!params.success) throw new ApiError("VALIDATION_FAILED", "请选择有效的 JSON 来源。");
    const auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const { projectId, fileId, occurrenceId } = params.data;
    const organizationId = parameterOrganizationId(auth);
    await options.db.transaction(tx => requireCurrentSourceAdministrator(tx, auth, projectId));
    const snapshot = await loadSnapshot(options.db);
    if (!snapshot) throw new ApiError("CONFLICT", "JSON 实例纠正需要已发布的配置规范。");
    const instance = await readCurrentJsonInstances(options.db, snapshot, { organizationId, projectId, fileId });
    if (operation === "read") {
      const schemas = await readJsonCorrectionSchemas(options.db, snapshot, organizationId);
      return { status: 200, body: { ...instance, schemas } };
    }
    const apply = operation === "apply" ? jsonCorrectionApplySchema.safeParse(request.body) : null;
    const body = apply ?? jsonCorrectionSchema.safeParse(request.body);
    if (!occurrenceId || !body.success || !instance.configSetId) throw new ApiError("VALIDATION_FAILED", "请填写配置规范、JSON Pointer 和字段映射。");
    const { configurationSchemaId, rootPointer, mappings } = body.data;
    const input = { projectId, configSetId: instance.configSetId, fileId, role: "misc" as const, sortOrder: 0,
      jsonCorrection: { previousOccurrenceId: occurrenceId, configurationSchemaId, rootPointer, mappings } };
    const security = { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink: sink };
    const item = apply?.success
      ? await applyCanonicalMemberAddition(options.db, options.objectStore, auth, { ...input, ...apply.data }, security)
      : await previewCanonicalMemberAddition(options.db, options.objectStore, auth, input, security);
    return { status: 200, body: apply?.success ? { item } : jsonCorrectionPreviewResponseSchema.parse({ item }) };
  }
  router.get(jsonPath, request => correctJson(request, "read"));
  router.post(`${jsonPath}/:occurrenceId/correction/preview`, request => correctJson(request, "preview"));
  router.post(`${jsonPath}/:occurrenceId/correction/apply`, request => correctJson(request, "apply"));
  async function intent(request:RouteRequest,operation:"reserve"|"stop"|"ack"){
    if(!options.db||!sink)throw new ApiError("INTERNAL_ERROR","Configuration database and refusal auditing are required.");
    const parsed=z.object({projectId:z.string().min(1),configSetId:z.string().min(1),intentId:z.string().uuid().optional()}).safeParse(request.params);
    if(!parsed.success)throw new ApiError("VALIDATION_FAILED","Invalid operation target.");const params=parsed.data;
    const auth=await parameterRequestAccess(options.db,createUserInvocation(await options.getCurrentAuthContext(request)),request);
    const security={invocation:parameterInvocation(auth)??createUserInvocation(auth),requestId:request.requestId,refusalSink:sink};
    if(operation==="reserve"){
      const body=memberAdditionIntentRegisterSchema.safeParse(request.body);
      if(!body.success)throw new ApiError("VALIDATION_FAILED","Invalid registration identity.");
      return {status:200,body:{item:await reserveMemberAddition(options.db,auth,params,body.data.registrationId,security)}};
    }
    if(!memberAdditionIntentActionSchema.safeParse(request.body).success)throw new ApiError("VALIDATION_FAILED","Invalid operation request.");
    if(!params.intentId)throw new ApiError("VALIDATION_FAILED","Invalid operation identity.");
    return {status:200,body:{item:await resolveMemberAdditionIntent(options.db,auth,params,params.intentId,operation,security)}};
  }
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/intents",request=>intent(request,"reserve"));
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/intents/:intentId/stop",request=>intent(request,"stop"));
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/intents/:intentId/ack",request=>intent(request,"ack"));
  router.get("/api/v1/member-addition-intents",async request=>{
    if(!options.db||!sink)throw new ApiError("INTERNAL_ERROR","Configuration database and refusal auditing are required.");
    const query=z.object({limit:z.coerce.number().int().min(1).max(50).default(50),offset:z.coerce.number().int().min(0).max(5000).default(0),
      projectId:z.string().min(1).max(200).optional(),configSetId:z.string().min(1).max(200).optional()}).safeParse(request.query);
    if(!query.success)throw new ApiError("VALIDATION_FAILED","Invalid operation page.");
    const auth=await parameterRequestAccess(options.db,createUserInvocation(await options.getCurrentAuthContext(request)),request);
    return {status:200,body:await listMemberAdditionIntents(options.db,auth,query.data.limit,query.data.offset,
      {invocation:parameterInvocation(auth)??createUserInvocation(auth),requestId:request.requestId,refusalSink:sink},query.data)};
  });
}
