import type { Database } from "../../shared/database/client";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { AuthContext } from "../auth/types";
import { z } from "zod";
import { ApiError } from "../../shared/http/errors";
import { createUserInvocation } from "../auth/trustedInvocation";
import { importSharedDtsiInput, inspectSharedDtsiArchive } from "./import";
import { parameterInvocation, parameterRequestAccess } from "../parameters/operatingScope";
import { sharedDtsiArchiveInputSchema, sharedDtsiDraftInputSchema, sharedDtsiDraftUpdateSchema, sharedDtsiDraftDiscardSchema,
  sharedDtsiPreviewRequestSchema, sharedDtsiPublishRequestSchema, sharedDtsiNewVersionDraftSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { createSharedDtsiDraft, discardSharedDtsiDraft, getSharedDtsiDraft, listSharedDtsiResources, saveSharedDtsiDraft, requireWrite } from "./service";
import { createSharedDtsiVersionDraft, getSharedDtsiResourceDetail, getSharedDtsiVersion, listSharedDtsiVersions,
  previewSharedDtsiPublication, publishSharedDtsi } from "./publication";
import { listSharedDtsiUsages } from "./usages";
import { recognizeSharedDtsiVersion } from "./recognition";
import type { ObjectStore } from "../logs/objectStore";
import { importPrivateProjectSource } from "./projectImport";
import { sharedDtsiProjectImportSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { compareSharedDtsiVersions } from "./comparison";
import { sharedDtsiLifecycleSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { changeSharedDtsiLifecycle } from "./lifecycle";

export function registerSharedDtsiRoutes(router: WiseEffRouter, options: {
  db?: Database; objectStore?: ObjectStore; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}) {
  async function access(request: RouteRequest) {
    if (!options.db) throw new ApiError("INTERNAL_ERROR", "Database adapter is required for shared DTSI.");
    const invocation = createUserInvocation(await options.getCurrentAuthContext(request));
    const auth = await parameterRequestAccess(options.db, invocation, request);
    return { db: options.db, auth, context: { invocation: parameterInvocation(auth) ?? invocation, requestId: request.requestId } };
  }
  function parse<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown): z.output<Schema> {
    const result = schema.safeParse(value);
    if (!result.success) throw new ApiError("VALIDATION_FAILED", result.error.issues[0]?.message ?? "共享 DTSI 输入无效。", { issues: result.error.issues });
    return result.data;
  }
  const resourceId = (request: RouteRequest) => parse(z.string().uuid(), request.params.resourceId);
  router.post("/api/v2/projects/:projectId/config-sets/:configSetId/shared-dtsi", async request => {
    const {db,auth,context} = await access(request);
    if(!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Project source storage is required.");
    const params = parse(z.object({projectId:z.string().min(1).max(200),configSetId:z.string().min(1).max(200)}),request.params);
    return {status:201,body:{item:await importPrivateProjectSource(db,options.objectStore,auth,{...params,...parse(sharedDtsiProjectImportSchema,request.body)},context)}};
  });
  router.get("/api/v2/shared-dtsi", async request => {
    const { db, auth } = await access(request);
    const query = parse(z.object({ q: z.string().trim().max(160).default(""), offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(20), organizationId: z.string().optional(),
      eligible: z.literal("1").optional(), exclude: z.string().max(1220).optional().transform(value=>value?value.split(","):[]).pipe(z.array(z.string().uuid()).max(33)), includeMemberCount:z.literal("1").optional() }), request.query);
    return { status: 200, body: await listSharedDtsiResources(db, auth, query) };
  });
  router.post("/api/v2/shared-dtsi", async request => {
    const { db, auth, context } = await access(request);
    requireWrite(auth,context);
    return { status: 201, body: { item: await createSharedDtsiDraft(db, auth, await importSharedDtsiInput(parse(sharedDtsiDraftInputSchema, request.body)), context) } };
  });
  router.post("/api/v2/shared-dtsi/import-preview", async request => {
    const {auth,context}=await access(request);
    requireWrite(auth,context);
    const {archive}=parse(sharedDtsiArchiveInputSchema,request.body);
    const result=await inspectSharedDtsiArchive(parse(sharedDtsiDraftInputSchema,{name:"导入预览",archive}));
    return {status:200,body:{item:{members:result.input.members,ignored:result.ignored}}};
  });
  router.get("/api/v2/shared-dtsi/:resourceId", async request => {
    const { db, auth } = await access(request);
    return { status: 200, body: { item: await getSharedDtsiDraft(db, auth, resourceId(request)) } };
  });
  router.put("/api/v2/shared-dtsi/:resourceId/draft", async request => {
    const { db, auth, context } = await access(request);
    requireWrite(auth,context);
    const {expectedRevision,...input}=parse(sharedDtsiDraftUpdateSchema, request.body);
    return { status: 200, body: { item: await saveSharedDtsiDraft(db, auth, resourceId(request), {...await importSharedDtsiInput(input),expectedRevision}, context) } };
  });
  router.delete("/api/v2/shared-dtsi/:resourceId/draft", async request => {
    const { db, auth, context } = await access(request);
    return { status: 200, body: await discardSharedDtsiDraft(db, auth, resourceId(request), parse(sharedDtsiDraftDiscardSchema, request.body).expectedRevision, context) };
  });
  router.get("/api/v2/shared-dtsi/:resourceId/detail", async request => {
    const { db,auth }=await access(request);
    return {status:200,body:{item:await getSharedDtsiResourceDetail(db,auth,resourceId(request))}};
  });
  router.post("/api/v2/shared-dtsi/:resourceId/lifecycle",async request=>{
    const {db,auth,context}=await access(request);
    return {status:200,body:{item:await changeSharedDtsiLifecycle(db,auth,resourceId(request),parse(sharedDtsiLifecycleSchema,request.body),context)}};
  });
  router.get("/api/v2/shared-dtsi/:resourceId/usages",async request=>{
    const {db,auth}=await access(request);
    const query=parse(z.object({offset:z.coerce.number().int().min(0).max(100_000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}),request.query);
    return {status:200,body:await listSharedDtsiUsages(db,auth,resourceId(request),query)};
  });
  router.get("/api/v2/shared-dtsi/:resourceId/comparison",async request=>{
    const {db,auth}=await access(request);
    const query=parse(z.object({before:z.string().uuid(),after:z.string().uuid()}).refine(value=>value.before!==value.after,"请选择两个不同的已发布版本。"),request.query);
    return {status:200,body:{item:await compareSharedDtsiVersions(db,auth,resourceId(request),query.before,query.after)}};
  });
  router.get("/api/v2/shared-dtsi/:resourceId/versions", async request => {
    const { db,auth }=await access(request);
    const query=parse(z.object({offset:z.coerce.number().int().min(0).max(100_000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}),request.query);
    return {status:200,body:await listSharedDtsiVersions(db,auth,resourceId(request),query)};
  });
  router.get("/api/v2/shared-dtsi/:resourceId/versions/:versionId", async request => {
    const { db,auth }=await access(request);
    return {status:200,body:{item:await getSharedDtsiVersion(db,auth,resourceId(request),parse(z.string().uuid(),request.params.versionId))}};
  });
  router.get("/api/v2/shared-dtsi/:resourceId/versions/:versionId/recognition", async request => {
    const {db,auth}=await access(request);
    return {status:200,body:await recognizeSharedDtsiVersion(db,auth,resourceId(request),parse(z.string().uuid(),request.params.versionId))};
  });
  router.post("/api/v2/shared-dtsi/:resourceId/publication-preview", async request => {
    const {db,auth,context}=await access(request);
    return {status:201,body:{item:await previewSharedDtsiPublication(db,auth,resourceId(request),parse(sharedDtsiPreviewRequestSchema,request.body).expectedRevision,context)}};
  });
  router.post("/api/v2/shared-dtsi/:resourceId/publications", async request => {
    const {db,auth,context}=await access(request);
    const result=await publishSharedDtsi(db,auth,resourceId(request),parse(sharedDtsiPublishRequestSchema,request.body),context);
    return {status:result.replayed?200:201,body:{item:result.item}};
  });
  router.post("/api/v2/shared-dtsi/:resourceId/draft", async request => {
    const {db,auth,context}=await access(request);
    return {status:201,body:{item:await createSharedDtsiVersionDraft(db,auth,resourceId(request),parse(sharedDtsiNewVersionDraftSchema,request.body).baseVersionId,context)}};
  });
}
