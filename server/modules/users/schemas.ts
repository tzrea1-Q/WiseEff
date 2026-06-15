import { z } from "zod";

const roleIdSchema = z.enum(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);

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

export const replaceUserRolesBodySchema = z.object({
  roles: z.array(roleBindingSchema).min(1)
});
