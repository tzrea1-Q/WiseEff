import { z } from "zod";
import { itemEnvelopeSchema } from "./envelopes";

const canonicalRestoreRequest = z.object({
  sourceConfigRevisionId: z.string().min(1).optional(), proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  confirmCompositionChanges: z.boolean(), reason: z.string().trim().min(1).max(2000), clientMutationId: z.string().trim().min(1).max(160)
}).strict();
// Legacy configurations retain the existing empty payload; Canonical ones require the complete proof.
export const releaseBaselineRestoreRequestSchema = z.union([z.object({}).strict(), canonicalRestoreRequest]);
const count = z.number().int().nonnegative();
export const releaseBaselineRestorePreviewResponseSchema = itemEnvelopeSchema(z.object({
  baselineId: z.string(), configSetId: z.string(), releasedBaselineId: z.string().optional(),
  releasedBaselineUnchanged: z.literal(true), driftedCount: count,
  members: z.array(z.object({
    fileId: z.string(), canonicalOwned: z.boolean(), fileName: z.string().optional(), fromVersionId: z.string().nullable(),
    fromVersionNumber: count.optional(), toVersionId: z.string(), toVersionNumber: count, action: z.enum(["noop", "rollback-pointer"])
  })),
  canonical: z.object({
    canRestore: z.boolean(), proofToken: z.string().regex(/^[0-9a-f]{64}$/).optional(), sourceConfigRevisionId: z.string().optional(),
    missingInformation: z.array(z.string()), historicalRevisions: z.array(z.object({ id: z.string(), revisionNumber: count })),
    editorHref: z.string(), requiresCompositionConfirmation: z.boolean(),
    members: z.array(z.object({
      fileId: z.string(), fileName: z.string(), fromVersionId: z.string().nullable(), toVersionId: z.string(), versionNumber: count,
      role: z.string(), sortOrder: z.number().int(), action: z.enum(["restore", "reattach", "retain-added", "unchanged"]), compositionChanged: z.boolean()
    })),
    entryFile: z.string().nullable(), includeSearchPaths: z.array(z.string()), overlayOrder: z.array(z.string()),
    sharedDependencies: z.array(z.object({ resourceId: z.string(),name: z.string(),beforeVersion: count.nullable(),targetVersion: count,mountPath: z.string() })).optional(),
    impact: z.object({ parameterChanges: count, retainedBindings: count, restoredBindings: count, sourceReplacements: count })
  }).optional()
}));
export const releaseBaselineRollbackResponseSchema = itemEnvelopeSchema(z.union([
  z.object({ baselineId: z.string(), restored: count }).strict(),
  z.object({
    requestId: z.string(), baselineId: z.string(), restored: count, configRevisionId: z.string(),
    sourceRevisionProofDigest: z.string(), results: z.array(z.object({
      bindingId: z.string(), oldValueId: z.string(), newValueId: z.string(), sourcePinId: z.string(), historyEventId: z.string()
    }))
  }).strict()
]));
