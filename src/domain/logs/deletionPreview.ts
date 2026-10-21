import { z } from "zod";

export const logDeletionPreviewSchema = z.object({
  organizationId: z.string(), logId: z.string(), fileName: z.string(), generatedAt: z.string().datetime(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  inventory: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int().nonnegative(),
    disposition: z.enum(["delete", "retain"]) })),
  objects: z.object({ total: z.number().int().nonnegative(), shared: z.number().int().nonnegative(), exclusive: z.number().int().nonnegative() }),
  conditions: z.array(z.object({ code: z.string(), count: z.number().int().nonnegative(), message: z.string() })),
  notes: z.array(z.string())
});

/** Read-only snapshot; the version does not authorize a deletion. */
export type LogDeletionPreview = z.infer<typeof logDeletionPreviewSchema>;

export const logDeletionStatusSchema = z.object({ logId: z.string(), version: z.string().regex(/^[a-f0-9]{64}$/),
  database: z.literal("deleted"), objects: z.enum(["pending", "complete"]), pendingObjects: z.number().int().nonnegative() });
export type LogDeletionStatus = z.infer<typeof logDeletionStatusSchema>;
