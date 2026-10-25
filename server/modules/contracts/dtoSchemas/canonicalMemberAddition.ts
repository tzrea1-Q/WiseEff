import { z } from "zod";
import { sharedDtsiDependencySchema } from "./sharedDtsi";

export const sharedReferenceSwitchPreviewSchema=z.object({
  beforeVersion:z.number(),afterVersion:z.number().nullable(),
  dependencies:z.object({before:z.array(z.object({name:z.string(),version:z.number(),mountPath:z.string()})),after:z.array(z.object({name:z.string(),version:z.number(),mountPath:z.string()}))}),
  sources:z.array(z.object({sourceName:z.string(),before:z.string().nullable(),after:z.string().nullable(),projectOwned:z.boolean()})),
  effective:z.array(z.object({node:z.string(),property:z.string(),oldShared:z.string().nullable(),targetShared:z.string().nullable(),before:z.string().nullable(),after:z.string().nullable(),originBefore:z.string().nullable(),originAfter:z.string().nullable(),localOverride:z.boolean()})),
  build:z.object({mode:z.literal("release"),passed:z.literal(true),includeSearchPaths:z.array(z.string()),defines:z.record(z.string())})
});
export type SharedReferenceSwitchPreview=z.infer<typeof sharedReferenceSwitchPreviewSchema>;

/** Original source locations for a refused switch; never an approval or identity decision. */
export const sharedSwitchConflictSchema=z.object({
  message:z.string(),sourceName:z.string(),line:z.number().int().positive().optional(),node:z.string().optional(),property:z.string().optional(),
  fileId:z.string().optional(),fileVersionId:z.string().optional(),
  resourceId:z.string().optional(),versionId:z.string().optional(),memberId:z.string().optional(),
  identity:z.boolean().optional(),projectCorrection:z.boolean().optional()
});
export type SharedSwitchConflict=z.infer<typeof sharedSwitchConflictSchema>;

const additionFields = {
  candidateId: z.string().min(1).optional(), fileId: z.string().min(1).optional(),
  sharedReference: sharedDtsiDependencySchema.extend({mountPath:sharedDtsiDependencySchema.shape.mountPath.optional(), replaceVersionId:z.string().uuid().optional(),
    convertPrivate:z.object({configRevisionId:z.string().min(1),fileId:z.string().min(1),fileVersionId:z.string().min(1)}).strict().optional()}).strict().optional(),
  removeSharedReference: z.object({resourceId:z.string().uuid(),versionId:z.string().uuid()}).strict().optional(),
  setAsRoot: z.literal(true).optional(),
  role: z.enum(["base", "overlay", "charging", "thermal", "misc"]), sortOrder: z.number().int().min(0).max(100000),
  json: z.object({ configurationSchemaId: z.string().trim().min(1), rootPointer: z.string(),
    mappings: z.array(z.object({ definitionId: z.string().min(1), pointer: z.string() }).strict()).min(1).max(1000) }).strict().optional()
};
const exactlyOneSource = (value: { candidateId?: string; fileId?: string; sharedReference?: unknown; removeSharedReference?:unknown }) => [value.candidateId, value.fileId, value.sharedReference,value.removeSharedReference].filter(Boolean).length === 1;
export const memberAdditionBodySchema = z.object(additionFields).strict().refine(exactlyOneSource, "Choose exactly one candidate or existing file.");
export const memberAdditionApplyBodySchema = z.object({ ...additionFields, proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000), clientMutationId: z.string().trim().min(1).max(160) }).strict().refine(exactlyOneSource, "Choose exactly one candidate or existing file.");
export const memberAdditionPreviewResponseSchema = z.object({ item: z.object({
  proofToken: z.string().regex(/^[0-9a-f]{64}$/), configSetId: z.string(), fileName: z.string(), format: z.enum(["dts", "json"]),
  sharedReference: z.object({ resourceId: z.string(), versionId: z.string(), memberId: z.string(), version: z.number(), digest: z.string() }).optional(),
  sharedSwitch:sharedReferenceSwitchPreviewSchema.optional(),
  sharedConversion:z.object({semanticEqual:z.literal(true),identitiesRetained:z.literal(true),sourceEvidence:z.string(),
    files:z.array(z.object({fileId:z.string(),fileVersionId:z.string(),sourceName:z.string(),resourceId:z.string(),versionId:z.string(),memberId:z.string(),role:z.string(),sortOrder:z.number()})),
    origins:z.array(z.object({bindingId:z.string(),sourcePinId:z.string(),fileId:z.string(),fileVersionId:z.string(),propertyName:z.string(),locator:z.record(z.unknown())}))}).optional(),
  sharedRemoval:z.object({resourceId:z.string(),versionId:z.string(),name:z.string(),version:z.number()}).optional(),
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
export type MemberAdditionPreviewResponse=z.infer<typeof memberAdditionPreviewResponseSchema>;
