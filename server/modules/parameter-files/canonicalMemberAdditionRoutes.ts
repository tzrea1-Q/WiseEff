import { parameterInvocation, parameterRequestAccess } from "../parameters/operatingScope";
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
