import { z } from "zod";

const roleIdSchema = z.enum([
  "guest",
  "hardware-user",
  "software-user",
  "hardware-committer",
  "software-committer",
  "admin",
  "platform-admin"
]);

export const roleBindingSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  roleId: roleIdSchema
});

export const createUserBodySchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3).max(64),
  password: z.string().min(8),
  title: z.string().optional(),
  roles: z.array(roleBindingSchema).min(1)
});

export const updateUserBodySchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  title: z.string().min(1).optional()
});

export const updateUserActiveBodySchema = z.object({
  isActive: z.boolean()
});

export const resetUserPasswordBodySchema = z
  .object({
    password: z.string().min(8)
  })
  .strict();

export const replaceUserRolesBodySchema = z.object({
  roles: z.array(roleBindingSchema).min(1)
});

export const organizationNameMaxLength = 80;

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().min(1).max(organizationNameMaxLength)
  })
  .strict();
