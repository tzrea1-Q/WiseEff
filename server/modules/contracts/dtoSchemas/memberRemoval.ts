import { z } from "zod";

export const administratorMemberRemovalApplyRequestSchema = z.object({ expectedProofToken: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(2000), clientMutationId: z.string().trim().min(1).max(160) }).strict();
export const administratorMemberRemovalPreviewResponseSchema = z.object({ item: z.object({ canApply: z.literal(true),
  proofToken: z.string(), removedFileId: z.string(), members: z.array(z.object({ fileId: z.string(), fileVersionId: z.string(),
    sourceName: z.string(), format: z.enum(["json", "dts"]), role: z.string(), sortOrder: z.number(), checksum: z.string(), sizeBytes: z.number() })),
  dependencies: z.array(z.object({ file: z.string(), kind: z.enum(["include", "overlay"]), target: z.string() })),
  impact: z.object({ nodeRemovals: z.number().int().nonnegative(), removedBindings: z.number().int().nonnegative(), retainedBindings: z.number().int().nonnegative(), exposedBindings: z.number().int().nonnegative() }) }) });
export const administratorMemberRemovalApplyResponseSchema = z.object({ item: z.object({ requestId: z.string(), tombstoneId: z.string(),
  successorConfigRevisionId: z.string(), replayed: z.boolean() }) });
