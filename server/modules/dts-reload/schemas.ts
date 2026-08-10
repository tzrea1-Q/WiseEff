import { z } from "zod";

export const startReloadRunTargetSchema = z.object({
  bindingId: z.string().min(1),
  debugValue: z.string().min(1)
});

/** Batch start body: one or more parameter debug values for a single reload run (preflight only). */
export const startReloadRunBodySchema = z.object({
  targets: z.array(startReloadRunTargetSchema).min(1),
  /**
   * Required when any selected target matches a critical-tier sensitive-node rule.
   * Must equal `confirm-sensitive-reload`. Device-deploy confirmation is collected on deploy.
   */
  confirmationToken: z.string().min(1).optional()
});

export const deployReloadRunBodySchema = z.object({
  deviceId: z.string().min(1),
  bridgeId: z.string().min(1),
  targetRef: z.string().min(1),
  protocol: z.enum(["hdc", "adb"]).default("hdc"),
  /**
   * Must include `confirm-dts-reload`. Never silently injected by runtime code.
   * May also include `confirm-sensitive-reload` when the UI collected both in one dialog,
   * but sensitive gating still happens at start.
   */
  confirmationTokens: z.array(z.string().min(1)).min(1)
});

export const restoreBaselineBodySchema = z.object({
  deviceId: z.string().min(1),
  /**
   * Required when residue parameters match a critical-tier sensitive-node rule.
   * Must equal `confirm-sensitive-reload`. Device-deploy confirmation is collected on deploy.
   */
  confirmationToken: z.string().min(1).optional()
});

export const residueQuerySchema = z.object({
  deviceId: z.string().min(1)
});

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const runIdParamsSchema = z.object({
  runId: z.string().min(1)
});
