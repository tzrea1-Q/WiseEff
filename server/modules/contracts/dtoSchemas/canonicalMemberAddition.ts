import { z } from "zod";
import { sharedDtsiDependencySchema } from "./sharedDtsi";

const additionFields = {
  candidateId: z.string().min(1).optional(), fileId: z.string().min(1).optional(),
  sharedReference: sharedDtsiDependencySchema.extend({mountPath:sharedDtsiDependencySchema.shape.mountPath.optional()}).strict().optional(),
  setAsRoot: z.literal(true).optional(),
  role: z.enum(["base", "overlay", "charging", "thermal", "misc"]), sortOrder: z.number().int().min(0).max(100000),
  json: z.object({ configurationSchemaId: z.string().trim().min(1), rootPointer: z.string(),
    mappings: z.array(z.object({ definitionId: z.string().min(1), pointer: z.string() }).strict()).min(1).max(1000) }).strict().optional()
};
const exactlyOneSource = (value: { candidateId?: string; fileId?: string; sharedReference?: unknown }) => [value.candidateId, value.fileId, value.sharedReference].filter(Boolean).length === 1;
export const memberAdditionBodySchema = z.object(additionFields).strict().refine(exactlyOneSource, "Choose exactly one candidate or existing file.");
export const memberAdditionApplyBodySchema = z.object({ ...additionFields, proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000), clientMutationId: z.string().trim().min(1).max(160) }).strict().refine(exactlyOneSource, "Choose exactly one candidate or existing file.");
export const memberAdditionPreviewResponseSchema = z.object({ item: z.object({
  proofToken: z.string().regex(/^[0-9a-f]{64}$/), configSetId: z.string(), fileName: z.string(), format: z.enum(["dts", "json"]),
  sharedReference: z.object({ resourceId: z.string(), versionId: z.string(), memberId: z.string(), version: z.number(), digest: z.string() }).optional(),
  sharedComposition:z.array(z.object({resourceId:z.string(),versionId:z.string(),name:z.string(),version:z.number(),digest:z.string(),mountPath:z.string(),direct:z.boolean(),
    sources:z.array(z.object({memberId:z.string(),fileId:z.string(),fileVersionId:z.string(),sourceName:z.string()}))})).optional(),
  rootEdit: z.object({ fileId: z.string(), baseFileVersionId: z.string(), sourceName: z.string(), before: z.string(), after: z.string() }).optional(),
  members: z.array(z.object({ fileId: z.string(), fileVersionId: z.string(), sourceName: z.string(), format: z.enum(["dts", "json"]),
    role: z.string(), sortOrder: z.number().int(), checksum: z.string(), sizeBytes: z.number() })),
  entryFile: z.string().nullable(), includeSearchPaths: z.array(z.string()), overlayOrder: z.array(z.string()),
  diagnostics: z.array(z.object({ severity: z.enum(["error", "warning"]), code: z.string(), message: z.string() })),
  impact: z.object({ parameterChanges: z.number().int(), nodeAdditions: z.number().int(), nodeRemovals: z.number().int(),
    restoredParameters: z.number().int().nonnegative().optional(),
    retainedBindings: z.number().int(), sourceReplacements: z.number().int() })
}) });
export const memberAdditionApplyResponseSchema = z.object({ item: z.object({
  requestId: z.string(), fileId: z.string(), fileVersionId: z.string(), configRevisionId: z.string()
}).passthrough() });
