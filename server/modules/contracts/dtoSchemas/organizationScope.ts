import { z } from "zod";
import { BACKEND_PERMISSIONS, BACKEND_ROLE_IDS } from "../../auth/types";

const organizationSchema = z.object({ id: z.string().min(1), name: z.string().min(1), status: z.enum(["active", "suspended"]).optional() }).strict();

export const enterOperatingContextBodySchema = z.object({
  organizationId: z.string().trim().min(1).max(200).optional()
}).strict();

export const operatingContextResponseSchema = z.object({
  actor: z.object({
    user: z.object({
      id: z.string().min(1), organizationId: z.string().min(1), name: z.string(), title: z.string(), isActive: z.boolean(),
      email: z.string().optional(), emailVerified: z.boolean().optional(), username: z.string().optional()
    }).strict(),
    organization: organizationSchema,
    roles: z.array(z.object({ projectId: z.string().nullable(), roleId: z.enum(BACKEND_ROLE_IDS) }).strict()),
    projectMemberships: z.array(z.object({ projectId: z.string(), roles: z.array(z.enum(["hardware-user", "software-user", "hardware-committer", "software-committer"])) }).strict()).optional(),
    permissions: z.array(z.enum(BACKEND_PERMISSIONS))
  }).strict(),
  organization: organizationSchema
}).strict();
