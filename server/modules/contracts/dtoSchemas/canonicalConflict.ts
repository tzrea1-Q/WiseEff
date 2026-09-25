import { z } from "zod";

const id = z.string().min(1);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const choice = z.enum(["file", "draft"]);

export const canonicalSourceConflictSubmitRequestSchema = z.object({
  selectedBindingId: id,
  selectedDraftId: id,
  choice,
  expectedDecisionProofDigest: digest,
  reason: z.string().trim().min(1).max(2000),
  assignedToUserId: id
}).strict();

const sourceMemberSchema = z.object({
  memberId: id, fileId: id, fileVersionId: id, sourceName: id,
  format: z.enum(["json", "dts"]),
  role: id, sortOrder: z.number(), checksum: id, sizeBytes: z.number(),
  configSetId: id, isCandidateFile: z.boolean()
});

const sourceCohortSchema = z.object({
  bindingId: id, oldValueId: id, sourcePinId: id, sourceOccurrenceId: id,
  definitionId: id, effectiveRevisionId: id, catalogReleaseId: id,
  locator: z.record(z.string(), z.unknown()), valueKind: id, valueDigest: id,
  configSetId: id
});

export const canonicalSourceConflictDecisionProofSchema = z.object({
  candidateId: id, selectedBindingId: id, selectedDraftId: id, choice,
  fileId: id, baseVersionId: id, configSetId: id,
  sourceProofToken: id, cohortProofToken: id, sourceCandidateDigest: id,
  selectedDraftCandidateId: id, selectedDraftCandidateDigest: id,
  selectedDraftProof: digest, selectedSourcePinId: id, selectedBaseValueId: id,
  selectedRevisionId: id, members: z.array(sourceMemberSchema),
  cohort: z.array(sourceCohortSchema), action: z.enum(["set", "delete"]),
  targetText: z.string().optional(), decisionProofDigest: digest
});

export const canonicalSourceConflictListResponseSchema = z.object({
  items: z.array(z.object({
    selectedBindingId: id, selectedDraftId: id, authorUserId: id,
    choices: z.object({
      file: canonicalSourceConflictDecisionProofSchema,
      draft: canonicalSourceConflictDecisionProofSchema
    })
  })),
  ineligible: z.array(z.object({ selectedBindingId: id, selectedDraftId: id, reason: id }))
});

export const canonicalSourceConflictSubmitResponseSchema = z.object({
  item: z.object({ requestId: id, status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
    replayed: z.boolean() })
});

export const canonicalSourceConflictDecisionResponseSchema = z.object({
  item: z.object({
    request: z.object({ id, bindingId: id, targetValue: z.string(),
      sourceFormat: z.enum(["json", "dts"]), status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
      assignedToUserId: id.nullable(), submitterUserId: id.nullable() }).passthrough(),
    sourceCandidateId: id, selectedBindingId: id, selectedDraftId: id,
    choice, decisionProofDigest: digest,
    sourceDiff: z.object({ requestId: id, bindingId: id, candidateId: id,
      format: z.enum(["json", "dts"]), sourcePinId: id,
      baseDigest: digest, proposedDigest: digest, diffDigest: digest,
      before: z.string(), after: z.string() }).passthrough()
  })
});

export const canonicalConflictDtoSchemaCatalog = {
  CanonicalSourceConflictSubmitRequest: canonicalSourceConflictSubmitRequestSchema,
  CanonicalSourceConflictListResponse: canonicalSourceConflictListResponseSchema,
  CanonicalSourceConflictSubmitResponse: canonicalSourceConflictSubmitResponseSchema,
  CanonicalSourceConflictDecisionResponse: canonicalSourceConflictDecisionResponseSchema
};
