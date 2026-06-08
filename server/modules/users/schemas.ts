import { z } from "zod";

const roleIdSchema = z.enum(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);

export const roleBindingSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  roleId: roleIdSchema
});

export const createUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  title: z.string().default("User"),
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
