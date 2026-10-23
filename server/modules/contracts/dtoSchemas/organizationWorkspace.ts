import { z } from "zod";
import type { ContractSchemaRef } from "../schemaRegistry";

export const organizationWorkspaceSummarySchema = z.object({
  organization: z.object({ id: z.string(), name: z.string(), status: z.enum(["active", "suspended"]) }).strict(),
  counts: z.object({ members: z.number().int().nonnegative(), teams: z.number().int().nonnegative(), projects: z.number().int().nonnegative() }).strict(),
  administration: z.object({ pendingInvitations: z.number().int().nonnegative().nullable(), pendingHandovers: z.number().int().nonnegative(), pendingIdentitySync: z.number().int().nonnegative() }).strict().nullable()
}).strict();
export type OrganizationWorkspaceSummary = z.infer<typeof organizationWorkspaceSummarySchema>;
export const organizationWorkspaceDtoSchemaCatalog = { OrganizationWorkspaceSummaryResponse: z.object({ item: organizationWorkspaceSummarySchema }).strict() };
export const organizationWorkspaceRoutes = [{ id: "organization.workspaceSummary", method: "GET", path: "/api/v1/organization/workspace-summary", module: "users", stability: "commercial-readiness" }] as const;
export const organizationWorkspaceSchemaRegistry = {
  "organization.workspaceSummary": { summary: "Read operating organization counts and authorized administrative pending work", tags: ["users"], responseBody: "OrganizationWorkspaceSummaryResponse" }
} satisfies Record<string, ContractSchemaRef>;
