import { z } from "zod";
import type { ContractSchemaRef } from "../schemaRegistry";
const id = z.string().trim().min(1).max(200);
export const accountTransferTargetSchema = z.object({ targetOrganizationId: id }).strict();
export const accountTransferRequestSchema = accountTransferTargetSchema.extend({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  targetRoles: z.array(z.enum(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"])).min(1).max(6) }).strict();
export const accountTransferPreviewSchema = z.object({
  user: z.object({ id, name: z.string(), username: z.string().nullable(), isActive: z.boolean() }),
  source: z.object({ id, name: z.string() }), target: z.object({ id, name: z.string() }),
  version: z.string(), supported: z.boolean(), unavailableReason: z.string().nullable(), platformAdministrator: z.boolean(),
  roles: z.array(z.object({ roleId: z.string(), projectId: z.string().nullable() })),
  teams: z.array(z.object({ id, name: z.string() })),
  projectMemberships: z.array(z.object({ projectId: id, name: z.string(), roles: z.array(z.string()) })),
  personalAccess: z.object({ sessions: z.number(), pairings: z.number(), pairingCodes: z.number() }),
  retainedWork: z.object({ project: z.number(), knowledge: z.number(), feedback: z.number() })
}).strict();
export const accountTransferDtoSchemaCatalog = {
  AccountTransferTargetRequest: accountTransferTargetSchema, AccountTransferRequest: accountTransferRequestSchema,
  AccountTransferPreviewResponse: z.object({ item: accountTransferPreviewSchema }).strict(),
  AccountTransferResponse: z.object({ item: z.object({ userId: id, organizationId: id, isActive: z.boolean() }) }).strict()
};
export const accountTransferRoutes = [
  { id: "platform.organizations.previewAccountTransfer", method: "POST", path: "/api/v1/platform/organizations/:organizationId/members/:userId/transfer-preview", module: "users", stability: "commercial-readiness" },
  { id: "platform.organizations.transferAccount", method: "POST", path: "/api/v1/platform/organizations/:organizationId/members/:userId/transfer", module: "users", stability: "commercial-readiness" }
] as const;
export const accountTransferSchemaRegistry = {
  "platform.organizations.previewAccountTransfer": { summary: "Preview account transfer while retaining source organization business work", tags: ["users"], requestBody: "AccountTransferTargetRequest", responseBody: "AccountTransferPreviewResponse" },
  "platform.organizations.transferAccount": { summary: "Atomically transfer a local account and revoke its former access", tags: ["users"], requestBody: "AccountTransferRequest", responseBody: "AccountTransferResponse", additionalResponses: { "409": "ErrorResponse" } }
} satisfies Record<string, ContractSchemaRef>;
