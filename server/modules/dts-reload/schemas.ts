import { z } from "zod";

export const startReloadRunTargetSchema = z.object({
  bindingId: z.string().min(1),
  debugValue: z.string().min(1)
});

/** Batch start body: one or more parameter debug values for a single reload run. */
export const startReloadRunBodySchema = z.object({
  targets: z.array(startReloadRunTargetSchema).min(1),
  /**
   * Required when any selected target matches a critical-tier sensitive-node rule.
   * Must equal `confirm-sensitive-reload`. Device-deploy confirmation (`confirm-dts-reload`) is #285.
   */
  confirmationToken: z.string().min(1).optional()
});

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const runIdParamsSchema = z.object({
  runId: z.string().min(1)
});
