import { z } from "zod";
import { itemEnvelopeSchema, okEnvelopeSchema } from "./envelopes";
import { dtsBuildInputsSchema, dtsDefinesSchema, dtsPreprocessingReceiptSchema } from "./dtsPreprocessing";

const id = z.string().uuid();
const changeDescription = z.string().trim().max(1000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u);
export const sharedDtsiImportLimits = { maxFiles: 128, maxFileBytes: 2_097_152, maxTotalBytes: 16_777_216, maxDepth: 16, maxArchiveBytes: 8_388_608 } as const;
const sourceName = z.string().min(1).max(240).refine(value =>
  /\.(dtsi|h|hpp)$/u.test(value) && value === value.trim() && !/[:\\\u0000-\u001f\u007f]/u.test(value)
  && !value.startsWith("/") && value.split("/").length <= sharedDtsiImportLimits.maxDepth && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
"请输入最多 16 层的资源内 .dtsi、.h 或 .hpp 相对路径。");
const content = z.string().max(2_097_152).refine(value => new TextEncoder().encode(value).length <= 2_097_152 && !value.includes("\0"), "源码不能包含空字符，且不能超过 2 MiB。");
const inputMember = z.object({ id: id.optional(), sourceName, content }).strict();
export const sharedDtsiDependencySchema = z.object({resourceId:id,versionId:id,mountPath:z.string().max(160).refine(value=>value==="" ||
  value===value.normalize("NFC") && !/[:\\\u0000-\u001f\u007f]/u.test(value) && value.split("/").length<=16 && value.split("/").every(part=>part!=="" && part!=="." && part!==".."),"挂载路径必须是资源内相对目录。")}).strict();
export const sharedDtsiClosureSchema = sharedDtsiDependencySchema.extend({name:z.string(),version:z.number().int().positive(),digest:z.string()});
export const sharedDtsiDraftInputSchema = z.object({
  name: z.string().trim().min(1, "请输入资源名称。").max(160).regex(/^[^\u0000-\u001f\u007f]+$/u, "资源名称不能包含控制字符。"), sourceName: sourceName.default("common.dtsi"),
  content: content.default(""),
  members: z.array(inputMember).min(1).max(128).optional(),
  buildInputs: dtsBuildInputsSchema.optional(),
  archive: z.object({name:z.string().max(240).regex(/\.zip$/u),contentBase64:z.string().max(11_184_812).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)}).strict().optional(),
  changeDescription: changeDescription.default(""),
  dependencies:z.array(sharedDtsiDependencySchema).max(32).optional()
}).strict();
export const sharedDtsiDraftUpdateSchema = sharedDtsiDraftInputSchema.extend({ expectedRevision: z.number().int().positive() }).strict();
export const sharedDtsiDraftDiscardSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const sharedDtsiDraftSchema = z.object({
  id, resourceId: id, name: z.string(), revision: z.number().int().positive(), updatedAt: z.string(), changeDescription: changeDescription.default(""),
  buildInputs: dtsBuildInputsSchema.optional(),
  members: z.array(z.object({ id, sourceName: z.string(), content: z.string() }).strict()).min(1),
  dependencies:z.array(sharedDtsiDependencySchema).max(32).optional()
}).strict();
export const sharedDtsiVersionSummarySchema = z.object({
  id, resourceId: id, version: z.number().int().positive(), name: z.string(), changeDescription,
  digest: z.string(), createdAt: z.string(), createdByUserId: z.string(), createdByName: z.string().optional()
}).strict();
export const sharedDtsiManifestSchema = z.object({
  schemaVersion: z.literal("shared-dtsi/v1"),
  members: z.array(z.object({ id, sourceName: z.string(), checksum: z.string(), sizeBytes: z.number().int().nonnegative(), role: z.enum(["include", "header"]) }).strict()).min(1),
  externalReferences: z.array(z.string()),
  dependencies:z.array(sharedDtsiDependencySchema).max(32).optional(),
  dependencyClosure:z.array(sharedDtsiClosureSchema).max(64).optional(),
  includeGraph: z.array(z.object({ sourceName: z.string(), target: z.string(), line: z.number().int().positive(), column: z.number().int().positive() }).strict()).default([]),
  buildInputs: z.object({ includeSearchPaths: z.array(z.string()), defines: dtsDefinesSchema.optional(), preprocessing: dtsPreprocessingReceiptSchema.optional() }).strict().default({ includeSearchPaths: [] })
}).strict();
export const sharedDtsiVersionSchema = sharedDtsiVersionSummarySchema.extend({ manifest: sharedDtsiManifestSchema,
  members: z.array(z.object({ id, sourceName: z.string(), content: z.string(), checksum: z.string(), sizeBytes: z.number().int().nonnegative() }).strict()).min(1) });
