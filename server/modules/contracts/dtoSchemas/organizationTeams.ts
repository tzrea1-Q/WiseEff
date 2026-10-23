import { z } from "zod";
import type { ContractSchemaRef } from "../schemaRegistry";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

const team = z.object({ id: z.string().min(1), organizationId: z.string().min(1), name: z.string().min(1), memberIds: z.array(z.string().min(1)) }).strict();
export const organizationTeamDtoSchemaCatalog = {
  OrganizationTeamNameRequest: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  OrganizationTeamMembersRequest: z.object({ userIds: z.array(z.string().trim().min(1).max(200)) }).strict(),
  OrganizationTeamResponse: itemEnvelopeSchema(team),
  OrganizationTeamListResponse: itemsEnvelopeSchema(team),
  OrganizationTeamDeletedResponse: z.null()
};

export const organizationTeamRoutes = [
  { id: "organization.teams.list", method: "GET", path: "/api/v1/organization/teams", module: "users", stability: "commercial-readiness" },
  { id: "organization.teams.create", method: "POST", path: "/api/v1/organization/teams", module: "users", stability: "commercial-readiness" },
  { id: "organization.teams.rename", method: "PATCH", path: "/api/v1/organization/teams/:teamId", module: "users", stability: "commercial-readiness" },
  { id: "organization.teams.replaceMembers", method: "PUT", path: "/api/v1/organization/teams/:teamId/members", module: "users", stability: "commercial-readiness" },
  { id: "organization.teams.delete", method: "DELETE", path: "/api/v1/organization/teams/:teamId", module: "users", stability: "commercial-readiness" }
] as const;

export const organizationTeamSchemaRegistry = {
  "organization.teams.list": { summary: "List teams and member grouping in the operating organization", tags: ["users"], responseBody: "OrganizationTeamListResponse" },
  "organization.teams.create": { summary: "Create a flat organization team", tags: ["users"], requestBody: "OrganizationTeamNameRequest", responseBody: "OrganizationTeamResponse", successStatus: 201, additionalResponses: { "409": "ErrorResponse" } },
  "organization.teams.rename": { summary: "Rename a team without changing its members or permissions", tags: ["users"], requestBody: "OrganizationTeamNameRequest", responseBody: "OrganizationTeamResponse", additionalResponses: { "409": "ErrorResponse" } },
  "organization.teams.replaceMembers": { summary: "Replace team membership without granting project permissions", tags: ["users"], requestBody: "OrganizationTeamMembersRequest", responseBody: "OrganizationTeamResponse" },
  "organization.teams.delete": { summary: "Remove a team grouping while retaining accounts and project permissions", tags: ["users"], responseBody: "OrganizationTeamDeletedResponse", successStatus: 204 }
} satisfies Record<string, ContractSchemaRef>;
