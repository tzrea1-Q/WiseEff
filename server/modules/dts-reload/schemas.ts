import { z } from "zod";

export const startReloadRunTargetSchema = z.object({
  bindingId: z.string().min(1),
  debugValue: z.string().min(1)
});

/** Upper bound on reload targets per run — bounds overlay size, audit metadata, and worst-case deploy duration against the device lease. */
export const MAX_RELOAD_TARGETS_PER_RUN = 50;

/** Batch start body: one or more parameter debug values for a single reload run (preflight only). */
export const startReloadRunBodySchema = z.object({
  targets: z.array(startReloadRunTargetSchema).min(1).max(MAX_RELOAD_TARGETS_PER_RUN),
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

export const listReloadRunsQuerySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    deviceId: z.string().min(1).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .refine((value) => Boolean(value.projectId?.trim() || value.deviceId?.trim()), {
    message: "projectId or deviceId is required"
  });

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const runIdParamsSchema = z.object({
  runId: z.string().min(1)
});
