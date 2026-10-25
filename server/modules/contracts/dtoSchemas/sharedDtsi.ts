import { z } from "zod";
import { itemEnvelopeSchema, okEnvelopeSchema } from "./envelopes";

const id = z.string().uuid();
const sourceName = z.string().min(1).max(240).refine(value =>
  value.endsWith(".dtsi") && value === value.trim() && !/[:\\\u0000-\u001f\u007f]/u.test(value)
  && !value.startsWith("/") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
"请输入项目内的 .dtsi 相对路径。");
export const sharedDtsiDraftInputSchema = z.object({
  name: z.string().trim().min(1, "请输入资源名称。").max(160).regex(/^[^\u0000-\u001f\u007f]+$/u, "资源名称不能包含控制字符。"), sourceName,
  content: z.string().max(2_097_152).refine(value => new TextEncoder().encode(value).length <= 2_097_152 && !value.includes("\0"), "源码不能包含空字符，且不能超过 2 MiB。")
}).strict();
export const sharedDtsiDraftUpdateSchema = sharedDtsiDraftInputSchema.extend({ expectedRevision: z.number().int().positive() }).strict();
export const sharedDtsiDraftDiscardSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const sharedDtsiDraftSchema = z.object({
  id, resourceId: id, name: z.string(), revision: z.number().int().positive(), updatedAt: z.string(),
  members: z.array(z.object({ id, sourceName: z.string(), content: z.string() }).strict()).min(1)
}).strict();
export const sharedDtsiResourceSummarySchema = sharedDtsiDraftSchema.omit({ members: true }).extend({ sourceName: z.string() });
export const sharedDtsiListSchema = z.object({ items: z.array(sharedDtsiResourceSummarySchema), total: z.number().int().nonnegative() }).strict();
export type SharedDtsiDraft = z.infer<typeof sharedDtsiDraftSchema>;
export type SharedDtsiDraftInput = z.infer<typeof sharedDtsiDraftInputSchema>;
export type SharedDtsiResourceSummary = z.infer<typeof sharedDtsiResourceSummarySchema>;

export const sharedDtsiDtoSchemaCatalog = {
  SharedDtsiDraftRequest: sharedDtsiDraftInputSchema,
  SharedDtsiDraftUpdateRequest: sharedDtsiDraftUpdateSchema,
  SharedDtsiDraftDiscardRequest: sharedDtsiDraftDiscardSchema,
  SharedDtsiDraftResponse: itemEnvelopeSchema(sharedDtsiDraftSchema),
  SharedDtsiListResponse: sharedDtsiListSchema,
  SharedDtsiDiscardResponse: okEnvelopeSchema
};
export const sharedDtsiRoutes = [
  { id: "sharedDtsi.list", method: "GET", path: "/api/v2/shared-dtsi", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.create", method: "POST", path: "/api/v2/shared-dtsi", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.get", method: "GET", path: "/api/v2/shared-dtsi/:resourceId", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.save", method: "PUT", path: "/api/v2/shared-dtsi/:resourceId/draft", module: "parameter-files", stability: "commercial-readiness" },
  { id: "sharedDtsi.discard", method: "DELETE", path: "/api/v2/shared-dtsi/:resourceId/draft", module: "parameter-files", stability: "commercial-readiness" }
] as const;
const tags = ["parameter-files" as const];
export const sharedDtsiSchemaRegistry = {
  "sharedDtsi.list": { summary: "List Organization shared DTSI resources", tags, responseBody: "SharedDtsiListResponse",
    requestParameters: [{ name: "q", in: "query" as const }, { name: "offset", in: "query" as const }, { name: "limit", in: "query" as const }] },
  "sharedDtsi.create": { summary: "Create a shared DTSI resource draft", tags, requestBody: "SharedDtsiDraftRequest", responseBody: "SharedDtsiDraftResponse", successStatus: 201 as const },
  "sharedDtsi.get": { summary: "Read the current shared DTSI draft", tags, responseBody: "SharedDtsiDraftResponse" },
  "sharedDtsi.save": { summary: "Save a shared DTSI draft with revision comparison", tags, requestBody: "SharedDtsiDraftUpdateRequest", responseBody: "SharedDtsiDraftResponse" },
  "sharedDtsi.discard": { summary: "Discard a never-published shared DTSI draft", tags, requestBody: "SharedDtsiDraftDiscardRequest", responseBody: "SharedDtsiDiscardResponse" }
};
