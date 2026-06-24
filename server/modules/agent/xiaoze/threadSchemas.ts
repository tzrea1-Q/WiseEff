import { z } from "zod";

export const xiaozeThreadListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().min(1).optional()
});

export const xiaozeThreadIdParamsSchema = z.object({
  threadId: z.string().trim().min(1)
});

export const createXiaozeThreadBodySchema = z.object({
  id: z.string().trim().min(1).optional(),
  context: z
    .object({
      path: z.string().optional(),
      pageKey: z.string().optional(),
      projectId: z.string().optional(),
      roleId: z.string().optional()
    })
    .optional()
});

export const patchXiaozeThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(80)
});

export function parseXiaozeThreadListQuery(query: Record<string, string | string[]>) {
  const raw = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  return xiaozeThreadListQuerySchema.parse(raw);
}
