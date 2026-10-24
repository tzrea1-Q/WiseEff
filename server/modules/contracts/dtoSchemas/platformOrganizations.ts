import { z } from "zod";
import { oidcProvisionUserFieldsSchema } from "./oidcMembers";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

export const updateExperienceRegistrationSchema = z.object({ enabled: z.boolean(), organizationId: z.string().trim().min(1).nullable() }).strict();
export const experienceRegistrationSchema = updateExperienceRegistrationSchema.extend({
  organizationName: z.string().nullable(), source: z.enum(["platform", "environment", "default"]), available: z.boolean()
}).strict();

export const createPlatformOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initialAdministrator: z.union([
    z.object({ name: z.string().trim().min(1), username: z.string().trim().min(3).max(64), password: z.string().min(8), title: z.string().optional() }).strict(),
    oidcProvisionUserFieldsSchema
  ])
}).strict();
export const platformOrganizationSchema = z.object({
  id: z.string(), name: z.string(), createdAt: z.string(), status: z.enum(["active", "suspended", "deleting"]),
  administrators: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), canLogin: z.boolean() }).strict())
}).strict();
export const recoverOrganizationAdministratorSchema = z.union([
  z.object({ userId: z.string().min(1) }).strict(),
  z.object({ administrator: createPlatformOrganizationSchema.shape.initialAdministrator }).strict()
]);
export const emergencyDisableAdministratorSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
export const changeOrganizationLifecycleSchema = z.object({ status: z.enum(["active", "suspended"]), expectedStatus: z.enum(["active", "suspended"]) }).strict();
export const administratorRecoverySchema = z.object({
  members: z.array(z.object({ id: z.string(), name: z.string(), isActive: z.boolean() }).strict()),
  usableAdministratorIds: z.array(z.string())
}).strict();
export const platformOrganizationDtoSchemaCatalog = {
  UpdateExperienceRegistrationRequest: updateExperienceRegistrationSchema,
  ExperienceRegistrationResponse: itemEnvelopeSchema(experienceRegistrationSchema),
  CreatePlatformOrganizationRequest: createPlatformOrganizationSchema,
  RecoverOrganizationAdministratorRequest: recoverOrganizationAdministratorSchema,
  EmergencyDisableAdministratorRequest: emergencyDisableAdministratorSchema,
  ChangeOrganizationLifecycleRequest: changeOrganizationLifecycleSchema,
  AdministratorRecoveryResponse: administratorRecoverySchema,
  PlatformOrganizationResponse: itemEnvelopeSchema(platformOrganizationSchema),
  PlatformOrganizationListResponse: itemsEnvelopeSchema(platformOrganizationSchema)
};
export const platformOrganizationRoutes = [
  { id: "platformOrganizations.lifecycle", method: "PATCH", path: "/api/v1/platform/organizations/:organizationId/lifecycle", module: "users", stability: "commercial-readiness" },
  { id: "experienceRegistration.get", method: "GET", path: "/api/v1/platform/experience-registration", module: "auth", stability: "commercial-readiness" },
  { id: "experienceRegistration.update", method: "PATCH", path: "/api/v1/platform/experience-registration", module: "auth", stability: "commercial-readiness" },
  { id: "platformOrganizations.administratorRecovery", method: "GET", path: "/api/v1/platform/organizations/:organizationId/administrator-recovery", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.recoverAdministrator", method: "POST", path: "/api/v1/platform/organizations/:organizationId/administrator-recovery", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.emergencyDisableAdministrator", method: "POST", path: "/api/v1/platform/organizations/:organizationId/administrators/:userId/emergency-disable", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.list", method: "GET", path: "/api/v1/platform/organizations", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.create", method: "POST", path: "/api/v1/platform/organizations", module: "users", stability: "commercial-readiness" },
  { id: "platformOrganizations.get", method: "GET", path: "/api/v1/platform/organizations/:organizationId", module: "users", stability: "commercial-readiness" }
] as const;
export const platformOrganizationSchemaRegistry = {
  "platformOrganizations.lifecycle": { summary: "Suspend or restore Organization business without reactivating personal access", tags: ["users" as const], requestBody: "ChangeOrganizationLifecycleRequest", responseBody: "PlatformOrganizationResponse", additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "experienceRegistration.get": { summary: "Read the effective public experience registration switch and target", tags: ["users" as const], responseBody: "ExperienceRegistrationResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse" } },
  "experienceRegistration.update": { summary: "Configure public admission into one explicit experience Organization", tags: ["users" as const], requestBody: "UpdateExperienceRegistrationRequest", responseBody: "ExperienceRegistrationResponse", additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse" } },
  "platformOrganizations.administratorRecovery": { summary: "List members and effective administrators for Organization recovery", tags: ["users" as const], responseBody: "AdministratorRecoveryResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } },
  "platformOrganizations.recoverAdministrator": { summary: "Restore Organization administration with an existing or newly provisioned member", tags: ["users" as const], requestBody: "RecoverOrganizationAdministratorRequest", responseBody: "PlatformOrganizationResponse", additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "platformOrganizations.emergencyDisableAdministrator": { summary: "Explicitly disable an Organization administrator while retaining the platform management entry", tags: ["users" as const], requestBody: "EmergencyDisableAdministratorRequest", responseBody: "PlatformOrganizationResponse", additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" } },
  "platformOrganizations.list": { summary: "Search the platform Organization directory", tags: ["users" as const], responseBody: "PlatformOrganizationListResponse", requestParameters: [{ name: "q", in: "query" as const }], additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse" } },
  "platformOrganizations.create": { summary: "Atomically establish an Organization and initial administrator", tags: ["users" as const], requestBody: "CreatePlatformOrganizationRequest", responseBody: "PlatformOrganizationResponse", successStatus: 201 as const, additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse" } },
  "platformOrganizations.get": { summary: "Read an Organization in the platform directory", tags: ["users" as const], responseBody: "PlatformOrganizationResponse", additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" } }
};