export const sharedDtsiResourceSummarySchema = z.object({ resourceId: id, name: z.string(), updatedAt: z.string(),
  sourceName: z.string(), draftRevision: z.number().int().positive().nullable(), currentVersion: sharedDtsiVersionSummarySchema.nullable() }).strict();
export const sharedDtsiResourceDetailSchema = sharedDtsiResourceSummarySchema.omit({ sourceName: true });
export const sharedDtsiVersionsSchema = z.object({items:z.array(sharedDtsiVersionSummarySchema),total:z.number().int().nonnegative()}).strict();
export const sharedDtsiUsagesSchema=z.object({items:z.array(z.object({projectId:z.string(),projectName:z.string(),configSetId:z.string(),configSetName:z.string(),versionId:id,version:z.number(),direct:z.boolean(),
  upgradeAvailable:z.boolean(),evaluation:z.literal("not-evaluated")}).strict()),total:z.number().int().nonnegative(),visibility:z.enum(["organization","authorized-projects"])}).strict();
const comparisonSource=z.object({sourceName:z.string(),content:z.string()}).strict();
export const sharedDtsiComparisonSchema=z.object({before:sharedDtsiVersionSummarySchema,after:sharedDtsiVersionSummarySchema,
  sources:z.array(z.object({resourceId:id,resourceName:z.string(),memberId:id,before:comparisonSource.nullable(),after:comparisonSource.nullable()}).strict()),
  dependencies:z.object({before:z.array(sharedDtsiClosureSchema),after:z.array(sharedDtsiClosureSchema)}).strict(),
  semantic:z.object({scope:z.literal("ordered-fragment-declarations"),before:z.string(),after:z.string(),externalReferences:z.array(z.string())}).strict()
}).strict();
export type SharedDtsiComparison=z.infer<typeof sharedDtsiComparisonSchema>;
export type SharedDtsiUsages=z.infer<typeof sharedDtsiUsagesSchema>;
export const sharedDtsiPreviewSchema = z.object({ id, resourceId: id, draftRevision: z.number().int().positive(), name: z.string(),
  changeDescription, manifest: sharedDtsiManifestSchema, digest: z.string(), createdAt: z.string(), baseVersionId: id.nullable() }).strict();
export const sharedDtsiPreviewRequestSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const sharedDtsiPublishRequestSchema = z.object({ previewId: id,
  idempotencyKey: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/u) }).strict();
export const sharedDtsiNewVersionDraftSchema = z.object({ baseVersionId: id }).strict();
export const sharedDtsiListSchema = z.object({ items: z.array(sharedDtsiResourceSummarySchema), total: z.number().int().nonnegative() }).strict();
export type SharedDtsiDraft = z.infer<typeof sharedDtsiDraftSchema>;
export type SharedDtsiDraftInput = z.infer<typeof sharedDtsiDraftInputSchema>;
export type SharedDtsiResourceSummary = z.infer<typeof sharedDtsiResourceSummarySchema>;
export type SharedDtsiResourceDetail = z.infer<typeof sharedDtsiResourceDetailSchema>;
export type SharedDtsiManifest = z.infer<typeof sharedDtsiManifestSchema>;
export type SharedDtsiVersionSummary = z.infer<typeof sharedDtsiVersionSummarySchema>;
export type SharedDtsiVersion = z.infer<typeof sharedDtsiVersionSchema>;
export type SharedDtsiPublicationPreview = z.infer<typeof sharedDtsiPreviewSchema>;

