import { z } from "zod";

const id = z.string().min(1);
const digest = z.string().regex(/^[0-9a-f]{64}$/);

export const canonicalBatchRollbackPrepareRequestSchema = z.object({
  versionId: id,
  expectedCurrentVersionId: id,
  expectedWorkflowProofToken: id
}).strict();

export const canonicalBatchRollbackSubmitRequestSchema = canonicalBatchRollbackPrepareRequestSchema.extend({
  candidateId: id,
  expectedCandidateProofToken: id,
  expectedBatchProofDigest: digest,
  reason: z.string().trim().min(1).max(2000),
  assignedToUserId: id
}).strict();

export const canonicalBatchRollbackPrepareResponseSchema = z.object({
  item: z.object({
    kind: z.literal("canonical-source-batch"),
    organizationId: id, projectId: id, candidateId: id, fileId: id,
    format: z.enum(["json", "dts"]), baseVersionId: id, configSetId: id,
    baseDigest: digest, proposedDigest: digest, cohortProofToken: id,
    proofToken: id, batchProofDigest: digest,
    members: z.array(z.object({
      memberId: id, fileId: id, fileVersionId: id, sourceName: id,
      format: z.enum(["json", "dts"]), role: id, sortOrder: z.number().int(),
      checksum: id, sizeBytes: z.number().int().nonnegative(),
      configSetId: id, isCandidateFile: z.boolean()
    })).min(1),
    cohort: z.array(z.object({
      bindingId: id, oldValueId: id, sourcePinId: id, sourceOccurrenceId: id,
      definitionId: id, effectiveRevisionId: id, catalogReleaseId: id,
      locator: z.record(z.string(), z.unknown()), valueKind: id,
      valueDigest: id, configSetId: id
    })).min(2),
    targets: z.array(z.object({
      bindingId: id, definitionId: id, baseCurrentValueId: id,
      configRevisionId: id, sourcePinId: id,
      locator: z.record(z.string(), z.unknown()), baseDigest: id,
      proposedDigest: id, action: z.enum(["set", "delete"]),
      beforeText: z.string(), afterText: z.string().optional(),
      targetText: z.string().optional()
    })).min(2),
    historicalVersionId: id, historicalDigest: digest,
    historicalSizeBytes: z.number().int().nonnegative(),
    expectedCurrentVersionId: id, expectedWorkflowProofToken: id,
    replayed: z.boolean()
  })
});

export const canonicalBatchRollbackSubmitResponseSchema = z.object({
  item: z.object({
    candidateId: id, requestId: id, status: z.enum(["pending", "approved"]),
    batchProofDigest: digest, replayed: z.boolean()
  })
});

export const canonicalBatchRollbackDtoSchemaCatalog = {
  CanonicalBatchRollbackPrepareRequest: canonicalBatchRollbackPrepareRequestSchema,
  CanonicalBatchRollbackPrepareResponse: canonicalBatchRollbackPrepareResponseSchema,
  CanonicalBatchRollbackSubmitRequest: canonicalBatchRollbackSubmitRequestSchema,
  CanonicalBatchRollbackSubmitResponse: canonicalBatchRollbackSubmitResponseSchema
};
