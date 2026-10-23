import { z } from "zod";
import { itemEnvelopeSchema } from "./envelopes";

export const organizationDeletionPreviewSchema = z.object({
  organizationId: z.string(), organizationName: z.string(), status: z.string(), generatedAt: z.string(), stateDigest: z.string(),
  inventory: z.array(z.object({ key: z.string(), category: z.string(), count: z.number().int().nonnegative() }).strict()),
  platformAccounts: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), canLogin: z.boolean() }).strict()),
  survivingPlatformAdministrators: z.number().int().nonnegative(),
  experienceRegistration: z.object({ isTarget: z.boolean(), enabled: z.boolean() }).strict(),
  producers: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int().nonnegative() }).strict()),
  storage: z.object({ exclusiveObjects: z.number().int().nonnegative(), sharedObjects: z.number().int().nonnegative() }).strict(),
  blockers: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  admissionAvailable: z.boolean(), notes: z.array(z.string())
}).strict();

export const organizationDeletionDtoSchemaCatalog = { OrganizationDeletionPreviewResponse: itemEnvelopeSchema(organizationDeletionPreviewSchema) };
export const organizationDeletionRoutes = [
  { id: "platformOrganizations.deletionPreview", method: "GET", path: "/api/v1/platform/organizations/:organizationId/deletion-preview", module: "users", stability: "commercial-readiness" }
] as const;
export const organizationDeletionSchemaRegistry = {
  "platformOrganizations.deletionPreview": { summary: "Read Organization erasure impact without granting or executing deletion", tags: ["users" as const], responseBody: "OrganizationDeletionPreviewResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } }
};
