import { z } from "zod";
import { knowledgeHandoverBodySchema } from "../../knowledge/schemas";
import { feedbackHandoverBodySchema } from "../../product-feedback/schemas";
import { okEnvelopeSchema } from "./envelopes";

export const projectHandoverKinds = ["parameter-draft", "value-draft", "source-draft", "initialization-draft", "hardware-review", "software-review", "software-merge", "value-review"] as const;
export const projectHandoverParamsSchema = z.object({ kind: z.enum(projectHandoverKinds), id: z.string().min(1) });
export const projectHandoverBodySchema = z.object({ responsibleUserId: z.string().min(1).nullable(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

const item = z.object({ id: z.string().uuid(), title: z.string(), responsibleUserId: z.string().nullable(), responsibleUserName: z.string().nullable(), pending: z.boolean() });
const candidate = z.object({ id: z.string(), name: z.string() });
export const assetHandoverDtoSchemaCatalog = {
  KnowledgeHandoverRequest: knowledgeHandoverBodySchema,
  FeedbackHandoverRequest: feedbackHandoverBodySchema,
  ProjectHandoverRequest: projectHandoverBodySchema,
  ProjectHandoverResponse: z.object({ items: z.array(item.extend({ id: z.string(), kind: z.enum(projectHandoverKinds), projectId: z.string(), projectName: z.string(), updatedAt: z.string(), version: z.string(), historicalAttribution: z.unknown(), submitterUserId: z.string().nullable(), requestKind: z.string().nullable(), proofDigest: z.string().nullable(), candidates: z.array(candidate) })) }),
  KnowledgeHandoverResponse: z.object({ items: z.array(item.extend({ kind: z.enum(["entry", "import"]), createdByUserId: z.string().nullable() })), candidates: z.array(candidate) }),
  FeedbackHandoverResponse: z.object({ items: z.array(item.extend({ kind: z.enum(["feedback-draft", "feedback-work"]) })), candidates: z.array(candidate.extend({ canTriage: z.boolean() })) }),
  AssetHandoverSavedResponse: okEnvelopeSchema
};
export const assetHandoverRoutes = [
  { id: "parameters.listProjectHandovers", method: "GET", path: "/api/v1/organization/project-handovers", module: "parameters", stability: "commercial-readiness" },
  { id: "parameters.assignProjectHandover", method: "PATCH", path: "/api/v1/organization/project-handovers/:kind/:id", module: "parameters", stability: "commercial-readiness" },
  { id: "knowledge.listHandovers", method: "GET", path: "/api/v1/knowledge/handovers", module: "knowledge", stability: "commercial-readiness" },
  { id: "knowledge.assignResponsibility", method: "PATCH", path: "/api/v1/knowledge/handovers/:kind/:id", module: "knowledge", stability: "commercial-readiness" },
  { id: "productFeedback.listHandovers", method: "GET", path: "/api/v1/product-feedback/handovers", module: "product-feedback", stability: "commercial-readiness" },
  { id: "productFeedback.assignResponsibility", method: "PATCH", path: "/api/v1/product-feedback/handovers/:id", module: "product-feedback", stability: "commercial-readiness" }
] as const;
const failures = { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" };
export const assetHandoverSchemaRegistry = {
  "parameters.listProjectHandovers": { summary: "List retained project drafts and review duties with current eligible successors", tags: ["parameters" as const], responseBody: "ProjectHandoverResponse", additionalResponses: failures },
  "parameters.assignProjectHandover": { summary: "Explicitly hand over current project work without granting roles or changing historical authors", tags: ["parameters" as const], requestBody: "ProjectHandoverRequest", responseBody: "AssetHandoverSavedResponse", additionalResponses: failures },
  "knowledge.listHandovers": { summary: "List organization knowledge drafts, incomplete imports and eligible successors", tags: ["knowledge" as const], responseBody: "KnowledgeHandoverResponse", additionalResponses: failures },
  "knowledge.assignResponsibility": { summary: "Assign current responsibility without changing authorship or publishing", tags: ["knowledge" as const], requestBody: "KnowledgeHandoverRequest", responseBody: "AssetHandoverSavedResponse", additionalResponses: failures },
  "productFeedback.listHandovers": { summary: "List unfinished feedback drafts and open triage responsibilities", tags: ["product-feedback" as const], responseBody: "FeedbackHandoverResponse", additionalResponses: failures },
  "productFeedback.assignResponsibility": { summary: "Assign feedback draft custody or qualified triage responsibility without submitting", tags: ["product-feedback" as const], requestBody: "FeedbackHandoverRequest", responseBody: "AssetHandoverSavedResponse", additionalResponses: failures }
};
