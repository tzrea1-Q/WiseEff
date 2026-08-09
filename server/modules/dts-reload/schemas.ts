import { z } from "zod";

export const startReloadRunBodySchema = z.object({
  bindingId: z.string().min(1),
  debugValue: z.string().min(1)
});

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const runIdParamsSchema = z.object({
  runId: z.string().min(1)
});