export const sharedDtsiDtoSchemaCatalog = {
  SharedDtsiDraftRequest: sharedDtsiDraftInputSchema,
  SharedDtsiDraftUpdateRequest: sharedDtsiDraftUpdateSchema,
  SharedDtsiDraftDiscardRequest: sharedDtsiDraftDiscardSchema,
  SharedDtsiDraftResponse: itemEnvelopeSchema(sharedDtsiDraftSchema),
  SharedDtsiListResponse: sharedDtsiListSchema,
  SharedDtsiDiscardResponse: okEnvelopeSchema,
  SharedDtsiDetailResponse: itemEnvelopeSchema(sharedDtsiResourceDetailSchema),
  SharedDtsiVersionResponse: itemEnvelopeSchema(sharedDtsiVersionSchema),
  SharedDtsiVersionsResponse: sharedDtsiVersionsSchema,
  SharedDtsiUsagesResponse:sharedDtsiUsagesSchema,
  SharedDtsiComparisonResponse:itemEnvelopeSchema(sharedDtsiComparisonSchema),
  SharedDtsiPreviewRequest: sharedDtsiPreviewRequestSchema,
  SharedDtsiPreviewResponse: itemEnvelopeSchema(sharedDtsiPreviewSchema),
  SharedDtsiPublishRequest: sharedDtsiPublishRequestSchema,
  SharedDtsiNewVersionDraftRequest: sharedDtsiNewVersionDraftSchema
};
export const sharedDtsiRoutes = [
  { id: "sharedDtsi.list", method: "GET", path: "/api/v2/shared-dtsi", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.create", method: "POST", path: "/api/v2/shared-dtsi", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.get", method: "GET", path: "/api/v2/shared-dtsi/:resourceId", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.save", method: "PUT", path: "/api/v2/shared-dtsi/:resourceId/draft", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.discard", method: "DELETE", path: "/api/v2/shared-dtsi/:resourceId/draft", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.detail", method: "GET", path: "/api/v2/shared-dtsi/:resourceId/detail", module: "parameter-files", stability: "commercial-readiness" },
  {id:"sharedDtsi.usages",method:"GET",path:"/api/v2/shared-dtsi/:resourceId/usages",module:"parameter-files",stability:"commercial-readiness"},
  {id:"sharedDtsi.comparison",method:"GET",path:"/api/v2/shared-dtsi/:resourceId/comparison",module:"parameter-files",stability:"commercial-readiness"},
  { id: "sharedDtsi.versions", method: "GET", path: "/api/v2/shared-dtsi/:resourceId/versions", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.version", method: "GET", path: "/api/v2/shared-dtsi/:resourceId/versions/:versionId", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.preview", method: "POST", path: "/api/v2/shared-dtsi/:resourceId/publication-preview", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.publish", method: "POST", path: "/api/v2/shared-dtsi/:resourceId/publications", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.newVersionDraft", method: "POST", path: "/api/v2/shared-dtsi/:resourceId/draft", module: "parameter-files", stability: "commercial-readiness" }
] as const;
const tags = ["parameter-files" as const];
export const sharedDtsiSchemaRegistry = {
  "sharedDtsi.list": { summary: "List Organization shared DTSI resources", tags, responseBody: "SharedDtsiListResponse",
    requestParameters: [{ name: "q", in: "query" as const }, { name: "offset", in: "query" as const }, { name: "limit", in: "query" as const }] },
  "sharedDtsi.create": { summary: "Create a shared DTSI resource draft", tags, requestBody: "SharedDtsiDraftRequest", responseBody: "SharedDtsiDraftResponse", successStatus: 201 as const },
  "sharedDtsi.get": { summary: "Read the current shared DTSI draft", tags, responseBody: "SharedDtsiDraftResponse" },
  "sharedDtsi.save": { summary: "Save a shared DTSI draft with revision comparison", tags, requestBody: "SharedDtsiDraftUpdateRequest", responseBody: "SharedDtsiDraftResponse" },
  "sharedDtsi.discard": { summary: "Discard a shared DTSI draft while retaining published history", tags, requestBody: "SharedDtsiDraftDiscardRequest", responseBody: "SharedDtsiDiscardResponse" },
  "sharedDtsi.detail": { summary: "Read shared resource state", tags, responseBody: "SharedDtsiDetailResponse" },
  "sharedDtsi.usages":{summary:"List authorized direct and indirect project references",tags,responseBody:"SharedDtsiUsagesResponse",
    requestParameters:[{name:"offset",in:"query" as const},{name:"limit",in:"query" as const}]},
  "sharedDtsi.comparison":{summary:"Compare exact immutable original source and ordered fragment declarations",tags,responseBody:"SharedDtsiComparisonResponse",
    requestParameters:[{name:"before",in:"query" as const},{name:"after",in:"query" as const}]},
  "sharedDtsi.versions": { summary: "List immutable source versions", tags, responseBody: "SharedDtsiVersionsResponse",
    requestParameters:[{name:"offset",in:"query" as const},{name:"limit",in:"query" as const}] },
  "sharedDtsi.version": { summary: "Read exact published source", tags, responseBody: "SharedDtsiVersionResponse" },
  "sharedDtsi.preview": { summary: "Freeze shared publication preview", tags, requestBody: "SharedDtsiPreviewRequest", responseBody: "SharedDtsiPreviewResponse", successStatus: 201 as const },
  "sharedDtsi.publish": { summary: "Publish an exact shared preview", tags, requestBody: "SharedDtsiPublishRequest", responseBody: "SharedDtsiVersionResponse", successStatus: 201 as const },
  "sharedDtsi.newVersionDraft": { summary: "Create a draft from the current shared version", tags, requestBody: "SharedDtsiNewVersionDraftRequest", responseBody: "SharedDtsiDraftResponse", successStatus: 201 as const }
};
