import { z } from "zod";
import { oidcProvisionUserFieldsSchema } from "./oidcMembers";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

export const createPlatformOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initialAdministrator: z.union([
    z.object({ name: z.string().trim().min(1), username: z.string().trim().min(3).max(64), password: z.string().min(8), title: z.string().optional() }).strict(),
    oidcProvisionUserFieldsSchema
  ])
}).strict();
export const platformOrganizationSchema = z.object({
  id: z.string(), name: z.string(), createdAt: z.string(), status: z.literal("active"),
  administrators: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean() }).strict())
}).strict();
export const platformOrganizationDtoSchemaCatalog = {
  CreatePlatformOrganizationRequest: createPlatformOrganizationSchema,
  PlatformOrganizationResponse: itemEnvelopeSchema(platformOrganizationSchema),
  PlatformOrganizationListResponse: itemsEnvelopeSchema(platformOrganizationSchema)
};
export const platformOrganizationRoutes = [
  { id: "platformOrganizations.list", method: "GET", path: "/api/v1/platform/organizations", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.create", method: "POST", path: "/api/v1/platform/organizations", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.get", method: "GET", path: "/api/v1/platform/organizations/:organizationId", module: "users", stability: "commercial-readiness" }
] as const;
export const platformOrganizationSchemaRegistry = {
  "platformOrganizations.list": { summary: "Search the platform Organization directory", tags: ["users" as const], responseBody: "PlatformOrganizationListResponse", requestParameters: [{ name: "q", in: "query" as const }], additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse" } },
  "platformOrganizations.create": { summary: "Atomically establish an Organization and initial administrator", tags: ["users" as const], requestBody: "CreatePlatformOrganizationRequest", responseBody: "PlatformOrganizationResponse", successStatus: 201 as const, additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse" } },
  "platformOrganizations.get": { summary: "Read an Organization in the platform directory", tags: ["users" as const], responseBody: "PlatformOrganizationResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } }
};
