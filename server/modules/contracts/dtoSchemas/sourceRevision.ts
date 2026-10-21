import { z } from "zod";

const id = z.string().min(1);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const sourceRevisionStatusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);
const mutationId = id.max(200);
const reason = z.string().trim().min(1).max(2000);

export const sourceRevisionImpactSchema = z.object({
  parameterChanges: z.number().int().nonnegative(),
  nodeAdditions: z.number().int().nonnegative(),
  nodeRemovals: z.number().int().nonnegative()
}).strict();

const legacyCandidateRequestSchema = z.object({ fileName: id, contentBase64: id, fileId: id.optional() }).strict();
export const sourceRevisionCandidateRequestSchema = legacyCandidateRequestSchema.extend({
  intent: z.literal("source_revision"), fileId: id,
  expectedCurrentVersionId: id, expectedConfigRevisionId: id, clientMutationId: mutationId
});
export const createParameterFileCandidateRequestSchema = z.union([sourceRevisionCandidateRequestSchema, legacyCandidateRequestSchema]);

/** The candidate's stored intent determines whether reviewer and mutation ID are mandatory. */
export const canonicalSourceSubmitRequestSchema = z.object({
  expectedCurrentVersionId: id, expectedProofToken: id, expectedWorkflowProofToken: id.optional(),
  assignedToUserId: id.optional(), reason, clientMutationId: mutationId.optional()
}).strict();
export const sourceRevisionDirectApplyRequestSchema = z.object({
  expectedCurrentVersionId: id, expectedProofToken: digest, reason, clientMutationId: id.max(160)
}).strict();

export const sourceRevisionCandidatePreviewSchema = z.object({
  kind: z.literal("source_revision"), format: z.literal("dts"), candidateId: id, fileId: id, configSetId: id,
  baseVersionId: id, configRevisionId: id, before: z.string(), after: z.string(),
  proofToken: digest, baseDigest: digest, proposedDigest: digest, canSubmit: z.boolean(), reason: id.optional(),
  diagnostics: z.array(z.object({ severity: z.enum(["error", "warning"]), code: id, message: id,
    file: id.optional(), line: z.number().int().positive().optional(), column: z.number().int().positive().optional() }).strict()),
  impact: sourceRevisionImpactSchema,
  reviewers: z.array(z.object({ userId: id, name: z.string() }).strict()),
  request: z.object({ id, status: sourceRevisionStatusSchema, kind: z.literal("source_revision") }).strict().optional()
}).strict();

export const sourceRevisionRequestDtoSchema = z.object({
  id, projectId: id, candidateId: id, fileId: id, fileName: id, configSetId: id,
  status: sourceRevisionStatusSchema, reason,
  applicationMode: z.enum(["separate_review", "administrator_direct"]),
  submitterUserId: id.nullable(), assignedToUserId: id.nullable(), reviewerUserId: id.nullable(),
  submitterName: z.string().nullable().optional(), assignedToName: z.string().nullable().optional(), reviewerName: z.string().nullable().optional(),
  reviewerNote: z.string().nullable(), createdAt: id, updatedAt: id, proofDigest: digest,
  impact: sourceRevisionImpactSchema, before: z.string().optional(), after: z.string().optional(),
  appliedSourceResult: z.object({ configRevisionId: id, fileVersionId: id }).passthrough().nullable().optional()
}).strict();

export const sourceRevisionRequestListResponseSchema = z.object({ items: z.array(sourceRevisionRequestDtoSchema) }).strict();
export const sourceRevisionRequestResponseSchema = z.object({ item: sourceRevisionRequestDtoSchema }).strict();
export const sourceRevisionRequestDetailResponseSchema = z.object({
  item: sourceRevisionRequestDtoSchema.extend({ before: z.string(), after: z.string() })
}).strict();
export const sourceRevisionReviewRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]), proofDigest: digest, note: z.string().trim().max(2000).optional()
}).strict();
export const sourceRevisionWithdrawRequestSchema = z.object({}).strict();
export const canonicalSourceSubmissionResponseSchema = z.object({ item: z.object({
  requestId: id, status: sourceRevisionStatusSchema, replayed: z.boolean()
}).strict() }).strict();

export const sourceRevisionDtoSchemaCatalog = {
  CreateParameterFileCandidateRequest: createParameterFileCandidateRequestSchema,
  CanonicalSourceSubmitRequest: canonicalSourceSubmitRequestSchema,
  CanonicalSourceSubmissionResponse: canonicalSourceSubmissionResponseSchema,
  SourceRevisionRequestListResponse: sourceRevisionRequestListResponseSchema,
  SourceRevisionRequestResponse: sourceRevisionRequestResponseSchema,
  SourceRevisionRequestDetailResponse: sourceRevisionRequestDetailResponseSchema,
  SourceRevisionReviewRequest: sourceRevisionReviewRequestSchema,
  SourceRevisionWithdrawRequest: sourceRevisionWithdrawRequestSchema,
  SourceRevisionDirectApplyRequest: sourceRevisionDirectApplyRequestSchema
};

export const sourceRevisionCoveredRouteIds = [
  "parameterFiles.previewCanonicalCandidate", "parameterFiles.submitCanonicalCandidate",
  "parameterFiles.applySourceRevisionCandidate",
  "parameterFiles.listSourceRevisionRequests", "parameterFiles.getSourceRevisionRequest",
  "parameterFiles.reviewSourceRevisionRequest", "parameterFiles.withdrawSourceRevisionRequest"
] as const;
