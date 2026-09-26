import { z } from "zod";
import { canonicalBatchRollbackPrepareResponseSchema } from "./canonicalBatchRollback";

// Encoded form of the existing 2 MiB parameter source limit.
const maxContentBase64Length = 4 * Math.ceil((2 * 1024 * 1024) / 3);

export const canonicalManualSyncPrepareRequestSchema = z.object({
  contentBase64: z.string().min(1).max(maxContentBase64Length)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  expectedCurrentVersionId: z.string().min(1),
  expectedWorkflowProofToken: z.string().min(1)
}).strict();

export const canonicalManualSyncPrepareResponseSchema = z.object({
  item: canonicalBatchRollbackPrepareResponseSchema.shape.item.omit({
    historicalVersionId: true,
    historicalDigest: true,
    historicalSizeBytes: true,
    expectedCurrentVersionId: true,
    expectedWorkflowProofToken: true
  })
});

export const canonicalManualSyncDtoSchemaCatalog = {
  CanonicalManualSyncPrepareRequest: canonicalManualSyncPrepareRequestSchema,
  CanonicalManualSyncPrepareResponse: canonicalManualSyncPrepareResponseSchema
};
