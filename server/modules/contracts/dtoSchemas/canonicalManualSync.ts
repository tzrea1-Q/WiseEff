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

const batchPreparation = canonicalBatchRollbackPrepareResponseSchema.shape.item.omit({
    historicalVersionId: true,
    historicalDigest: true,
    historicalSizeBytes: true,
    expectedCurrentVersionId: true,
    expectedWorkflowProofToken: true
  });
const singlePreparation = batchPreparation.omit({ batchProofDigest: true }).extend({
  kind: z.literal("canonical-source-single"),
  configRevisionId: z.string().min(1),
  cohort: z.array(batchPreparation.shape.cohort.element).min(1),
  targets: z.array(batchPreparation.shape.targets.element).length(1),
  before: z.string(), after: z.string()
}).strict();
export const canonicalManualSyncPrepareResponseSchema = z.object({
  item: z.union([batchPreparation, singlePreparation])
});

export const canonicalManualSyncSingleSubmitRequestSchema = z.object({
  expectedCurrentVersionId: z.string().min(1), expectedProofToken: z.string().min(1),
  expectedWorkflowProofToken: z.string().min(1), assignedToUserId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000)
}).strict();
export const canonicalManualSyncSingleSubmitResponseSchema = z.object({ item: z.object({
  requestId: z.string().min(1), status: z.enum(["pending", "approved", "rejected", "withdrawn"]), replayed: z.boolean()
}).strict() });

export const canonicalManualSyncDtoSchemaCatalog = {
  CanonicalManualSyncPrepareRequest: canonicalManualSyncPrepareRequestSchema,
  CanonicalManualSyncPrepareResponse: canonicalManualSyncPrepareResponseSchema
};
