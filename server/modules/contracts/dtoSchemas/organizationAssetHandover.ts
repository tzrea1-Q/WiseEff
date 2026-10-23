import { z } from "zod";
import { knowledgeHandoverBodySchema } from "../../knowledge/schemas";
import { feedbackHandoverBodySchema } from "../../product-feedback/schemas";
import { okEnvelopeSchema } from "./envelopes";

const item = z.object({ id: z.string().uuid(), title: z.string(), responsibleUserId: z.string().nullable(), responsibleUserName: z.string().nullable(), pending: z.boolean() });
const candidate = z.object({ id: z.string(), name: z.string() });
export const assetHandoverDtoSchemaCatalog = {
  KnowledgeHandoverRequest: knowledgeHandoverBodySchema,
  FeedbackHandoverRequest: feedbackHandoverBodySchema,
  KnowledgeHandoverResponse: z.object({ items: z.array(item.extend({ kind: z.enum(["entry", "import"]), createdByUserId: z.string().nullable() })), candidates: z.array(candidate) }),
  FeedbackHandoverResponse: z.object({ items: z.array(item.extend({ kind: z.enum(["feedback-draft", "feedback-work"]) })), candidates: z.array(candidate.extend({ canTriage: z.boolean() })) }),
  AssetHandoverSavedResponse: okEnvelopeSchema
};
export const assetHandoverRoutes = [
  { id: "knowledge.listHandovers", method: "GET", path: "/api/v1/knowledge/handovers", module: "knowledge", stability: "commercial-readiness" },
  { id: "knowledge.assignResponsibility", method: "PATCH", path: "/api/v1/knowledge/handovers/:kind/:id", module: "knowledge", stability: "commercial-readiness" },
  { id: "productFeedback.listHandovers", method: "GET", path: "/api/v1/product-feedback/handovers", module: "product-feedback", stability: "commercial-readiness" },
  { id: "productFeedback.assignResponsibility", method: "PATCH", path: "/api/v1/product-feedback/handovers/:id", module: "product-feedback", stability: "commercial-readiness" }
] as const;
const failures = { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" };
export const assetHandoverSchemaRegistry = {
  "knowledge.listHandovers": { summary: "List organization knowledge drafts, incomplete imports and eligible successors", tags: ["knowledge" as const], responseBody: "KnowledgeHandoverResponse", additionalResponses: failures },
  "knowledge.assignResponsibility": { summary: "Assign current responsibility without changing authorship or publishing", tags: ["knowledge" as const], requestBody: "KnowledgeHandoverRequest", responseBody: "AssetHandoverSavedResponse", additionalResponses: failures },
  "productFeedback.listHandovers": { summary: "List unfinished feedback drafts and open triage responsibilities", tags: ["product-feedback" as const], responseBody: "FeedbackHandoverResponse", additionalResponses: failures },
  "productFeedback.assignResponsibility": { summary: "Assign feedback draft custody or qualified triage responsibility without submitting", tags: ["product-feedback" as const], requestBody: "FeedbackHandoverRequest", responseBody: "AssetHandoverSavedResponse", additionalResponses: failures }
};
