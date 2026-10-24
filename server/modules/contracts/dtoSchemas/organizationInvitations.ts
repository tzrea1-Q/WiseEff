import { z } from "zod";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";
import { projectMemberRoleSchema } from "./projectMembers";

const roleSchema = z.enum(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin", "platform-admin"]);
const targetId = z.string().trim().min(1).max(200);
const projectPresetSchema = z.object({ projectId: targetId, roles: z.array(projectMemberRoleSchema).min(1).max(4).transform((roles) => [...new Set(roles)].sort()) }).strict();
export const invitationInputSchema = z.object({ label: z.string().trim().min(1).max(120), roles: z.array(roleSchema).min(1).max(7).transform((roles) => [...new Set(roles)].sort()), expiresInDays: z.number().int().min(1).max(30),
  teamIds: z.array(targetId).max(500).transform((ids) => [...new Set(ids)].sort()).default([]),
  projects: z.array(projectPresetSchema).max(500).refine((items) => new Set(items.map((item) => item.projectId)).size === items.length, "项目不能重复。" ).default([])
}).strict();
export const invitationTokenSchema = z.object({ token: z.string().min(32).max(200) }).strict();
export const invitationAcceptSchema = z.object({ name: z.string().trim().min(1).max(120), username: z.string().trim().toLowerCase().min(3).max(64), password: z.string().min(8).max(1024), title: z.string().trim().max(120).optional() }).strict();
export const acceptInvitationRequestSchema = invitationAcceptSchema.extend({ token: invitationTokenSchema.shape.token });
const invitationSchema = z.object({ id: z.string(), organizationId: z.string(), label: z.string(), roles: z.array(roleSchema), status: z.enum(["pending", "expired", "revoked", "accepted"]), expiresAt: z.string(), createdAt: z.string(), acceptedUserId: z.string().nullable(),
  teams: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  projects: z.array(projectPresetSchema.extend({ name: z.string() }))
}).strict();
export const organizationInvitationDtoSchemaCatalog = {
  OrganizationInvitationRequest: invitationInputSchema,
  OrganizationInvitationTokenRequest: invitationTokenSchema,
  OrganizationInvitationAcceptRequest: acceptInvitationRequestSchema,
  OrganizationInvitationResponse: itemEnvelopeSchema(invitationSchema),
  OrganizationInvitationListResponse: itemsEnvelopeSchema(invitationSchema),
  OrganizationInvitationIssuedResponse: z.object({ item: invitationSchema, token: z.string() }).strict(),
  OrganizationInvitationPreviewResponse: itemEnvelopeSchema(invitationSchema.extend({ organizationName: z.string() })),
  OrganizationInvitationAcceptedResponse: z.object({ userId: z.string(), organizationId: z.string() }).strict()
};
export const organizationInvitationRoutes = [
  { id: "users.invitations.list", method: "GET", path: "/api/v1/organization/invitations", module: "users", stability: "commercial-readiness" },
  { id: "users.invitations.issue", method: "POST", path: "/api/v1/organization/invitations", module: "users", stability: "commercial-readiness" },
  { id: "users.invitations.regenerate", method: "POST", path: "/api/v1/organization/invitations/:invitationId/regenerate", module: "users", stability: "commercial-readiness" },
  { id: "users.invitations.revoke", method: "POST", path: "/api/v1/organization/invitations/:invitationId/revoke", module: "users", stability: "commercial-readiness" },
  { id: "auth.invitations.preview", method: "POST", path: "/api/v1/auth/invitations/preview", module: "auth", stability: "commercial-readiness" },
  { id: "auth.invitations.accept", method: "POST", path: "/api/v1/auth/invitations/accept", module: "auth", stability: "commercial-readiness" }
] as const;
const failures = { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" };
const scope = [{ name: "organizationId", in: "query" as const }];
export const organizationInvitationSchemaRegistry = {
  "users.invitations.list": { summary: "List invitations in the explicit Organization", tags: ["users" as const], responseBody: "OrganizationInvitationListResponse", requestParameters: scope, additionalResponses: failures },
  "users.invitations.issue": { summary: "Issue a one-time local account invitation", tags: ["users" as const], requestBody: "OrganizationInvitationRequest", responseBody: "OrganizationInvitationIssuedResponse", successStatus: 201 as const, requestParameters: scope, additionalResponses: failures },
  "users.invitations.regenerate": { summary: "Replace invitation content and immediately invalidate the former link", tags: ["users" as const], requestBody: "OrganizationInvitationRequest", responseBody: "OrganizationInvitationIssuedResponse", requestParameters: scope, additionalResponses: failures },
  "users.invitations.revoke": { summary: "Revoke an unused invitation", tags: ["users" as const], responseBody: "OrganizationInvitationResponse", requestParameters: scope, additionalResponses: failures },
  "auth.invitations.preview": { summary: "Inspect a one-time local invitation without authentication", tags: ["auth" as const], requestBody: "OrganizationInvitationTokenRequest", responseBody: "OrganizationInvitationPreviewResponse", additionalResponses: failures },
  "auth.invitations.accept": { summary: "Atomically consume an invitation and create an active local account", tags: ["auth" as const], requestBody: "OrganizationInvitationAcceptRequest", responseBody: "OrganizationInvitationAcceptedResponse", successStatus: 201 as const, additionalResponses: { ...failures, "429": "ErrorResponse" } }
};
