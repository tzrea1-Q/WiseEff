import { z } from "zod";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

export const startOrganizationErasureSchema = z.object({ stateDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmationOrganizationId: z.string().min(1).max(200) }).strict();
export const organizationErasureDomainSchema = z.enum(["projects-parameters", "knowledge", "logs", "agent-devices-feedback"]);
const domainProgressSchema = z.object({ status: z.enum(["pending", "running", "failed", "complete"]), attempts: z.number().int().nonnegative(), errorCode: z.string().nullable() }).strict();
export const organizationErasureSchema = z.object({
  id: z.string(), targetOrganizationId: z.string(), actorUserId: z.string(),
  status: z.enum(["queued", "running", "failed", "deleted"]), stage: z.enum(["domains", "management", "finalize", "complete"]),
  counts: z.record(z.string(), z.number().int().nonnegative()), attempts: z.number().int().nonnegative(), errorCode: z.string().nullable(),
  domains: z.record(organizationErasureDomainSchema, domainProgressSchema).default({}),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable()
}).strict();

export const organizationDeletionPreviewSchema = z.object({
  organizationId: z.string(), organizationName: z.string(), status: z.string(), generatedAt: z.string(), stateDigest: z.string(),
  inventory: z.array(z.object({ key: z.string(), category: z.string(), count: z.number().int().nonnegative() }).strict()),
  platformAccounts: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), canLogin: z.boolean() }).strict()),
  survivingPlatformAdministrators: z.number().int().nonnegative(),
  experienceRegistration: z.object({ isTarget: z.boolean(), enabled: z.boolean() }).strict(),
  producers: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int().nonnegative() }).strict()),
  storage: z.object({ exclusiveObjects: z.number().int().nonnegative(), sharedObjects: z.number().int().nonnegative() }).strict(),
  blockers: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  admissionAvailable: z.boolean(), executionAvailable: z.boolean().optional(), notes: z.array(z.string())
}).strict();

export const organizationDeletionDtoSchemaCatalog = {
  OrganizationDeletionPreviewResponse: itemEnvelopeSchema(organizationDeletionPreviewSchema), StartOrganizationErasureRequest: startOrganizationErasureSchema,
  OrganizationErasureResponse: itemEnvelopeSchema(organizationErasureSchema), OrganizationErasureListResponse: itemsEnvelopeSchema(organizationErasureSchema)
};
export const organizationDeletionRoutes = [
  { id: "organizationErasures.list", method: "GET", path: "/api/v1/platform/organization-deletions", module: "users", stability: "commercial-readiness" },
  { id: "organizationErasures.get", method: "GET", path: "/api/v1/platform/organization-deletions/:erasureId", module: "users", stability: "commercial-readiness" },
  { id: "organizationErasures.retry", method: "POST", path: "/api/v1/platform/organization-deletions/:erasureId/retry", module: "users", stability: "commercial-readiness" },
  { id: "organizationErasures.start", method: "POST", path: "/api/v1/platform/organizations/:organizationId/deletions", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.deletionPreview", method: "GET", path: "/api/v1/platform/organizations/:organizationId/deletion-preview", module: "users", stability: "commercial-readiness" }
] as const;
export const organizationDeletionSchemaRegistry = {
  "organizationErasures.list": { summary: "List independent Organization cleanup progress and minimal receipts", tags: ["users" as const], responseBody: "OrganizationErasureListResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse" } },
  "organizationErasures.get": { summary: "Read durable cleanup after the target Organization and accounts are removed", tags: ["users" as const], responseBody: "OrganizationErasureResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } },
  "organizationErasures.retry": { summary: "Resume admitted Organization cleanup with fresh platform authority", tags: ["users" as const], responseBody: "OrganizationErasureResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "organizationErasures.start": { summary: "Admit and permanently erase an Organization with supported inventory", tags: ["users" as const], requestBody: "StartOrganizationErasureRequest", responseBody: "OrganizationErasureResponse", successStatus: 202 as const, additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "platformOrganizations.deletionPreview": { summary: "Read Organization erasure impact without granting or executing deletion", tags: ["users" as const], responseBody: "OrganizationDeletionPreviewResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } }
};
